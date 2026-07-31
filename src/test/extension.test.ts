/**
 * Integration tests. These run inside a real Extension Development Host, so
 * they exercise the parts the unit tests cannot reach: activation, command
 * registration, and the edits themselves.
 *
 * They run in both hosts, from the same source: `npm run test:web` in a
 * headless browser, `npm run test:integration` in desktop Electron. Nothing
 * here may assume Node. No require(), no fs, no path, no process. See
 * ./manifest.ts for the one place that used to.
 *
 * They are not part of `npm test`, which stays fast enough for every commit.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';

import { COMMANDS, EXTENSION_ID } from './manifest';

/** Open a scratch xit document and put the cursor on it. */
async function openXit(content: string): Promise<vscode.TextEditor> {
	const document = await vscode.workspace.openTextDocument({ language: 'xit', content });
	return vscode.window.showTextDocument(document);
}

function at(line: number): vscode.Selection {
	return new vscode.Selection(line, 0, line, 0);
}

describe('activation', () => {
	it('finds itself installed', () => {
		assert.ok(vscode.extensions.getExtension(EXTENSION_ID), `${EXTENSION_ID} is not loaded`);
	});

	it('activates on demand', async () => {
		// Note what this does NOT assert: that opening an xit file activates
		// the extension. It does not, and should not. The grammar, the
		// snippets and the language configuration are all declarative, so
		// nothing has to run to open a file. VS Code infers onCommand from
		// contributes.commands, and that is the only thing that wakes it.
		const extension = vscode.extensions.getExtension(EXTENSION_ID)!;
		await extension.activate();
		assert.ok(extension.isActive);
	});

	it('registers every command it contributes', async () => {
		await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
		const registered = await vscode.commands.getCommands(true);
		for (const command of COMMANDS) {
			assert.ok(registered.includes(command), `${command} is not registered`);
		}
	});
});

describe('language association', () => {
	it('recognises a .xit file in the workspace', async () => {
		const [found] = await vscode.workspace.findFiles('**/*.xit', undefined, 1);
		assert.ok(found, 'no .xit file in the test workspace');
		const document = await vscode.workspace.openTextDocument(found);
		assert.equal(document.languageId, 'xit');
	});
});

describe('xit.toggle', () => {
	it('checks an open item', async () => {
		const editor = await openXit('[ ] Do this');
		editor.selection = at(0);
		await vscode.commands.executeCommand('xit.toggle');
		assert.equal(editor.document.lineAt(0).text, '[x] Do this');
	});

	it('opens a checked item', async () => {
		const editor = await openXit('[x] Do this');
		editor.selection = at(0);
		await vscode.commands.executeCommand('xit.toggle');
		assert.equal(editor.document.lineAt(0).text, '[ ] Do this');
	});

	it('leaves the description alone', async () => {
		const editor = await openXit('[ ] ! Do this -> 2026-08-14 #tag="a value"');
		editor.selection = at(0);
		await vscode.commands.executeCommand('xit.toggle');
		assert.equal(editor.document.lineAt(0).text, '[x] ! Do this -> 2026-08-14 #tag="a value"');
	});

	it('changes every selected line', async () => {
		const editor = await openXit('[ ] One\n[ ] Two\n[ ] Three');
		editor.selection = new vscode.Selection(0, 0, 2, 0);
		await vscode.commands.executeCommand('xit.toggle');
		assert.deepEqual(
			editor.document.getText().split('\n'),
			['[x] One', '[x] Two', '[x] Three'],
		);
	});

	it('skips lines that are not items', async () => {
		const editor = await openXit('A title\n[ ] An item\n\nNot an item');
		editor.selection = new vscode.Selection(0, 0, 3, 0);
		await vscode.commands.executeCommand('xit.toggle');
		assert.deepEqual(
			editor.document.getText().split('\n'),
			['A title', '[x] An item', '', 'Not an item'],
		);
	});
});

describe('xit.shuffle', () => {
	it('walks the whole cycle and comes back', async () => {
		const editor = await openXit('[ ] Do this');
		editor.selection = at(0);

		const seen = [editor.document.lineAt(0).text.slice(0, 3)];
		for (let i = 0; i < 5; i++) {
			await vscode.commands.executeCommand('xit.shuffle');
			seen.push(editor.document.lineAt(0).text.slice(0, 3));
		}

		assert.deepEqual(seen, ['[ ]', '[@]', '[~]', '[?]', '[x]', '[ ]']);
	});
});

describe('commands with no editor', () => {
	it('do nothing rather than throw', async () => {
		// The commands are in the command palette, so they can be invoked
		// with nothing open at all. This used to reach for activeTextEditor!
		// and throw a TypeError.
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		assert.equal(vscode.window.activeTextEditor, undefined);

		await vscode.commands.executeCommand('xit.toggle');
		await vscode.commands.executeCommand('xit.shuffle');
		await vscode.commands.executeCommand('xit.suggest');
	});
});
