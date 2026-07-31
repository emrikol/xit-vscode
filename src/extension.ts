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
 * its rule through src/dueDate.ts, which a test pins to the grammar so the
 * two cannot part company.
 *
 * A decoration rather than a semantic token provider on purpose. Semantic
 * highlighting is opt-in per theme and can be switched off, so the grammar
 * has to be correct on its own regardless — a provider would never replace
 * it, only duplicate it. A decoration adds a rule the grammar does not have
 * instead of restating one it does.
 */
function registerOverdueDecoration(context: vscode.ExtensionContext) {
	const decoration = vscode.window.createTextEditorDecorationType({
		color: new vscode.ThemeColor('xit.overdueDueDate'),
		// So the marking survives a theme that colours nothing, and so it
		// reads on a screenshot in greyscale.
		fontWeight: 'bold',
	});
	context.subscriptions.push(decoration);

	function enabled() {
		return vscode.workspace.getConfiguration(LANGUAGE).get<boolean>('overdueDueDates', true);
	}

	function refresh(editor: vscode.TextEditor | undefined) {
		if (!editor) return;
		if (editor.document.languageId !== LANGUAGE) return;

		if (!enabled()) {
			editor.setDecorations(decoration, []);
			return;
		}

		// Read through lineAt rather than splitting getText(), so a file with
		// CRLF endings does not leave a stray carriage return on every line.
		const lines: string[] = [];
		for (let line = 0; line < editor.document.lineCount; line++) lines.push(editor.document.lineAt(line).text);

		editor.setDecorations(
			decoration,
			overdue(lines, todayFrom(new Date())).map((date) => ({
				range: new vscode.Range(date.line, date.start, date.line, date.end),
				hoverMessage: `Overdue: ${date.text.slice(3)}`,
			})),
		);
	}

	const refreshAll = () => vscode.window.visibleTextEditors.forEach(refresh);

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(refresh),
		vscode.window.onDidChangeVisibleTextEditors(refreshAll),
		vscode.workspace.onDidChangeTextDocument((event) => {
			for (const editor of vscode.window.visibleTextEditors) {
				if (editor.document === event.document) refresh(editor);
			}
		}),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration(`${LANGUAGE}.overdueDueDates`)) refreshAll();
		}),
		// Midnight. Nothing else here would notice that the day changed under
		// a window that has been open since yesterday, and a list of todos is
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
