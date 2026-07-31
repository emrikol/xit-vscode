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
import { Grouping, TagChoice, UNTAGGED, byTag, describeSelection, matchesTags, tagChoices } from './filter';
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

/** Where each urgency sits, so rows can be ranked when the top level is not urgency. */
const RANK = new Map(GROUPS.map((group, at) => [group.urgency, at]));

class Group {
	constructor(readonly label: string, readonly rows: Row[]) {}
}

class Row {
	constructor(readonly uri: vscode.Uri, readonly item: Collected, readonly urgency: Urgency) {}
}

type Element = Group | Row;

class Provider implements vscode.TreeDataProvider<Element> {
	private readonly changed = new vscode.EventEmitter<Element | undefined>();
	readonly onDidChangeTreeData = this.changed.event;

	private showDone = false;

	/** Tags the view is narrowed to, or null for everything. */
	private filter: ReadonlySet<string> | null = null;

	private grouping: Grouping = 'urgency';

	constructor(private readonly index: WorkspaceIndex) {
		index.onDidChange(() => this.changed.fire(undefined));
	}

	toggleDone() {
		this.showDone = !this.showDone;
		void vscode.commands.executeCommand('setContext', 'xit.showingDone', this.showDone);
		this.changed.fire(undefined);
	}

	/** The tags on offer, taken from everything the filter is not applied to. */
	choices(): TagChoice[] {
		return tagChoices(this.rows(false), (row) => row.item.tags);
	}

	/** How many rows the view is showing, which is what an empty panel needs explaining. */
	matched(): number {
		return this.rows(true).length;
	}

	get selection(): ReadonlySet<string> | null {
		return this.filter;
	}

	setFilter(tags: ReadonlySet<string> | null) {
		this.filter = tags && tags.size > 0 ? tags : null;
		void vscode.commands.executeCommand('setContext', 'xit.filteringByTag', this.filter !== null);
		this.changed.fire(undefined);
	}

	setGrouping(grouping: Grouping) {
		this.grouping = grouping;
		void vscode.commands.executeCommand('setContext', 'xit.groupingByTag', grouping === 'tag');
		this.changed.fire(undefined);
	}

	toggleGrouping() {
		this.setGrouping(this.grouping === 'tag' ? 'urgency' : 'tag');
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

	/**
	 * Every row the view would show, optionally narrowed to the tag filter.
	 *
	 * The filter is a parameter rather than always applied because the tag
	 * picker has to offer tags that are currently filtered out. Applying it
	 * there too would make the filter a one-way door: narrow to `#work` and
	 * `#home` would no longer be on the list to switch back to.
	 */
	private rows(applyFilter: boolean): Row[] {
		const configuration = vscode.workspace.getConfiguration('xit');
		const thresholds = {
			today: todayFrom(new Date()),
			criticalAfterDays: configuration.get<number>('criticallyOverdueAfterDays', 14),
			soonWithinDays: configuration.get<number>('dueSoonWithinDays', 7),
		};

		const found: Row[] = [];

		for (const file of this.index.all()) {
			for (const item of file.items) {
				if (!this.showDone && !isOpen(item)) continue;
				if (applyFilter && !matchesTags(item.tags, this.filter)) continue;
				found.push(new Row(file.uri, item, urgencyOf(item, thresholds)));
			}
		}

		return found;
	}

	getChildren(element?: Element): Element[] {
		if (element instanceof Row) return [];
		if (element instanceof Group) return element.rows;

		const rows = this.rows(true);

		if (this.grouping === 'tag') {
			// Ranked by urgency inside each tag, so the top of a project is the
			// part of it that is late. Sorted before grouping rather than after,
			// because an item under two tags is the same row in both and has to
			// rank the same way in each.
			const ranked = [...rows].sort((a, b) => RANK.get(a.urgency)! - RANK.get(b.urgency)!);
			return byTag(ranked, (row) => row.item.tags)
				.map((group) => new Group(group.tag === UNTAGGED ? 'Untagged' : `#${group.tag}`, group.rows));
		}

		const byUrgency = new Map<Urgency, Row[]>(GROUPS.map((group) => [group.urgency, []]));
		for (const row of rows) byUrgency.get(row.urgency)!.push(row);

		// Empty groups are noise. A group with nothing in it says nothing.
		return GROUPS
			.filter((group) => byUrgency.get(group.urgency)!.length > 0)
			.map((group) => new Group(group.label, byUrgency.get(group.urgency)!));
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

/**
 * The tag picker behind Filter Items by Tag.
 *
 * Multi-select, and accepting it with nothing ticked clears the filter, so the
 * way back out is the same control as the way in.
 */
async function pickTags(provider: Provider): Promise<void> {
	const choices = provider.choices();
	if (choices.length === 0) {
		void vscode.window.showInformationMessage('No tags in this workspace yet.');
		return;
	}

	const selection = provider.selection;
	const picks = choices.map((choice) => ({
		label: choice.tag === UNTAGGED ? 'Untagged' : `#${choice.tag}`,
		description: `${choice.count} item${choice.count === 1 ? '' : 's'}`,
		tag: choice.tag,
		picked: selection?.has(choice.tag) ?? false,
	}));

	const chosen = await vscode.window.showQuickPick(picks, {
		canPickMany: true,
		title: 'Filter items by tag',
		placeHolder: 'Items with any of the tags you pick. Pick none to show everything.',
	});

	// Cancelled, which is not the same as picking nothing.
	if (chosen === undefined) return;

	provider.setFilter(new Set(chosen.map((pick) => pick.tag)));
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

		// A blank panel looks broken. This says which of the several reasons it
		// is - and a filtered panel that is not blank still says what it is
		// filtered to, because a narrowed list that does not admit it is
		// narrowed reads as a complete one with work missing from it.
		const filtered = describeSelection(provider.selection);

		view.message = files.length === 0
			? 'No .xit files in this workspace.'
			: total === 0 ? 'No items in any .xit file yet.'
				: filtered === null ? undefined
					: provider.matched() === 0 ? `${filtered} Nothing matches.` : filtered;
	};

	index.onDidChange(announce);
	announce();

	// The filter and the grouping change what the panel shows without the index
	// changing, so the message has to be rebuilt on those too.
	const refreshed = (run: () => void) => () => {
		run();
		announce();
	};

	const configured = () => vscode.workspace.getConfiguration('xit').get<Grouping>('itemGrouping', 'urgency');
	provider.setGrouping(configured());
	provider.setFilter(null);

	context.subscriptions.push(
		index,
		view,
		// Returns the promise rather than firing and forgetting, so anything
		// that needs the index warm - a test, a command chained after it -
		// can await the command and actually get a refreshed index.
		vscode.commands.registerCommand('xit.refreshItems', () => index.refresh()),
		vscode.commands.registerCommand('xit.toggleDoneItems', () => provider.toggleDone()),
		vscode.commands.registerCommand('xit.filterItemsByTag', async () => {
			await pickTags(provider);
			announce();
		}),
		vscode.commands.registerCommand('xit.clearItemFilter', refreshed(() => provider.setFilter(null))),
		vscode.commands.registerCommand('xit.toggleItemGrouping', refreshed(() => provider.toggleGrouping())),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('xit.itemGrouping')) provider.setGrouping(configured());
		}),
	);

	void index.refresh();

	// Handed back so completion can read the same index rather than building a
	// second one. One reader of the file system, one debounce, one truth.
	return index;
}
