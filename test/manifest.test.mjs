/**
 * Tests for the extension manifest.
 *
 * package.json is the contract between the extension and VS Code, and nothing
 * in the toolchain checks it. A wrong path, a keybinding for a command that
 * was never contributed, or a command contributed but never registered all
 * fail silently at runtime. These tests are what the pre-commit hook uses to
 * hold the manifest to its invariants.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT, GRAMMAR_PATH } from './tokenizer.mjs';

const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));
const grammar = JSON.parse(readFileSync(GRAMMAR_PATH, 'utf8'));
const extensionSource = readFileSync(resolve(REPO_ROOT, 'src/extension.ts'), 'utf8');

const LANGUAGE_ID = 'xit';

/** Command ids that src/extension.ts passes to a register* call. */
function registeredCommands() {
	const ids = new Set();
	for (const [, id] of extensionSource.matchAll(/register(?:Editor)?Command\(\s*(?:context,\s*)?'([^']+)'/g)) {
		ids.add(id);
	}
	return ids;
}

/** A file that the packaged extension must contain, resolved from the repo root. */
function contributedPath(path) {
	return resolve(REPO_ROOT, path);
}

/** Width and height from a PNG's IHDR chunk, which always comes first. */
function pngSize(path) {
	const header = readFileSync(path).subarray(0, 24);
	assert.equal(header.subarray(1, 4).toString('ascii'), 'PNG', `${path} is not a PNG`);
	return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

describe('manifest identity', () => {
	it('declares an extension entry point that the build produces', () => {
		assert.equal(manifest.main, './dist/extension.js');
		assert.ok(existsSync(contributedPath(manifest.main)), 'run `npm run build` first');
	});

	it('pins the @types/vscode range to the engine floor', () => {
		// npm writes the installed version's range on `npm install`, which
		// silently lifts the types above the version the extension claims to
		// run on. That reintroduces APIs that do not exist at the floor.
		const engine = manifest.engines.vscode.replace(/^[\^~]/, '');
		const types = manifest.devDependencies['@types/vscode'].replace(/^[\^~]/, '');
		assert.equal(types, engine);
	});

	it('does not declare activation events for its commands', () => {
		// VS Code has inferred onCommand activation from contributes.commands
		// since 1.74. Declaring them again is redundant and drifts.
		const events = manifest.activationEvents ?? [];
		const contributed = manifest.contributes.commands.map((command) => `onCommand:${command.command}`);
		for (const event of contributed) {
			assert.ok(!events.includes(event), `${event} is inferred and must not be declared`);
		}
	});
});

describe('workspace capabilities', () => {
	it('supports untrusted workspaces', () => {
		// The extension only reads and rewrites the active document. It runs
		// nothing from the workspace, so Restricted Mode has no reason to
		// disable it. Without this the extension is silently dead in any
		// folder the user has not trusted.
		assert.deepEqual(manifest.capabilities?.untrustedWorkspaces, { supported: true });
	});
});

describe('contributed files', () => {
	it('points at files that exist', () => {
		const paths = [
			...manifest.contributes.languages.map((language) => language.configuration),
			...manifest.contributes.grammars.map((entry) => entry.path),
			...manifest.contributes.snippets.map((entry) => entry.path),
		].filter(Boolean);

		assert.ok(paths.length > 0);
		for (const path of paths) {
			assert.ok(existsSync(contributedPath(path)), `${path} does not exist`);
		}
	});

	it('binds the grammar to the scope name the grammar declares', () => {
		const [entry] = manifest.contributes.grammars;
		assert.equal(entry.scopeName, grammar.scopeName);
	});

	it('uses one language id throughout', () => {
		assert.deepEqual(
			manifest.contributes.languages.map((language) => language.id),
			[LANGUAGE_ID],
		);
		assert.equal(manifest.contributes.grammars[0].language, LANGUAGE_ID);
		assert.equal(manifest.contributes.snippets[0].language, LANGUAGE_ID);
	});

	it('claims the .xit file extension', () => {
		assert.ok(manifest.contributes.languages[0].extensions.includes('.xit'));
	});
});

describe('icons', () => {
	it('ships an extension icon', () => {
		assert.ok(manifest.icon, 'the Marketplace shows a placeholder without one');
		assert.ok(existsSync(contributedPath(manifest.icon)), `${manifest.icon} does not exist`);
	});

	it('ships a file icon for both theme kinds', () => {
		const icon = manifest.contributes.languages[0].icon;
		assert.ok(icon, 'no file icon contributed');
		for (const kind of ['light', 'dark']) {
			assert.ok(icon[kind], `no ${kind} file icon`);
			assert.ok(existsSync(contributedPath(icon[kind])), `${icon[kind]} does not exist`);
		}
	});

	it('uses raster icons, which is all the Marketplace accepts', () => {
		const icon = manifest.contributes.languages[0].icon;
		for (const path of [manifest.icon, icon.light, icon.dark]) {
			assert.match(path, /\.png$/, `${path} must be a PNG`);
		}
	});

	it('renders the extension icon at least 128x128', () => {
		// "at least 128x128 pixels (256x256 for Retina screens)", per the
		// extension manifest reference.
		const { width, height } = pngSize(contributedPath(manifest.icon));
		assert.ok(width >= 128 && height >= 128, `${width}x${height} is too small`);
	});

	it('keeps an editable source beside every rendered icon', () => {
		// The PNGs are committed, because the Marketplace needs raster and the
		// renderer is not a dependency. `npm run icons` regenerates them.
		for (const png of ['assets/icon.png', 'assets/file-icon-light.png', 'assets/file-icon-dark.png']) {
			const svg = png.replace(/\.png$/, '.svg');
			assert.ok(existsSync(contributedPath(png)), `${png} does not exist`);
			assert.ok(existsSync(contributedPath(svg)), `${svg} does not exist`);
		}
	});
});

describe('commands', () => {
	it('registers every command it contributes', () => {
		const registered = registeredCommands();
		for (const command of manifest.contributes.commands) {
			assert.ok(registered.has(command.command), `${command.command} is contributed but never registered`);
		}
	});

	it('contributes every command it registers', () => {
		const contributed = new Set(manifest.contributes.commands.map((command) => command.command));
		for (const id of registeredCommands()) {
			assert.ok(contributed.has(id), `${id} is registered but never contributed`);
		}
	});

	it('binds keys only to contributed commands', () => {
		const contributed = new Set(manifest.contributes.commands.map((command) => command.command));
		for (const binding of manifest.contributes.keybindings) {
			assert.ok(contributed.has(binding.command), `${binding.command} has a keybinding but is not contributed`);
		}
	});

	it('scopes every keybinding to a focused xit editor', () => {
		for (const binding of manifest.contributes.keybindings) {
			assert.equal(
				binding.when,
				`editorFocus && editorLangId == '${LANGUAGE_ID}'`,
				`${binding.command} would fire outside an xit file`,
			);
		}
	});

	it('hides the internal suggest command from the command palette', () => {
		// xit.suggest is the ctrl+space handler. It is meaningless to invoke
		// by name, and it used to appear in the palette.
		const entry = manifest.contributes.menus.commandPalette.find((item) => item.command === 'xit.suggest');
		assert.equal(entry?.when, 'false');
	});

	it('scopes the user-facing commands in the palette to xit files', () => {
		for (const command of ['xit.toggle', 'xit.shuffle']) {
			const entry = manifest.contributes.menus.commandPalette.find((item) => item.command === command);
			assert.equal(entry?.when, `editorLangId == '${LANGUAGE_ID}'`, `${command} is not scoped in the palette`);
		}
	});

	it('gives every contributed command a title', () => {
		for (const command of manifest.contributes.commands) {
			assert.ok(command.title?.length > 0, `${command.command} has no title`);
		}
	});
});
