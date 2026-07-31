import * as vscode from 'vscode';
import { readCheckbox, readStatus, writeStatus, toggle, shuffle, Status } from './checkbox';
import { selectedLines } from './selection';
import { cascade } from './tree';
import { outline, Node } from './outline';
import { folds } from './folding';
import { stamp, isTagName } from './stamp';
import { nextOccurrence, parseInterval, postpone } from './repeat';
import { dueDatesOn } from './dueDate';
import { problems, Severity } from './diagnostics';
import { migrate } from './migrate';
import { sortGroup } from './sort';
import { archive } from './archive';
import { AFTER_TAG, ID_TAG, dependencies, foldId, freshId, identities } from './link';
import { registerWorkspaceView } from './workspaceView';
import { WorkspaceIndex } from './workspaceIndex';
import { commonSpelling, foldName, tagsOn } from './tag';
import { commentLines } from './comment';
import { overdue, todayFrom } from './dueDate';

const LANGUAGE = 'xit';

/** Settings that shape what a toggle does beyond changing the checkbox. */
function editSettings() {
	const configuration = vscode.workspace.getConfiguration(LANGUAGE);
	const tag = configuration.get<string>('completionDateTag', 'done');

	return {
		autoCheckParents: configuration.get<boolean>('autoCheckParents', true),
		repeatItems: configuration.get<boolean>('repeatItems', true),
		repeatTag: isTagName(configuration.get<string>('repeatTag', 'repeat')) ? configuration.get<string>('repeatTag', 'repeat') : 'repeat',
		stampCompletionDate: configuration.get<boolean>('stampCompletionDate', false),
		// Fall back rather than write a tag the format cannot express. A
		// hand-edited setting should not be able to corrupt the file.
		completionDateTag: isTagName(tag) ? tag : 'done',
	};
}

function editSelectedCheckboxes(editor: vscode.TextEditor, replacer: (status: Status) => Status) {
	const document = editor.document;
	const settings = editSettings();

	// The document as it will read once everything is applied. Built up in
	// full first, then written in one edit: the cascade has to reason about
	// the change the user just made rather than about the text on disk, and
	// applying the steps separately would fire a document change per step.
	const before: string[] = [];
	for (let line = 0; line < document.lineCount; line++) before.push(document.lineAt(line).text);

	const after = [...before];
	const edited: number[] = [];

	for (const line of selectedLines(editor.selections)) {
		const checkbox = readCheckbox(after[line]);
		if (!checkbox) continue;
		after[line] = writeStatus(after[line], replacer(checkbox.status));
		edited.push(line);
	}

	if (settings.autoCheckParents) {
		for (const [line, status] of cascade(after, edited)) {
			after[line] = writeStatus(after[line], status);
			edited.push(line);
		}
	}

	// Worked out before stamping, so the new occurrence does not inherit a
	// completion date for work nobody has done yet.
	const repeats = new Map<number, string>();

	if (settings.repeatItems) {
		for (const line of edited) {
			if (readCheckbox(before[line])?.status === 'x') continue;
			if (readCheckbox(after[line])?.status !== 'x') continue;

			const [due] = dueDatesOn(after[line]);
			// Today is passed in rather than read inside, so `#repeat=+7d`
			// can count from the day it was checked and the whole of
			// src/repeat.ts stays testable without a clock.
			const next = nextOccurrence(after[line], settings.repeatTag, due ?? null, todayFrom(new Date()));
			if (next) repeats.set(line, next);
		}
	}

	if (settings.stampCompletionDate) {
		const today = todayFrom(new Date());

		for (const line of edited) {
			const was = readCheckbox(before[line])?.status;
			const now = readCheckbox(after[line])?.status;
			if (was === now) continue;

			// Only on the way in and out of checked. Every other status change
			// says nothing about when the item was completed.
			if (now === 'x') after[line] = stamp(after[line], settings.completionDateTag, today);
			else if (was === 'x') after[line] = stamp(after[line], settings.completionDateTag, null);
		}
	}

	// Returned, not fired and forgotten. `editor.edit` is asynchronous, so a
	// caller that awaits the command would otherwise see the document before
	// the edit landed.
	return editor.edit(builder => {
		for (const line of new Set(edited)) {
			if (after[line] === before[line]) continue;
			builder.replace(document.lineAt(line).range, after[line]);
		}

		// Positions are all against the document as it is now, which is what
		// TextEditorEdit expects, so inserting does not disturb the replaces.
		for (const [line, text] of repeats) {
			builder.insert(document.lineAt(line).range.end, `\n${text}`);
		}
	});
}

function selectionHasCheckboxes(editor: vscode.TextEditor) {
	for (const line of selectedLines(editor.selections)) {
		if (readStatus(editor.document.lineAt(line).text) !== null) return true;
	}

	return false;
}

/**
 * Register a command that needs a text editor.
 *
 * The commands are contributed to the command palette, so they can be invoked
 * with no editor focused at all. Reaching for `activeTextEditor!` in that case
 * threw a TypeError.
 */
function registerEditorCommand(
	context: vscode.ExtensionContext,
	command: string,
	run: (editor: vscode.TextEditor) => unknown,
) {
	context.subscriptions.push(vscode.commands.registerCommand(command, () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return;
		return run(editor);
	}));
}

/**
 * Record when an item was created, as a tag.
 *
 * jotaen's own example in discussion #59 is `#created=… #completed=…`, and
 * only half of it was built. With both, an item records its own cycle time.
 *
 * The hard part is deciding when an item is *new*. The obvious hook - any
 * change that leaves a line holding a checkbox - stamps a pasted block with
 * today, re-stamps on undo, and fires when a line is merely moved. A wrong
 * date is worse than no date, so the trigger is narrowed until it is only
 * true of a checkbox someone just finished typing:
 *
 *   - one content change, so a multi-line paste never qualifies;
 *   - not undo or redo, which VS Code tells us through `reason`;
 *   - the change touched the checkbox itself, not the description;
 *   - the line holds a checkbox now and carries no created tag yet.
 *
 * What that gives up is deliberate and documented: pasting items does not
 * stamp them, and neither does a file arriving on disk. Both are cases where
 * "created" would be a lie.
 *
 * Off by default, like the completion date.
 */
function registerCreationDate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(async (event) => {
		const document = event.document;
		if (document.languageId !== LANGUAGE) return;

		const configuration = vscode.workspace.getConfiguration(LANGUAGE);
		if (!configuration.get<boolean>('stampCreationDate', false)) return;

		// Undo and redo are the user putting the file back, not writing an
		// item. Stamping there would fight them.
		if (event.reason !== undefined) return;
		if (event.contentChanges.length !== 1) return;

		const [change] = event.contentChanges;
		if (change.text.includes('\n')) return;

		const line = change.range.start.line;
		if (line >= document.lineCount) return;

		const text = document.lineAt(line).text;
		const checkbox = readCheckbox(text);
		if (!checkbox) return;

		// The change has to have touched the checkbox. Typing in a description
		// is not creating an item.
		if (change.range.start.character > checkbox.column + 3) return;

		const tag = configuration.get<string>('creationDateTag', 'created');
		const name = isTagName(tag) ? tag : 'created';
		if (tagsOn(text).some((found) => found.key === foldName(name))) return;
		if (commentLines(documentLines(document)).has(line)) return;

		const stamped = stamp(text, name, todayFrom(new Date()));
		if (stamped === text) return;

		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document !== document) return;

		await editor.edit(builder => builder.replace(document.lineAt(line).range, stamped), {
			// Its own undo step, so one Ctrl+Z takes the stamp off and leaves
			// the item you just typed alone.
			undoStopBefore: true,
			undoStopAfter: false,
		});
	}));
}

/** Every line of a document, which several things here need. */
function documentLines(document: vscode.TextDocument): string[] {
	const lines: string[] = [];
	for (let line = 0; line < document.lineCount; line++) lines.push(document.lineAt(line).text);
	return lines;
}

/**
 * Complete tag names and values from the whole workspace.
 *
 * `tagUsage` had been written and tested and wired to nothing, and the
 * internal `xit.suggest` command opened VS Code's suggest widget with nothing
 * behind it. This is what goes behind it.
 *
 * Drawn from the workspace index rather than the open document, so a tag
 * invented in one file is offered in every other. That is the thing that makes
 * tags worth using across a workspace instead of decaying into near-duplicates
 * nobody can group by.
 *
 * Names fold case and values do not - spec §Tag - so a name written `#Work`
 * and `#work` is offered once, spelled whichever way is commoner, while
 * `#size=S` and `#size=s` are two different values and both are offered.
 */
function registerCompletion(context: vscode.ExtensionContext, index: WorkspaceIndex) {
	context.subscriptions.push(vscode.languages.registerCompletionItemProvider(LANGUAGE, {
		provideCompletionItems(document, position) {
			const upToCursor = document.lineAt(position.line).text.slice(0, position.character);
			const usage = index.tags();

			// After `#name=`, the values that name has been given.
			const value = /#([\p{L}\d_-]+)=([\p{L}\d_-]*)$/u.exec(upToCursor);
			if (value) {
				const found = usage.get(foldName(value[1]));
				if (!found) return [];

				return [...found.values].sort().map((text) => {
					const item = new vscode.CompletionItem(text, vscode.CompletionItemKind.Value);
					item.detail = `#${value[1]}`;
					return item;
				});
			}

			// After `#`, the names in use. The `#` is already typed, so the
			// insert text is the name alone or it would be doubled.
			if (!/#[\p{L}\d_-]*$/u.test(upToCursor)) return [];

			return [...usage.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, found]) => {
				const spelling = commonSpelling(found);
				const item = new vscode.CompletionItem(spelling, vscode.CompletionItemKind.Keyword);
				// Sorted and filtered by the folded name, so typing `#WOR`
				// still finds a tag written `#work`.
				item.filterText = key;
				item.sortText = key;
				item.detail = found.values.size > 0
					? `${found.values.size} value${found.values.size === 1 ? '' : 's'} in use`
					: undefined;
				return item;
			});
		},
	}, '#', '='));
}

/**
 * Give the item under the cursor an id, so another can wait on it.
 *
 * Generated rather than derived from anything positional. An id has to survive
 * a re-sort and a move between files, and both sorting a group and archiving
 * finished items rewrite lines - either would break every reference in the
 * file if the id were a line number or a hash of its surroundings.
 *
 * The id is put on the clipboard as `#after=…`, because the next thing anyone
 * does after making one is paste a reference to it.
 */
async function giveIdToItem(editor: vscode.TextEditor) {
	if (editor.document.languageId !== LANGUAGE) return;

	const line = editor.selection.active.line;
	const text = editor.document.lineAt(line).text;
	if (!readCheckbox(text)) return;

	const existing = tagsOn(text).find((tag) => tag.key === ID_TAG);
	if (existing?.value) {
		await vscode.env.clipboard.writeText(`#${AFTER_TAG}=${existing.value}`);
		void vscode.window.showInformationMessage(`This item is already \`${existing.value}\`. Copied #${AFTER_TAG}=${existing.value}.`);
		return;
	}

	const id = freshId(documentLines(editor.document));
	await editor.edit(builder => builder.insert(editor.document.lineAt(line).range.end, ` #${ID_TAG}=${id}`));
	await vscode.env.clipboard.writeText(`#${AFTER_TAG}=${id}`);

	void vscode.window.showInformationMessage(`Gave this item the id \`${id}\`. Copied #${AFTER_TAG}=${id}.`);
}

/**
 * Make `#after=` clickable, so a reference goes to what it waits on.
 *
 * `#after=k3f9` is this file; `#after="work-todo.xit#k3f9"` is that one. Both
 * resolve through the workspace index, which has already read every `.xit`, so
 * a cross-file link works without opening anything.
 *
 * Naming the file beats making ids unique across the workspace. Nothing
 * generates or enforces that uniqueness, so a global namespace works right up
 * until two files collide and is then silently wrong; an explicit filename
 * cannot be.
 */
function registerLinks(context: vscode.ExtensionContext, index: WorkspaceIndex) {
	context.subscriptions.push(vscode.languages.registerDocumentLinkProvider(LANGUAGE, {
		provideDocumentLinks(document) {
			const lines = documentLines(document);
			// A reference to this file is answered from this file. Going
			// through the index for it would fail on anything the index has
			// not read - an untitled buffer, a file outside the workspace -
			// which is exactly where you are most likely to be writing one.
			const here = new Map(identities(lines).map((each) => [foldId(each.id), each.line]));

			return dependencies(lines).flatMap((each) => {
				const target = each.on.file === null
					? nullable(here.get(foldId(each.on.id)), (line) => ({ uri: document.uri, line }))
					: index.resolve(document.uri, each.on);
				if (!target) return [];

				const link = new vscode.DocumentLink(new vscode.Range(each.line, each.tag.start, each.line, each.tag.end));
				link.target = target.uri.with({ fragment: `L${target.line + 1}` });
				link.tooltip = each.on.file === null
					? 'Go to the item this waits on'
					: `Go to ${each.on.file}, line ${target.line + 1}`;
				return [link];
			});
		},
	}));
}

/** Apply `then` to a value that may be undefined, which reads better than a ternary here. */
function nullable<T, R>(value: T | undefined, then: (value: T) => R): R | null {
	return value === undefined ? null : then(value);
}

/**
 * Problems a single document cannot see: a reference to another file.
 *
 * src/link.ts is pure and skips these deliberately - it does not know which
 * files exist. This is the layer that does, so this is where they are said.
 */
function crossFileProblems(document: vscode.TextDocument, index: WorkspaceIndex): vscode.Diagnostic[] {
	return dependencies(documentLines(document)).flatMap((each) => {
		if (each.on.file === null) return [];
		if (index.resolve(document.uri, each.on)) return [];

		const diagnostic = new vscode.Diagnostic(
			new vscode.Range(each.line, each.tag.start, each.line, each.tag.end),
			`Nothing in \`${each.on.file}\` has the id \`${each.on.id}\`, or that file is not in this workspace.`,
			vscode.DiagnosticSeverity.Warning,
		);
		diagnostic.code = 'unknown-id';
		diagnostic.source = LANGUAGE;
		return [diagnostic];
	});
}

/**
 * Move every finished item to a group at the end of the file.
 *
 * One edit in one document, so undo puts it back exactly. That is why it goes
 * to the end of this file rather than to a separate `done.xit`: the file still
 * grows, and in exchange nothing reaches a second document that the user
 * cannot take back with a keystroke.
 */
async function archiveFinished(editor: vscode.TextEditor) {
	if (editor.document.languageId !== LANGUAGE) return;

	const configuration = vscode.workspace.getConfiguration(LANGUAGE);
	const before = documentLines(editor.document);
	const { lines: after, moved } = archive(before, configuration.get<string>('archiveTitle', 'Archive'));

	if (moved === 0) {
		void vscode.window.showInformationMessage('Nothing to archive: no finished items outside the archive.');
		return;
	}

	const last = editor.document.lineCount - 1;
	const whole = new vscode.Range(0, 0, last, editor.document.lineAt(last).text.length);
	await editor.edit(builder => builder.replace(whole, after.join('\n')));

	void vscode.window.showInformationMessage(
		`Archived ${moved === 1 ? '1 item' : `${moved} items`}. Undo puts it back.`);
}

/**
 * Sort the group the cursor is in, by priority and then by due date.
 *
 * The reordering is src/sort.ts, which moves blocks rather than lines: a
 * subtask travels with its parent and so does every description continuation.
 *
 * One edit for the whole group, so undo takes it back in one step. The
 * cursor's group is the unit rather than the whole file, because a group is
 * the unit the format already has.
 */
async function sortGroupAtCursor(editor: vscode.TextEditor) {
	if (editor.document.languageId !== LANGUAGE) return;

	const before = documentLines(editor.document);
	const after = sortGroup(before, editor.selection.active.line);

	if (after.every((text, line) => text === before[line])) {
		void vscode.window.showInformationMessage('This group is already in order.');
		return;
	}

	const last = editor.document.lineCount - 1;
	const whole = new vscode.Range(0, 0, last, editor.document.lineAt(last).text.length);
	await editor.edit(builder => builder.replace(whole, after.join('\n')));
}

/** What the postpone picker offers, in the order it offers them. */
const POSTPONE_TO: { label: string; detail: string; interval: string }[] = [
	{ label: 'Tomorrow', detail: 'one day from today', interval: '1d' },
	{ label: 'In three days', detail: 'three days from today', interval: '3d' },
	{ label: 'Next week', detail: 'seven days from today', interval: '1w' },
	{ label: 'Next Monday', detail: 'the next Monday after today', interval: 'monday' },
	{ label: 'Next month', detail: 'one month from today', interval: '1m' },
];

/**
 * Push the due date of the selected items forward.
 *
 * The arithmetic is src/repeat.ts, which already knows how to move every date
 * pattern the format has and keep the one it was written in - so a
 * month-precision date postponed by a week becomes the next month rather than
 * a day inside it.
 *
 * One `edit` for the whole selection, so undo takes all of it back together.
 * Items with no due date are left alone rather than given one, which is the
 * same restraint an unrecognised repeat interval already shows.
 */
async function postponeSelected(editor: vscode.TextEditor) {
	if (editor.document.languageId !== 'xit') return;

	const lines = selectedLines(editor.selections)
		.filter((line) => readCheckbox(editor.document.lineAt(line).text));
	if (lines.length === 0) return;

	const picked = await vscode.window.showQuickPick(POSTPONE_TO, {
		title: lines.length === 1 ? 'Postpone until' : `Postpone ${lines.length} items until`,
		placeHolder: 'Items with no due date are left alone',
	});
	if (!picked) return;

	const interval = parseInterval(picked.interval)!;
	const today = todayFrom(new Date());

	const edits = new Map<number, string>();
	for (const line of lines) {
		const moved = postpone(editor.document.lineAt(line).text, interval, today);
		if (moved !== null) edits.set(line, moved);
	}

	if (edits.size === 0) {
		void vscode.window.showInformationMessage('Nothing to postpone: none of the selected items has a due date.');
		return;
	}

	await editor.edit(builder => {
		for (const [line, text] of edits) {
			builder.replace(editor.document.lineAt(line).range, text);
		}
	});
}

/**
 * Bring the open document up to the current rules.
 *
 * Three forks changed what an existing file means - tab nesting, marked
 * titles, priority without dots - and this applies all three at once, because
 * three passes over the same files would be worse than any of them.
 *
 * One `edit` for the whole document, so the editor's own undo puts it back
 * exactly as it was. That is the safety here: nothing is written to disk that
 * the user cannot take back with a keystroke, which is why this works on the
 * active file rather than the whole workspace.
 *
 * The transforms are in src/migrate.ts, and every one of them is idempotent -
 * running this twice does nothing the second time.
 */
async function migrateDocument(editor: vscode.TextEditor) {
	if (editor.document.languageId !== 'xit') return;

	const before: string[] = [];
	for (let line = 0; line < editor.document.lineCount; line++) before.push(editor.document.lineAt(line).text);

	const { lines, changes } = migrate(before);
	if (changes.length === 0) {
		void vscode.window.showInformationMessage('This file already uses the current rules.');
		return;
	}

	const whole = new vscode.Range(0, 0, editor.document.lineCount - 1, editor.document.lineAt(editor.document.lineCount - 1).text.length);
	const written = await editor.edit(builder => builder.replace(whole, lines.join('\n')));

	if (!written) {
		void vscode.window.showWarningMessage('Nothing was changed: the document could not be edited.');
		return;
	}

	// Say what happened. A migration that reports nothing is one you have to
	// diff to trust.
	const count = changes.length === 1 ? '1 line' : `${changes.length} lines`;
	void vscode.window.showInformationMessage(`Migrated ${count}. Undo puts it back.`);
}

/**
 * Colour due dates whose period has passed.
 *
 * The only thing here that a TextMate grammar cannot do, because it needs to
 * know what today is. Everything structural stays in the grammar; this reuses
 * its rule through src/dueDate.ts, which a test pins to the grammar so the two
 * cannot part company.
 *
 * A decoration rather than a semantic token provider on purpose. Semantic
 * highlighting is opt-in per theme and can be switched off, so the grammar has
 * to be correct on its own regardless — a provider would never replace it,
 * only duplicate it. A decoration adds a rule the grammar does not have
 * instead of restating one it does.
 */

/** How an overdue date is marked. */
const STYLES = ['border-and-background', 'background', 'border', 'underline'] as const;
type Style = (typeof STYLES)[number];

/** The colours each severity draws with. */
const TIERS = {
	overdue: {
		background: 'xit.overdueDueDateBackground',
		foreground: 'xit.overdueDueDateForeground',
		border: 'xit.overdueDueDateBorder',
	},
	critical: {
		background: 'xit.criticallyOverdueDueDateBackground',
		foreground: 'xit.criticallyOverdueDueDateForeground',
		border: 'xit.criticallyOverdueDueDateBorder',
	},
} as const;

type Tier = keyof typeof TIERS;

/** The CSS variable VS Code publishes a contributed colour as. */
function cssVariable(id: string) {
	return `var(--vscode-${id.replace(/\./g, '-')})`;
}

function renderOptions(style: Style, tier: Tier): vscode.DecorationRenderOptions {
	const colours = TIERS[tier];
	const options: vscode.DecorationRenderOptions = {};

	// Background and foreground move together, always. This is the whole
	// lesson of the first attempt: painting a background while letting the
	// theme keep choosing the text colour pairs two colours that have never
	// met. Monokai puts #AE81FF on it and the contrast falls from 5.23:1 to
	// 2.73:1. Owning both sides fixes it by construction, in every theme,
	// including ones written after this. Owning neither is equally safe, which
	// is why the border and underline styles set no colours at all.
	if (style === 'background' || style === 'border-and-background') {
		options.backgroundColor = new vscode.ThemeColor(colours.background);
		options.color = new vscode.ThemeColor(colours.foreground);
	}

	if (style === 'border' || style === 'border-and-background') {
		options.border = '1px solid';
		options.borderColor = new vscode.ThemeColor(colours.border);
	}

	if (style === 'background' || style === 'border' || style === 'border-and-background') {
		options.borderRadius = '3px';
	}

	if (style === 'underline') {
		// textDecoration is raw CSS, so a ThemeColor object is no use here.
		// VS Code publishes every contributed colour as a CSS variable on the
		// workbench, which is what this reaches for.
		options.textDecoration = `underline solid 2px ${cssVariable(colours.border)}`;
	}

	if (tier === 'critical') {
		// The second cue, and it is not decoration either. Amber and red are
		// chosen to weigh the same, which is what makes them look like one
		// family - but it also leaves 1.42:1 of luminance between them, so
		// hue is all that separates them, and red against amber is the pair
		// that red-green colour blindness collapses. WCAG SC 1.4.1: colour
		// must not be the only visual means of conveying information. Weight
		// is the cue that survives, and it survives in every style, including
		// the two that draw no fill at all.
		options.fontWeight = 'bold';
	}

	return options;
}

function registerOverdueDecoration(context: vscode.ExtensionContext) {
	let decorations: Record<Tier, vscode.TextEditorDecorationType> | null = null;
	let drawnWith: Style | null = null;

	function settings() {
		const configuration = vscode.workspace.getConfiguration(LANGUAGE);
		const style = configuration.get<string>('overdueDueDateStyle', 'border-and-background');

		return {
			enabled: configuration.get<boolean>('overdueDueDates', true),
			// Fall back rather than throw: a hand-edited settings.json should
			// not leave the extension drawing nothing with no explanation.
			style: (STYLES as readonly string[]).includes(style) ? (style as Style) : 'border-and-background',
			criticalAfterDays: configuration.get<number>('criticallyOverdueAfterDays', 14),
		};
	}

	/** Decoration types for the current style, rebuilt only when it changes. */
	function decorationsFor(style: Style) {
		if (decorations && drawnWith === style) return decorations;

		// A decoration type's appearance is fixed when it is created, so
		// changing the style means throwing the old ones away. Leaving them
		// undisposed would leave their marks on screen for ever.
		if (decorations) for (const type of Object.values(decorations)) type.dispose();

		decorations = {
			overdue: vscode.window.createTextEditorDecorationType(renderOptions(style, 'overdue')),
			critical: vscode.window.createTextEditorDecorationType(renderOptions(style, 'critical')),
		};
		drawnWith = style;
		return decorations;
	}

	function refresh(editor: vscode.TextEditor | undefined) {
		if (!editor) return;
		if (editor.document.languageId !== LANGUAGE) return;

		const { enabled, style, criticalAfterDays } = settings();
		const types = decorationsFor(style);

		if (!enabled) {
			for (const type of Object.values(types)) editor.setDecorations(type, []);
			return;
		}

		// Read through lineAt rather than splitting getText(), so a file with
		// CRLF endings does not leave a stray carriage return on every line.
		const lines: string[] = [];
		for (let line = 0; line < editor.document.lineCount; line++) lines.push(editor.document.lineAt(line).text);

		const marks: Record<Tier, vscode.DecorationOptions[]> = { overdue: [], critical: [] };

		for (const date of overdue(lines, todayFrom(new Date()))) {
			// A threshold of zero or less turns the second tier off rather
			// than making everything critical, which is what a user typing 0
			// into the setting almost certainly means.
			const critical = criticalAfterDays > 0 && date.daysLate >= criticalAfterDays;
			const days = date.daysLate === 1 ? '1 day' : `${date.daysLate} days`;

			marks[critical ? 'critical' : 'overdue'].push({
				range: new vscode.Range(date.line, date.start, date.line, date.end),
				hoverMessage: `${critical ? 'Critically overdue' : 'Overdue'} by ${days}.`,
			});
		}

		for (const tier of Object.keys(marks) as Tier[]) editor.setDecorations(types[tier], marks[tier]);
	}

	const refreshAll = () => vscode.window.visibleTextEditors.forEach(refresh);

	context.subscriptions.push(
		{ dispose: () => decorations && Object.values(decorations).forEach((type) => type.dispose()) },
		vscode.window.onDidChangeActiveTextEditor(refresh),
		vscode.window.onDidChangeVisibleTextEditors(refreshAll),
		vscode.workspace.onDidChangeTextDocument((event) => {
			for (const editor of vscode.window.visibleTextEditors) {
				if (editor.document === event.document) refresh(editor);
			}
		}),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration(LANGUAGE)) refreshAll();
		}),
		// Midnight. Nothing else here would notice that the day changed under a
		// window that has been open since yesterday, and a list of todos is
		// exactly the sort of thing left open overnight.
		vscode.window.onDidChangeWindowState((state) => {
			if (state.focused) refreshAll();
		}),
	);

	refreshAll();
}

/**
 * Fill the Outline panel, Go to Symbol and the breadcrumbs.
 *
 * All three come from one provider. The structure is src/outline.ts, which is
 * the same tree the subtask nesting is built on - the panel showing subtasks
 * under their parents is the payoff for that rather than extra work.
 */
function registerOutline(context: vscode.ExtensionContext) {
	const toSymbol = (node: Node): vscode.DocumentSymbol => {
		const symbol = new vscode.DocumentSymbol(
			node.name,
			node.detail,
			// There is no checkbox kind, and mapping each status onto some
			// unrelated kind for the sake of different icons would put an Enum
			// icon beside an obsolete item and explain nothing. One kind for
			// items, one for titles; the status is in the name, where it reads
			// without relying on an icon or a colour.
			node.kind === 'title' ? vscode.SymbolKind.Namespace : vscode.SymbolKind.Boolean,
			// The full extent, so collapsing in the panel collapses the item
			// with its subtasks and continuations...
			new vscode.Range(node.line, 0, node.endLine, Number.MAX_SAFE_INTEGER),
			// ...but clicking selects only the checkbox, or the title itself.
			new vscode.Range(node.line, node.selectionStart, node.line, node.selectionEnd),
		);

		symbol.children = node.children.map(toSymbol);
		return symbol;
	};

	context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(
		{ language: LANGUAGE },
		{
			provideDocumentSymbols(document) {
				const lines: string[] = [];
				for (let line = 0; line < document.lineCount; line++) lines.push(document.lineAt(line).text);
				return outline(lines).map(toSymbol);
			},
		},
	));
}

/**
 * Collapse an item with its subtasks, a group, or a comment block.
 *
 * VS Code folds by indentation with no provider at all, and folds this format
 * wrong: it cannot tell a description continuation from a subtask, it does not
 * know that a blank line ends an item, and it has never heard of `<!--`.
 */
function registerFolding(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.languages.registerFoldingRangeProvider(
		{ language: LANGUAGE },
		{
			provideFoldingRanges(document) {
				const lines: string[] = [];
				for (let line = 0; line < document.lineCount; line++) lines.push(document.lineAt(line).text);

				return folds(lines).map((fold) => new vscode.FoldingRange(
					fold.start,
					fold.end,
					// Comment is the only kind VS Code has that fits. An item
					// and a group are neither imports nor a region, and
					// claiming otherwise would put them under "Fold All
					// Regions", which is not what anyone means by it.
					fold.kind === 'comment' ? vscode.FoldingRangeKind.Comment : undefined,
				));
			},
		},
	));
}

/**
 * Report the rules the grammar cannot express.
 *
 * Chiefly one specification MUST - "The due date value MUST be representable
 * by the gregorian calendar" - which no regular expression can check, because
 * counting the days in February is not something they do.
 */
function registerDiagnostics(context: vscode.ExtensionContext, index: WorkspaceIndex) {
	const collection = vscode.languages.createDiagnosticCollection(LANGUAGE);
	context.subscriptions.push(collection);

	const SEVERITY: Record<Severity, vscode.DiagnosticSeverity> = {
		error: vscode.DiagnosticSeverity.Error,
		warning: vscode.DiagnosticSeverity.Warning,
		hint: vscode.DiagnosticSeverity.Hint,
	};

	function check(document: vscode.TextDocument) {
		if (document.languageId !== LANGUAGE) return;

		if (!vscode.workspace.getConfiguration(LANGUAGE).get<boolean>('diagnostics', true)) {
			collection.delete(document.uri);
			return;
		}

		const lines: string[] = [];
		for (let line = 0; line < document.lineCount; line++) lines.push(document.lineAt(line).text);

		const found = problems(lines).map((problem) => {
			const diagnostic = new vscode.Diagnostic(
				new vscode.Range(problem.line, problem.start, problem.line, problem.end),
				problem.message,
				SEVERITY[problem.severity],
			);
			diagnostic.source = 'xit';
			diagnostic.code = problem.code;
			return diagnostic;
		});

		// A reference to another file is skipped by the pure checker, which
		// does not know what files exist. This layer does.
		collection.set(document.uri, [...found, ...crossFileProblems(document, index)]);
	}

	const checkAll = () => vscode.workspace.textDocuments.forEach(check);

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(check),
		vscode.workspace.onDidChangeTextDocument((event) => check(event.document)),
		// Otherwise a closed document's problems stay in the panel for ever.
		vscode.workspace.onDidCloseTextDocument((document) => collection.delete(document.uri)),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration(`${LANGUAGE}.diagnostics`)) checkAll();
		}),
	);

	checkAll();
}

export function activate(context: vscode.ExtensionContext) {

	const index = registerWorkspaceView(context);
	registerCompletion(context, index);
	registerLinks(context, index);
	registerDiagnostics(context, index);
	registerCreationDate(context);

	registerOverdueDecoration(context);
	registerOutline(context);
	registerFolding(context);

	registerEditorCommand(context, 'xit.migrate', editor => migrateDocument(editor));

	registerEditorCommand(context, 'xit.postpone', editor => postponeSelected(editor));

	registerEditorCommand(context, 'xit.sortGroup', editor => sortGroupAtCursor(editor));

	registerEditorCommand(context, 'xit.archive', editor => archiveFinished(editor));

	registerEditorCommand(context, 'xit.giveId', editor => giveIdToItem(editor));

	registerEditorCommand(context, 'xit.toggle', editor => editSelectedCheckboxes(editor, toggle));

	registerEditorCommand(context, 'xit.shuffle', editor => editSelectedCheckboxes(editor, shuffle));

	registerEditorCommand(context, 'xit.suggest', editor => {
		if (selectionHasCheckboxes(editor))
			return vscode.commands.executeCommand('xit.toggle');
		else
			return vscode.commands.executeCommand('editor.action.triggerSuggest');
	});
}

export function deactivate() { }
