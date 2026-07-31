/**
 * A sidebar of every outstanding item in the workspace, grouped by urgency.
 *
 * The one thing here that answers "what is due" rather than "what does this
 * file say". Three people built it outside VS Code first - a shell script
 * (#12), an HTML view (#7), a TUI (#38) - which is a strong signal that the
 * hole is real.
 */

import * as vscode from 'vscode';

import { Collected, Urgency, isOpen, overdueCount, totalEstimate, urgencyOf } from './collect';
import { formatCycleTime } from './cycle';
import { formatEstimate } from './estimate';
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
	{ urgency: 'blocked', label: 'Blocked by another item' },
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

			// The count, and the work in it. A total that quietly leaves out
			// unestimated items would read as "this group is six hours" when
			// it is six hours plus however long four other things take, so
			// the leftovers are named rather than dropped.
			const { minutes, unestimated } = totalEstimate(element.rows.map((row) => row.item));
			const total = minutes > 0
				? unestimated > 0 ? `${formatEstimate(minutes)} + ${unestimated}` : formatEstimate(minutes)
				: '';

			item.description = [String(element.rows.length), total].filter(Boolean).join('  ');
			item.tooltip = minutes > 0 && unestimated > 0
				? `${formatEstimate(minutes)} estimated, and ${unestimated} item${unestimated === 1 ? '' : 's'} with no estimate.`
				: undefined;
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
		// A finished item has no useful due date left, so its row carries how
		// long it took instead - which is the only thing #created= and #done=
		// were ever recorded for.
		const shown = !isOpen(item) && item.took !== null ? formatCycleTime(item.took) : when;
		row.description = [shown, file].filter(Boolean).join('  ');
		row.tooltip = new vscode.MarkdownString(
			`${item.description || '_no description_'}\n\n`
			+ (item.start ? `Not before \`${item.start.text.slice(3)}\`\n\n` : '')
			+ (item.due ? `Due \`${item.due.text.slice(3)}\`\n\n` : '')
			+ (item.took !== null ? `Took ${formatCycleTime(item.took)}\n\n` : '')
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

/**
 * A count of what is late, always visible, costing no screen space.
 *
 * Says nothing when nothing is overdue. A permanent `0` is noise, and a status
 * bar entry that is always there stops being read.
 *
 * The critical tier is named in the text rather than only coloured. A status
 * bar background is one of two colours VS Code offers and a theme may override
 * either, so colour cannot be the thing carrying the meaning - the same
 * reasoning as the overdue decoration, and WCAG SC 1.4.1.
 */
function registerStatusBar(context: vscode.ExtensionContext, index: WorkspaceIndex) {
	const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	status.command = 'xit.items.focus';

	const update = () => {
		const configuration = vscode.workspace.getConfiguration('xit');
		const { overdue, critical } = overdueCount(index.all(), {
			today: todayFrom(new Date()),
			criticalAfterDays: configuration.get<number>('criticallyOverdueAfterDays', 14),
			soonWithinDays: configuration.get<number>('dueSoonWithinDays', 7),
		});

		if (!configuration.get<boolean>('overdueInStatusBar', true) || overdue === 0) {
			status.hide();
			return;
		}

		status.text = `$(warning) ${overdue} overdue`;
		status.tooltip = critical > 0
			? `${overdue} outstanding items are past their due date, ${critical} of them by more than the critical threshold.`
			: `${overdue} outstanding items are past their due date.`;
		status.backgroundColor = critical > 0
			? new vscode.ThemeColor('statusBarItem.warningBackground')
			: undefined;
		status.show();
	};

	index.onDidChange(update);
	vscode.workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration('xit')) update();
	}, undefined, context.subscriptions);

	context.subscriptions.push(status);
	update();
}

export function registerWorkspaceView(context: vscode.ExtensionContext): WorkspaceIndex {
	const index = new WorkspaceIndex();
	const provider = new Provider(index);

	registerStatusBar(context, index);

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
		// Returns the promise rather than firing and forgetting, so anything
		// that needs the index warm - a test, a command chained after it -
		// can await the command and actually get a refreshed index.
		vscode.commands.registerCommand('xit.refreshItems', () => index.refresh()),
		vscode.commands.registerCommand('xit.toggleDoneItems', () => provider.toggleDone()),
	);

	void index.refresh();

	// Handed back so completion can read the same index rather than building a
	// second one. One reader of the file system, one debounce, one truth.
	return index;
}
