import * as vscode from 'vscode';
import { readStatus, writeStatus, toggle, shuffle, Status } from './checkbox';
import { selectedLines } from './selection';
import { overdue, todayFrom } from './dueDate';

const LANGUAGE = 'xit';

function editSelectedCheckboxes(editor: vscode.TextEditor, replacer: (status: Status) => Status) {
	const lines = selectedLines(editor.selections);

	// Returned, not fired and forgotten. `editor.edit` is asynchronous, so a
	// caller that awaits the command would otherwise see the document before
	// the edit landed.
	return editor.edit(builder => {
		for (const line of lines) {
			const text = editor.document.lineAt(line).text;
			const status = readStatus(text);
			if (status === null) continue;
			const range = new vscode.Range(line, 0, line, 3);
			builder.replace(range, writeStatus(text, replacer(status)).slice(0, 3));
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

export function activate(context: vscode.ExtensionContext) {
	registerOverdueDecoration(context);

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
