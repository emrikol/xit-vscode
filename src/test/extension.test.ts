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
		const extension = vscode.extensions.getExtension(EXTENSION_ID)!;
		await extension.activate();
		assert.ok(extension.isActive);
	});

	it('wakes when an xit file is opened', async () => {
		// This used to assert the opposite, and the comment explaining why was
		// right at the time: the grammar, the snippets and the language
		// configuration are all declarative, so nothing had to run to open a
		// file, and the only thing that woke the extension was a command.
		//
		// Overdue due dates changed that. Colouring a date that has passed
		// needs to know what today is, so it needs code, so the extension now
		// declares onLanguage:xit and is running whenever an xit file is open.
		const document = await vscode.workspace.openTextDocument({ language: 'xit', content: '[ ] Do this' });
		await vscode.window.showTextDocument(document);
		assert.ok(vscode.extensions.getExtension(EXTENSION_ID)!.isActive);
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

describe('subtasks', () => {
	it('toggles an indented checkbox without losing its indentation', async () => {
		const editor = await openXit('[ ] Parent\n  [ ] Child');
		editor.selection = at(1);
		await vscode.commands.executeCommand('xit.toggle');
		assert.equal(editor.document.lineAt(1).text, '  [x] Child');
	});

	it('checks the parent once its last child is checked', async () => {
		const editor = await openXit('[ ] Parent\n  [x] One\n  [ ] Two');
		editor.selection = at(2);
		await vscode.commands.executeCommand('xit.toggle');
		assert.deepEqual(
			editor.document.getText().split('\n'),
			['[x] Parent', '  [x] One', '  [x] Two'],
		);
	});

	it('reopens the parent when a child is unchecked', async () => {
		const editor = await openXit('[x] Parent\n  [x] One\n  [x] Two');
		editor.selection = at(2);
		await vscode.commands.executeCommand('xit.toggle');
		assert.deepEqual(
			editor.document.getText().split('\n'),
			['[ ] Parent', '  [x] One', '  [ ] Two'],
		);
	});

	it('cascades more than one level in a single edit', async () => {
		const editor = await openXit('[ ] A\n  [ ] B\n    [ ] C');
		editor.selection = at(2);
		await vscode.commands.executeCommand('xit.toggle');
		assert.deepEqual(
			editor.document.getText().split('\n'),
			['[x] A', '  [x] B', '    [x] C'],
		);
	});
});

describe('outline', () => {
	/** The symbols VS Code itself builds, through the registered provider. */
	async function symbolsFor(content: string) {
		const document = await vscode.workspace.openTextDocument({ language: 'xit', content });
		await vscode.window.showTextDocument(document);
		return vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
			'vscode.executeDocumentSymbolProvider', document.uri) ?? [];
	}

	it('is registered, and groups items under their title', async () => {
		const symbols = await symbolsFor('Reading list\n[ ] A book\n[x] Another');
		assert.equal(symbols.length, 1);
		assert.equal(symbols[0].name, 'Reading list');
		assert.deepEqual(symbols[0].children.map(s => s.name), ['[ ] A book', '[x] Another']);
	});

	it('nests subtasks', async () => {
		const [parent] = await symbolsFor('[ ] Parent\n  [x] Child');
		assert.equal(parent.name, '[ ] Parent');
		assert.deepEqual(parent.children.map(s => s.name), ['[x] Child']);
	});

	it('selects the checkbox when a symbol is picked', async () => {
		const [item] = await symbolsFor('[ ] Do this');
		assert.equal(item.selectionRange.start.character, 0);
		assert.equal(item.selectionRange.end.character, 3);
	});
});

describe('folding', () => {
	async function foldsFor(content: string) {
		const document = await vscode.workspace.openTextDocument({ language: 'xit', content });
		await vscode.window.showTextDocument(document);
		const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
			'vscode.executeFoldingRangeProvider', document.uri);
		return (ranges ?? []).map(r => `${r.start}-${r.end}`).sort();
	}

	it('is registered, and folds an item with its subtasks', async () => {
		const ranges = await foldsFor('[ ] Parent\n  [x] One\n  [ ] Two');
		assert.ok(ranges.includes('0-2'), `expected 0-2 among ${ranges.join(', ')}`);
	});

	it('folds a comment block', async () => {
		const ranges = await foldsFor('[ ] Before\n<!--\nparked\n-->');
		assert.ok(ranges.includes('1-3'), `expected 1-3 among ${ranges.join(', ')}`);
	});
});

describe('completion dates', () => {
	/** Run `body` with a setting changed, then put it back. */
	async function withSetting<T>(key: string, value: unknown, body: () => Promise<T>) {
		const configuration = vscode.workspace.getConfiguration('xit');
		const previous = configuration.get(key);
		await configuration.update(key, value, vscode.ConfigurationTarget.Global);
		try {
			return await body();
		} finally {
			await configuration.update(key, previous, vscode.ConfigurationTarget.Global);
		}
	}

	it('does nothing while the setting is off, which is the default', async () => {
		const editor = await openXit('[ ] Do this');
		editor.selection = at(0);
		await vscode.commands.executeCommand('xit.toggle');
		assert.equal(editor.document.lineAt(0).text, '[x] Do this');
	});

	it('stamps on check and removes on uncheck', async () => {
		await withSetting('stampCompletionDate', true, async () => {
			const editor = await openXit('[ ] Do this');
			editor.selection = at(0);

			await vscode.commands.executeCommand('xit.toggle');
			assert.match(editor.document.lineAt(0).text, /^\[x\] Do this #done=\d{4}-\d{2}-\d{2}$/);

			await vscode.commands.executeCommand('xit.toggle');
			assert.equal(editor.document.lineAt(0).text, '[ ] Do this');
		});
	});

	it('stamps a parent checked by the cascade', async () => {
		await withSetting('stampCompletionDate', true, async () => {
			const editor = await openXit('[ ] Parent\n  [ ] Child');
			editor.selection = at(1);
			await vscode.commands.executeCommand('xit.toggle');

			const [parent, child] = editor.document.getText().split('\n');
			assert.match(parent, /^\[x\] Parent #done=/);
			assert.match(child, /^ {2}\[x\] Child #done=/);
		});
	});
});
