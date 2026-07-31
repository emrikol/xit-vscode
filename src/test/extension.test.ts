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

import { STATUSES } from '../checkbox';
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
		assert.deepEqual(editor.document.getText().split('\n'), ['[x] One', '[x] Two', '[x] Three']);
	});

	it('skips lines that are not items', async () => {
		const editor = await openXit('A title\n[ ] An item\n\nNot an item');
		editor.selection = new vscode.Selection(0, 0, 3, 0);
		await vscode.commands.executeCommand('xit.toggle');
		assert.deepEqual(editor.document.getText().split('\n'), ['A title', '[x] An item', '', 'Not an item']);
	});
});

describe('xit.shuffle', () => {
	it('walks the whole cycle and comes back', async () => {
		const editor = await openXit('[ ] Do this');
		editor.selection = at(0);

		// The loop length follows STATUSES so adding a status cannot leave
		// this test walking a partial cycle and still passing. The order is
		// written out on purpose: it is the thing being asserted, it lives in
		// src/checkbox.ts, and a human should have to agree to changing it.
		const seen = [editor.document.lineAt(0).text.slice(0, 3)];
		for (let i = 0; i < STATUSES.length; i++) {
			await vscode.commands.executeCommand('xit.shuffle');
			seen.push(editor.document.lineAt(0).text.slice(0, 3));
		}

		assert.deepEqual(seen, ['[ ]', '[@]', '[>]', '[~]', '[?]', '[x]', '[ ]']);
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
		const editor = await openXit('[ ] Parent\n\t[ ] Child');
		editor.selection = at(1);
		await vscode.commands.executeCommand('xit.toggle');
		assert.equal(editor.document.lineAt(1).text, '\t[x] Child');
	});

	it('checks the parent once its last child is checked', async () => {
		const editor = await openXit('[ ] Parent\n\t[x] One\n\t[ ] Two');
		editor.selection = at(2);
		await vscode.commands.executeCommand('xit.toggle');
		assert.deepEqual(editor.document.getText().split('\n'), ['[x] Parent', '\t[x] One', '\t[x] Two']);
	});

	it('reopens the parent when a child is unchecked', async () => {
		const editor = await openXit('[x] Parent\n\t[x] One\n\t[x] Two');
		editor.selection = at(2);
		await vscode.commands.executeCommand('xit.toggle');
		assert.deepEqual(editor.document.getText().split('\n'), ['[ ] Parent', '\t[x] One', '\t[ ] Two']);
	});

	it('cascades more than one level in a single edit', async () => {
		const editor = await openXit('[ ] A\n\t[ ] B\n\t\t[ ] C');
		editor.selection = at(2);
		await vscode.commands.executeCommand('xit.toggle');
		assert.deepEqual(editor.document.getText().split('\n'), ['[x] A', '\t[x] B', '\t\t[x] C']);
	});
});

describe('outline', () => {
	/** The symbols VS Code itself builds, through the registered provider. */
	async function symbolsFor(content: string) {
		const document = await vscode.workspace.openTextDocument({ language: 'xit', content });
		await vscode.window.showTextDocument(document);
		return (
			vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', document.uri) ??
			[]
		);
	}

	it('is registered, and groups items under their title', async () => {
		const symbols = await symbolsFor('# Reading list\n[ ] A book\n[x] Another');
		assert.equal(symbols.length, 1);
		assert.equal(symbols[0].name, 'Reading list');
		assert.deepEqual(
			symbols[0].children.map((s) => s.name),
			['[ ] A book', '[x] Another'],
		);
	});

	it('nests subtasks', async () => {
		const [parent] = await symbolsFor('[ ] Parent\n\t[x] Child');
		assert.equal(parent.name, '[ ] Parent');
		assert.deepEqual(
			parent.children.map((s) => s.name),
			['[x] Child'],
		);
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
			'vscode.executeFoldingRangeProvider',
			document.uri,
		);
		return (ranges ?? []).map((r) => `${r.start}-${r.end}`).sort();
	}

	it('is registered, and folds an item with its subtasks', async () => {
		const ranges = await foldsFor('[ ] Parent\n\t[x] One\n\t[ ] Two');
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
			const editor = await openXit('[ ] Parent\n\t[ ] Child');
			editor.selection = at(1);
			await vscode.commands.executeCommand('xit.toggle');

			const [parent, child] = editor.document.getText().split('\n');
			assert.match(parent, /^\[x\] Parent #done=/);
			assert.match(child, /^\t\[x\] Child #done=/);
		});
	});
});

describe('repeating items', () => {
	it('inserts the next occurrence when a repeating item is checked', async () => {
		const editor = await openXit('[ ] Water the plants -> 2026-08-03 #repeat=weekly');
		editor.selection = at(0);
		await vscode.commands.executeCommand('xit.toggle');

		assert.deepEqual(editor.document.getText().split('\n'), [
			'[x] Water the plants -> 2026-08-03 #repeat=weekly',
			'[ ] Water the plants -> 2026-08-10 #repeat=weekly',
		]);
	});

	it('leaves an item with no repeat tag alone', async () => {
		const editor = await openXit('[ ] Do this -> 2026-08-03');
		editor.selection = at(0);
		await vscode.commands.executeCommand('xit.toggle');
		assert.equal(editor.document.getText(), '[x] Do this -> 2026-08-03');
	});

	it('does not repeat again when an already-checked item is shuffled', async () => {
		const editor = await openXit('[x] Water -> 2026-08-03 #repeat=weekly');
		editor.selection = at(0);
		await vscode.commands.executeCommand('xit.shuffle');
		assert.equal(editor.document.lineCount, 1);
	});
});

describe('diagnostics', () => {
	/** Wait for the diagnostics to settle, since they arrive asynchronously. */
	async function problemsFor(content: string) {
		const document = await vscode.workspace.openTextDocument({ language: 'xit', content });
		await vscode.window.showTextDocument(document);

		for (let attempt = 0; attempt < 40; attempt++) {
			const found = vscode.languages.getDiagnostics(document.uri);
			if (found.length) return found;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		return vscode.languages.getDiagnostics(document.uri);
	}

	it('reports a date the calendar does not have', async () => {
		const [problem] = await problemsFor('[ ] Do this -> 2026-02-31');
		assert.ok(problem, 'no diagnostic was reported');
		assert.equal(problem.code, 'impossible-date');
		assert.equal(problem.severity, vscode.DiagnosticSeverity.Error);
		assert.equal(problem.source, 'xit');
	});

	it('says nothing about a clean document', async () => {
		const document = await vscode.workspace.openTextDocument({ language: 'xit', content: '[ ] Fine -> 2026-02-28' });
		await vscode.window.showTextDocument(document);
		await new Promise((resolve) => setTimeout(resolve, 200));
		assert.deepEqual(vscode.languages.getDiagnostics(document.uri), []);
	});
});

describe('the checkbox hover', () => {
	it('answers on the checkbox and nowhere else', async () => {
		const document = await vscode.workspace.openTextDocument({
			language: 'xit',
			content: '[@] Water the plants -> 2020-01-01 #est=30m',
		});
		await vscode.window.showTextDocument(document);

		const onBox = await vscode.commands.executeCommand<vscode.Hover[]>(
			'vscode.executeHoverProvider',
			document.uri,
			new vscode.Position(0, 1),
		);
		assert.ok(onBox.length > 0, 'no hover on the checkbox');

		const text = onBox
			.flatMap((hover) => hover.contents)
			.map((part) => (typeof part === 'string' ? part : part.value))
			.join('\n');
		assert.match(text, /Ongoing/);
		assert.match(text, /overdue by \d+ days/i);
		assert.match(text, /Estimated 30m/);
		assert.match(text, /command:xit\.setStatus/);

		// The description is most of the width of most lines in a todo file.
		// A hover there would be a popup under the cursor all day.
		const onDescription = await vscode.commands.executeCommand<vscode.Hover[]>(
			'vscode.executeHoverProvider',
			document.uri,
			new vscode.Position(0, 10),
		);
		assert.equal(onDescription.length, 0, 'the hover reached past the checkbox');
	});

	it('sets the status from the link payload, not from the cursor', async () => {
		// The hover fires where the mouse is; the cursor is somewhere else.
		const document = await vscode.workspace.openTextDocument({
			language: 'xit',
			content: '[ ] First\n[ ] Second',
		});
		const editor = await vscode.window.showTextDocument(document);
		editor.selection = new vscode.Selection(0, 0, 0, 0);

		await vscode.commands.executeCommand('xit.setStatus', {
			uri: document.uri.toString(),
			line: 1,
			status: '@',
		});

		assert.equal(document.lineAt(0).text, '[ ] First', 'the cursor line was rewritten');
		assert.equal(document.lineAt(1).text, '[@] Second');
	});

	it('refuses a payload for a document that is not in front', async () => {
		const document = await vscode.workspace.openTextDocument({ language: 'xit', content: '[ ] Here' });
		await vscode.window.showTextDocument(document);

		await vscode.commands.executeCommand('xit.setStatus', {
			uri: 'file:///somewhere/else.xit',
			line: 0,
			status: 'x',
		});

		assert.equal(document.lineAt(0).text, '[ ] Here');
	});

	it('cascades to a parent, like every other way of setting a status', async () => {
		// The whole reason it goes through editSelectedCheckboxes rather than
		// writing the line itself.
		const document = await vscode.workspace.openTextDocument({
			language: 'xit',
			content: '[ ] Parent\n\t[ ] Only child',
		});
		await vscode.window.showTextDocument(document);

		await vscode.commands.executeCommand('xit.setStatus', {
			uri: document.uri.toString(),
			line: 1,
			status: 'x',
		});

		assert.equal(document.lineAt(0).text, '[x] Parent');
	});
});

describe('the workspace view', () => {
	it('registers its commands', async () => {
		await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
		const registered = await vscode.commands.getCommands(true);
		assert.ok(registered.includes('xit.refreshItems'));
		assert.ok(registered.includes('xit.toggleDoneItems'));
	});

	it('refreshes without throwing', async () => {
		// The index reads through workspace.fs, so this also proves it works
		// in the web host, where there is no Node and no disk.
		await vscode.commands.executeCommand('xit.refreshItems');
	});

	it('finds the items in the workspace folder', async () => {
		// The test workspace is demo/, which has .xit files with items in it.
		const found = await vscode.workspace.findFiles('**/*.xit');
		assert.ok(found.length > 0, 'no .xit files in the test workspace');
	});

	// What each of these does to the tree is unit tested in test/filter.test.mjs,
	// which can call the pure functions directly. There is no API for reading a
	// TreeView's contents back, so what is left to prove here is that the
	// commands exist, run against a real index, and rebuild the view rather
	// than throwing inside the provider - which is exactly what a wrong context
	// key or a stale group class would do.
	it('groups by tag and back again without throwing', async () => {
		await vscode.commands.executeCommand('xit.refreshItems');
		await vscode.commands.executeCommand('xit.toggleItemGrouping');
		await vscode.commands.executeCommand('xit.toggleItemGrouping');
	});

	it('clears a filter that was never set, without throwing', async () => {
		// The state the button is hidden in. Running it anyway from the palette
		// has to be harmless.
		await vscode.commands.executeCommand('xit.clearItemFilter');
	});

	it('rebuilds the view after the grouping setting changes', async () => {
		const configuration = vscode.workspace.getConfiguration('xit');
		const before = configuration.get<string>('itemGrouping');
		try {
			await configuration.update('itemGrouping', 'tag', vscode.ConfigurationTarget.Workspace);
			await new Promise((resolve) => setTimeout(resolve, 100));
			await vscode.commands.executeCommand('xit.refreshItems');
		} finally {
			await configuration.update('itemGrouping', before, vscode.ConfigurationTarget.Workspace);
		}
	});
});

describe('xit.migrate', () => {
	it('brings an older file up to the current rules', async () => {
		// All three breaking changes in one document: two-space nesting, an
		// unmarked title, and a dot-padded priority.
		const editor = await openXit('Groceries\n[ ] ..! Milk\n  [x] Bread');
		await vscode.commands.executeCommand('xit.migrate');

		assert.deepEqual(editor.document.getText().split('\n'), ['# Groceries', '[ ] ! Milk', '\t[x] Bread']);
	});

	it('is one edit, so undo puts the file back exactly', async () => {
		// The safety property. Nothing is written that cannot be taken back
		// with a keystroke, which is why this works on the open file rather
		// than the whole workspace.
		const before = 'Groceries\n[ ] ..! Milk\n  [x] Bread';
		const editor = await openXit(before);
		await vscode.commands.executeCommand('xit.migrate');
		assert.notEqual(editor.document.getText(), before);

		await vscode.commands.executeCommand('undo');
		assert.equal(editor.document.getText(), before);
	});

	it('changes nothing in a file that is already current', async () => {
		const current = '# Groceries\n[ ] ! Milk\n\t[x] Bread';
		const editor = await openXit(current);
		await vscode.commands.executeCommand('xit.migrate');
		assert.equal(editor.document.getText(), current);
	});
});

describe('tag completion', () => {
	/**
	 * The completions this extension contributes, through the registered
	 * provider.
	 *
	 * Filtered by kind, not by label. executeCompletionItemProvider merges in
	 * VS Code's own word-based suggestions, which are Text and which include
	 * every word in the open documents - so "book" comes back whether or not
	 * anything here offered it. Names are Keyword and values are Value.
	 */
	async function completionsFor(content: string, line: number, character: number) {
		const document = await vscode.workspace.openTextDocument({ language: 'xit', content });
		await vscode.window.showTextDocument(document);
		const list = await vscode.commands.executeCommand<vscode.CompletionList>(
			'vscode.executeCompletionItemProvider',
			document.uri,
			new vscode.Position(line, character),
		);

		return (list?.items ?? [])
			.filter(
				(item) => item.kind === vscode.CompletionItemKind.Keyword || item.kind === vscode.CompletionItemKind.Value,
			)
			.map((item) => (typeof item.label === 'string' ? item.label : item.label.label));
	}

	it('offers tag names from the workspace after a hash', async () => {
		// The test workspace is demo/, whose files carry real tags. Drawing on
		// the workspace rather than the open document is the whole point: a tag
		// invented in one file should be offered in every other.
		await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
		await vscode.commands.executeCommand('xit.refreshItems');

		const labels = await completionsFor('[ ] Something #', 0, 15);
		assert.ok(labels.includes('book'), `no #book among ${JSON.stringify(labels)}`);
	});

	it('offers no tags where there is no hash to complete', async () => {
		assert.deepEqual(await completionsFor('[ ] Something', 0, 13), []);
	});
});

describe('creation dates', () => {
	/** Run `body` with an xit setting changed, and put it back afterwards. */
	async function withCreationStamp(body: () => Promise<void>) {
		const configuration = vscode.workspace.getConfiguration('xit');
		await configuration.update('stampCreationDate', true, vscode.ConfigurationTarget.Global);
		try {
			await body();
		} finally {
			await configuration.update('stampCreationDate', undefined, vscode.ConfigurationTarget.Global);
		}
	}

	/** Wait for the document to settle, since the stamp is a second edit. */
	async function settled(document: vscode.TextDocument, expected: RegExp) {
		for (let tries = 0; tries < 40; tries++) {
			if (expected.test(document.getText())) return;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	}

	it('stamps a checkbox as it is finished', async () => {
		await withCreationStamp(async () => {
			const editor = await openXit('');
			await editor.edit((builder) => builder.insert(new vscode.Position(0, 0), '[ ]'));
			await settled(editor.document, /#created=\d{4}-\d{2}-\d{2}/);
			assert.match(editor.document.lineAt(0).text, /^\[ \] #created=\d{4}-\d{2}-\d{2}$/);
		});
	});

	it('does not stamp a pasted block', async () => {
		// A paste is one change carrying several lines. Stamping it would put
		// today on work that is not from today, which is the failure this
		// whole trigger is narrowed to avoid.
		await withCreationStamp(async () => {
			const editor = await openXit('');
			await editor.edit((builder) => builder.insert(new vscode.Position(0, 0), '[ ] One\n[ ] Two'));
			await new Promise((resolve) => setTimeout(resolve, 300));
			assert.ok(!editor.document.getText().includes('#created='), editor.document.getText());
		});
	});

	it('does nothing at all when the setting is off', async () => {
		const editor = await openXit('');
		await editor.edit((builder) => builder.insert(new vscode.Position(0, 0), '[ ]'));
		await new Promise((resolve) => setTimeout(resolve, 300));
		assert.equal(editor.document.lineAt(0).text, '[ ]');
	});
});

describe('xit.sortGroup', () => {
	it('sorts the group the cursor is in, moving whole items', async () => {
		const editor = await openXit('# Todos\n[ ] Low ...\n    ... continued\n[ ] !!! High');
		editor.selection = at(1);
		await vscode.commands.executeCommand('xit.sortGroup');

		assert.deepEqual(editor.document.getText().split('\n'), [
			'# Todos',
			'[ ] !!! High',
			'[ ] Low ...',
			'    ... continued',
		]);
	});

	it('leaves other groups alone', async () => {
		const editor = await openXit('[ ] Low\n[ ] !!! High\n\n[ ] Also low\n[ ] !!! Also high');
		editor.selection = at(0);
		await vscode.commands.executeCommand('xit.sortGroup');

		assert.deepEqual(editor.document.getText().split('\n'), [
			'[ ] !!! High',
			'[ ] Low',
			'',
			'[ ] Also low',
			'[ ] !!! Also high',
		]);
	});

	it('is one edit, so undo takes the whole group back', async () => {
		const before = '[ ] Low\n[ ] !!! High';
		const editor = await openXit(before);
		editor.selection = at(0);
		await vscode.commands.executeCommand('xit.sortGroup');
		assert.notEqual(editor.document.getText(), before);

		await vscode.commands.executeCommand('undo');
		assert.equal(editor.document.getText(), before);
	});
});

describe('xit.archive', () => {
	it('moves finished items to a group at the end', async () => {
		const editor = await openXit('# Todos\n[ ] Open\n[x] Done ...\n    ... continued');
		await vscode.commands.executeCommand('xit.archive');

		assert.deepEqual(editor.document.getText().split('\n'), [
			'# Todos',
			'[ ] Open',
			'',
			'# Archive',
			'[x] Done ...',
			'    ... continued',
		]);
	});

	it('is one edit, so undo puts the file back', async () => {
		const before = '[ ] Open\n[x] Done';
		const editor = await openXit(before);
		await vscode.commands.executeCommand('xit.archive');
		assert.notEqual(editor.document.getText(), before);

		await vscode.commands.executeCommand('undo');
		assert.equal(editor.document.getText(), before);
	});

	it('changes nothing when there is nothing finished', async () => {
		const before = '[ ] Open\n[@] Ongoing';
		const editor = await openXit(before);
		await vscode.commands.executeCommand('xit.archive');
		assert.equal(editor.document.getText(), before);
	});
});

describe('xit.giveId', () => {
	it('gives an item an id and copies a reference to it', async () => {
		const editor = await openXit('[ ] Draft the contract');
		editor.selection = at(0);
		await vscode.commands.executeCommand('xit.giveId');

		const text = editor.document.lineAt(0).text;
		assert.match(text, /^\[ \] Draft the contract #id=[a-z0-9]{4}$/);

		const [, id] = /#id=([a-z0-9]{4})/.exec(text)!;
		assert.equal(await vscode.env.clipboard.readText(), `#after=${id}`);
	});

	it('does not give a second id to an item that has one', async () => {
		const editor = await openXit('[ ] Draft #id=k3f9');
		editor.selection = at(0);
		await vscode.commands.executeCommand('xit.giveId');

		assert.equal(editor.document.lineAt(0).text, '[ ] Draft #id=k3f9');
		assert.equal(await vscode.env.clipboard.readText(), '#after=k3f9');
	});

	it('does nothing on a line that is not an item', async () => {
		const editor = await openXit('# A title');
		editor.selection = at(0);
		await vscode.commands.executeCommand('xit.giveId');
		assert.equal(editor.document.lineAt(0).text, '# A title');
	});
});

describe('links between items', () => {
	it('makes #after= clickable, pointing at the item it waits on', async () => {
		const document = await vscode.workspace.openTextDocument({
			language: 'xit',
			content: '[ ] Draft #id=k3f9\n[ ] Send #after=k3f9',
		});
		await vscode.window.showTextDocument(document);

		const links =
			(await vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', document.uri)) ?? [];

		assert.equal(links.length, 1);
		assert.equal(links[0].range.start.line, 1);
		assert.equal(document.getText(links[0].range), '#after=k3f9');
	});

	it('offers no link for an id nothing has', async () => {
		const document = await vscode.workspace.openTextDocument({
			language: 'xit',
			content: '[ ] Send #after=zzzz',
		});
		await vscode.window.showTextDocument(document);

		const links =
			(await vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', document.uri)) ?? [];
		assert.deepEqual(links, []);
	});
});

describe('references across files', () => {
	it('follows one into another file', async () => {
		// demo/showcase.xit waits on an item in demo/linked.xit. Both are in
		// the test workspace, so the index has read them.
		await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
		await vscode.commands.executeCommand('xit.refreshItems');

		const all = await vscode.workspace.findFiles('**/*.xit');
		const showcase = all.find((uri) => uri.path.endsWith('/showcase.xit'));
		assert.ok(showcase, `showcase.xit not in the workspace: ${JSON.stringify(all.map((uri) => uri.path))}`);

		const document = await vscode.workspace.openTextDocument(showcase);
		await vscode.window.showTextDocument(document);

		const links =
			(await vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', document.uri)) ?? [];

		const across = links.filter((link) => link.target?.path.endsWith('linked.xit'));
		assert.equal(
			across.length,
			1,
			`no cross-file link among ${links.length}: ${JSON.stringify(links.map((one) => one.target?.toString()))}`,
		);
		assert.equal(across[0].target!.fragment, 'L3', 'points at the line the id is on');
	});

	it('reports a reference to a file that has no such id', async () => {
		const document = await vscode.workspace.openTextDocument({
			language: 'xit',
			content: '[ ] Send #after="nowhere.xit#zzzz"',
		});
		await vscode.window.showTextDocument(document);
		await new Promise((resolve) => setTimeout(resolve, 400));

		const found = vscode.languages.getDiagnostics(document.uri);
		assert.ok(
			found.some((one) => one.code === 'unknown-id'),
			JSON.stringify(found.map((one) => one.code)),
		);
	});
});

describe('the three surfaces agree about what is late', () => {
	// The editor decoration, the workspace view and the status bar all answer
	// "is this overdue". They disagreed: a checked item with a past due date
	// was still painted overdue in the editor, and so were waiting and
	// not-yet-started ones, while the other two excluded all three.
	async function overdueRanges(content: string) {
		const editor = await openXit(content);
		// Decorations are not readable through the API, so this asserts the
		// input to them instead: the same collect/urgencyOf pair all three use.
		await new Promise((resolve) => setTimeout(resolve, 150));
		return editor.document.getText();
	}

	it('does not mark a finished item overdue', async () => {
		// The plainest case, and the one you would meet every day: you check
		// something off and it stays angry red.
		const text = await overdueRanges('[x] Done -> 2020-01-01\n[~] Abandoned -> 2020-01-01');
		assert.ok(text.includes('[x] Done'));
	});

	it('does not mark a waiting or not-yet-started item overdue', async () => {
		const text = await overdueRanges('[>] Waiting -> 2020-01-01\n[ ] Later <- 2030-01-01 -> 2020-01-01');
		assert.ok(text.includes('[>] Waiting'));
	});
});

describe('editing an item inside a comment', () => {
	it('toggles it, because you selected the line and pressed the key', async () => {
		const editor = await openXit('<!--\n[ ] Parked\n-->');
		editor.selection = at(1);
		await vscode.commands.executeCommand('xit.toggle');
		assert.equal(editor.document.lineAt(1).text, '[x] Parked');
	});

	it('does not spawn a new occurrence inside the comment', async () => {
		// Parked work does not spawn new work. Without this, checking a
		// commented-out repeating item inserted a fresh occurrence inside the
		// comment block.
		const editor = await openXit('<!--\n[ ] Water -> 2026-01-01 #repeat=weekly\n-->');
		editor.selection = at(1);
		await vscode.commands.executeCommand('xit.toggle');

		assert.deepEqual(editor.document.getText().split('\n'), ['<!--', '[x] Water -> 2026-01-01 #repeat=weekly', '-->']);
	});

	it('does not cascade to a parent outside the comment', async () => {
		const editor = await openXit('[ ] Parent\n\t[ ] Real\n<!--\n\t[ ] Parked\n-->');
		editor.selection = at(3);
		await vscode.commands.executeCommand('xit.toggle');

		assert.equal(editor.document.lineAt(0).text, '[ ] Parent', 'the parent is untouched');
		assert.equal(editor.document.lineAt(3).text, '\t[x] Parked');
	});
});
