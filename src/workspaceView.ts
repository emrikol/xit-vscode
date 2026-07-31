/**
 * A sidebar of every outstanding item in the workspace, grouped by urgency.
 *
 * The one thing here that answers "what is due" rather than "what does this
 * file say". Three people built it outside VS Code first - a shell script
 * (#12), an HTML view (#7), a TUI (#38) - which is a strong signal that the
 * hole is real.
 */

import * as vscode from 'vscode';

import { Collected, Urgency, isOpen, urgencyOf } from './collect';
import { todayFrom } from './dueDate';
import { WorkspaceIndex } from './workspaceIndex';

/** Groups, in the order they appear. Worst first: that is the question being asked. */
const GROUPS: { urgency: Urgency; label: string }[] = [
	{ urgency: 'critical', label: 'Critically overdue' },
	{ urgency: 'overdue', label: 'Overdue' },
	{ urgency: 'soon', label: 'Due soon' },
	{ urgency: 'later', label: 'Later' },
	{ urgency: 'none', label: 'No due date' },
	// The two you cannot act on, below everything you can. Neither is hidden:
	// hiding would lose work, and ranking them by a due date you cannot work
	// towards would put them above things you can.
	{ urgency: 'waiting', label: 'Waiting on someone else' },
	{ urgency: 'notYet', label: 'Not started yet' },
];

class Group {
	constructor(readonly urgency: Urgency, readonly label: string, readonly rows: Row[]) {}
}

class Row {
	constructor(readonly uri: vscode.Uri, readonly item: Collected, readonly urgency: Urgency) {}
}

type Element = Group | Row;

class Provider implements vscode.TreeDataProvider<Element> {
	private readonly changed = new vscode.EventEmitter<Element | undefined>();
	readonly onDidChangeTreeData = this.changed.event;

	private showDone = false;

	constructor(private readonly index: WorkspaceIndex) {
		index.onDidChange(() => this.changed.fire(undefined));
	}

	toggleDone() {
		this.showDone = !this.showDone;
		void vscode.commands.executeCommand('setContext', 'xit.showingDone', this.showDone);
		this.changed.fire(undefined);
	}

	getTreeItem(element: Element): vscode.TreeItem {
		if (element instanceof Group) {
			const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
			item.description = String(element.rows.length);
			item.contextValue = 'xit.group';
			return item;
		}

		const { item, uri } = element;
		const row = new vscode.TreeItem(`[${item.status}] ${item.description}`.trimEnd());

		// The file and the due date, which is what turns a list of everything
		// into something you can act on.
		const file = uri.path.split('/').pop() ?? uri.path;
		// The start date is shown only where it is the reason the row is
		// where it is; elsewhere the due date is the useful one.
		const when = item.start && element.urgency === 'notYet' ? item.start.text : item.due?.text;
		row.description = [when, file].filter(Boolean).join('  ');
		row.tooltip = new vscode.MarkdownString(
			`${item.description || '_no description_'}\n\n`
			+ (item.start ? `Not before \`${item.start.text.slice(3)}\`\n\n` : '')
			+ (item.due ? `Due \`${item.due.text.slice(3)}\`\n\n` : '')
			+ `${uri.path}:${item.line + 1}`,
		);
		row.resourceUri = uri;
		row.contextValue = 'xit.item';
		row.command = {
			// Opening at the line, with the item selected. The same thing Go
			// to Definition does.
			command: 'vscode.open',
			title: 'Open',
			arguments: [uri, { selection: new vscode.Range(item.line, 0, item.line, 0) } satisfies vscode.TextDocumentShowOptions],
		};

		return row;
	}

	getChildren(element?: Element): Element[] {
		if (element instanceof Row) return [];
		if (element instanceof Group) return element.rows;

		const configuration = vscode.workspace.getConfiguration('xit');
		const thresholds = {
			today: todayFrom(new Date()),
			criticalAfterDays: configuration.get<number>('criticallyOverdueAfterDays', 14),
			soonWithinDays: configuration.get<number>('dueSoonWithinDays', 7),
		};

		const rows = new Map<Urgency, Row[]>(GROUPS.map((group) => [group.urgency, []]));

		for (const file of this.index.all()) {
			for (const item of file.items) {
				if (!this.showDone && !isOpen(item)) continue;
				const urgency = urgencyOf(item, thresholds);
				rows.get(urgency)!.push(new Row(file.uri, item, urgency));
			}
		}

		// Empty groups are noise. A group with nothing in it says nothing.
		return GROUPS
			.filter((group) => rows.get(group.urgency)!.length > 0)
			.map((group) => new Group(group.urgency, group.label, rows.get(group.urgency)!));
	}
}

export function registerWorkspaceView(context: vscode.ExtensionContext) {
	const index = new WorkspaceIndex();
	const provider = new Provider(index);

	const view = vscode.window.createTreeView('xit.items', {
		treeDataProvider: provider,
		showCollapseAll: true,
	});

	// The view is declared `when: xit.hasItems`, so this context is what
	// decides whether it appears at all. Without it the panel would sit in
	// every workspace, empty, for people who have never written an xit file.
	const announce = () => {
		const files = index.all();
		const total = files.reduce((count, file) => count + file.items.length, 0);
		void vscode.commands.executeCommand('setContext', 'xit.hasItems', files.length > 0);

		// A blank panel looks broken. This says which of the two it is.
		view.message = files.length === 0
			? 'No .xit files in this workspace.'
			: total === 0 ? 'No items in any .xit file yet.' : undefined;
	};

	index.onDidChange(announce);
	announce();

	context.subscriptions.push(
		index,
		view,
		vscode.commands.registerCommand('xit.refreshItems', () => void index.refresh()),
		vscode.commands.registerCommand('xit.toggleDoneItems', () => provider.toggleDone()),
	);

	void index.refresh();
}
