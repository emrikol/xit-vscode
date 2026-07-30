import * as vscode from 'vscode';
import { readStatus, writeStatus, toggle, shuffle, Status } from './checkbox';
import { selectedLines } from './selection';

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

export function activate(context: vscode.ExtensionContext) {
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
