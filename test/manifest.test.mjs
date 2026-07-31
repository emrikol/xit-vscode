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
const testManifestSource = readFileSync(resolve(REPO_ROOT, 'src/test/manifest.ts'), 'utf8');

const LANGUAGE_ID = 'xit';

/** Command ids that src/extension.ts passes to a register* call. */
function registeredCommands() {
	const ids = new Set();
	for (const [, id] of extensionSource.matchAll(/register(?:Editor)?Command\(\s*(?:context,\s*)?'([^']+)'/g)) {
		ids.add(id);
	}
	return ids;
}

/** A string or string-array constant exported by src/test/manifest.ts. */
function testConstant(name) {
	const match = testManifestSource.match(new RegExp(`export const ${name} = (\\[[^\\]]*\\]|'[^']*')`));
	assert.ok(match, `src/test/manifest.ts does not export ${name}`);
	return match[1].startsWith('[')
		? [...match[1].matchAll(/'([^']*)'/g)].map(([, value]) => value)
		: match[1].slice(1, -1);
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

	it('builds a production bundle before publishing', () => {
		// vsce runs vscode:prepublish and ships whatever it finds. If that
		// hook builds the development bundle, the vsix carries source maps
		// that point at files it does not contain.
		assert.match(manifest.scripts['vscode:prepublish'], /\bpackage\b/);
		assert.match(manifest.scripts.package, /--production/);
	});

	it('pins the @types/vscode range to the engine floor', () => {
		// npm writes the installed version's range on `npm install`, which
		// silently lifts the types above the version the extension claims to
		// run on. That reintroduces APIs that do not exist at the floor.
		const engine = manifest.engines.vscode.replace(/^[\^~]/, '');
		const types = manifest.devDependencies['@types/vscode'].replace(/^[\^~]/, '');
		assert.equal(types, engine);
	});

	it('wakes on an xit file, because overdue dates need code', () => {
		// Everything else the extension contributes is declarative and needs
		// no activation at all. Colouring a date whose period has passed does
		// need code, and it has to run without the user invoking anything.
		assert.ok(manifest.activationEvents.includes(`onLanguage:${LANGUAGE_ID}`));
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

describe('marketplace metadata', () => {
	it('publishes under this fork, not the original', () => {
		// publisher is an account id, not a credit line. Publishing under
		// tscpp is not possible without that account, and publisher + name is
		// the extension's global identity: leaving it would make this build
		// claim to be tscpp.xit and collide with the original on install.
		assert.equal(manifest.publisher, 'emrikol');
	});

	it('states its licence, and ships the file the field names', () => {
		assert.equal(manifest.license, 'MIT');
		assert.ok(existsSync(resolve(REPO_ROOT, 'LICENSE')));
	});

	it('keeps the original copyright notice', () => {
		// The one thing MIT actually requires of a fork: the copyright notice
		// and the permission notice survive in copies. Removing the original
		// line would breach the licence this code is used under.
		const licence = readFileSync(resolve(REPO_ROOT, 'LICENSE'), 'utf8');
		assert.match(licence, /Copyright \(c\) 2022 Elias Skogevall/);
		assert.match(licence, /Permission is hereby granted, free of charge/);
	});

	it('describes the repository in object form', () => {
		// vsce accepts the plain-string shorthand, but the documented form is
		// an object, and the string form loses the type.
		assert.equal(typeof manifest.repository, 'object');
		assert.equal(manifest.repository.type, 'git');
		assert.match(manifest.repository.url, /^https:\/\/github\.com\/emrikol\/xit-vscode\.git$/);
	});

	it('links its home page and its bug tracker', () => {
		assert.match(manifest.homepage, /^https:\/\/github\.com\/emrikol\/xit-vscode/);
		// Issues are disabled on the repository on purpose, so this points at
		// the repository itself rather than at a page that 404s.
		assert.equal(manifest.bugs.url, 'https://github.com/emrikol/xit-vscode');
	});

	it('turns off Marketplace Q&A', () => {
		// Issues, Discussions and pull requests are all closed. Leaving Q&A
		// open would reopen the one support channel that was shut on purpose.
		assert.equal(manifest.qna, false);
	});

	it('carries keywords, within the documented limit', () => {
		assert.ok(Array.isArray(manifest.keywords));
		assert.ok(manifest.keywords.length > 0);
		assert.ok(manifest.keywords.length <= 30, 'the Marketplace takes at most 30');
	});

	it('uses only categories the Marketplace recognises', () => {
		const allowed = new Set([
			'Programming Languages', 'Snippets', 'Linters', 'Themes', 'Debuggers',
			'Formatters', 'Keymaps', 'SCM Providers', 'Other', 'Extension Packs',
			'Language Packs', 'Data Science', 'Machine Learning', 'Visualization',
			'Notebooks', 'Education', 'Testing', 'AI', 'Chat',
		]);
		for (const category of manifest.categories) {
			assert.ok(allowed.has(category), `${category} is not a Marketplace category`);
		}
	});
});

describe('workspace capabilities', () => {
	it('runs on either extension host, preferring the local one', () => {
		// The commands only read and rewrite the active document, which works
		// from either host. Preferring "ui" keeps the edits local in a remote
		// or Codespaces window instead of round-tripping.
		assert.deepEqual(manifest.extensionKind, ['ui', 'workspace']);
	});

	it('supports virtual workspaces', () => {
		// Nothing here touches the file system. It works the same in a
		// GitHub repository opened straight from the remote.
		assert.equal(manifest.capabilities?.virtualWorkspaces, true);
	});

	it('supports untrusted workspaces', () => {
		// The extension only reads and rewrites the active document. It runs
		// nothing from the workspace, so Restricted Mode has no reason to
		// disable it. Without this the extension is silently dead in any
		// folder the user has not trusted.
		assert.deepEqual(manifest.capabilities?.untrustedWorkspaces, { supported: true });
	});
});

describe('packaging', () => {
	it('keeps everything that is not shipped out of the vsix', () => {
		const ignored = readFileSync(resolve(REPO_ROOT, '.vscodeignore'), 'utf8')
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith('#'));

		// .claude/settings.local.json was found inside a built vsix once. The
		// only thing that caught it was packaging and reading the file list.
		const required = [
			'.claude/**', 'src/**', 'test/**', 'node_modules/**', 'scripts/**',
			'demo/**', 'out/**', '.vscode-test.mjs', '**/*.map',
		];
		for (const pattern of required) {
			assert.ok(ignored.includes(pattern), `.vscodeignore does not exclude ${pattern}`);
		}
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

	it('injects the Markdown grammar into Markdown, under its own scope', () => {
		// A grammar contributed with injectTo must not also claim a language:
		// it is spliced into someone else's, and it needs a scope name of its
		// own so the two are not confused for one another.
		const injection = manifest.contributes.grammars.find((entry) => entry.injectTo);
		assert.ok(injection, 'no injection grammar contributed');
		assert.deepEqual(injection.injectTo, ['text.html.markdown']);
		assert.equal(injection.language, undefined);
		assert.notEqual(injection.scopeName, grammar.scopeName);

		const file = JSON.parse(readFileSync(contributedPath(injection.path), 'utf8'));
		assert.equal(file.scopeName, injection.scopeName);
		// Where VS Code splices it in. Naming a scope Markdown never produces
		// is silent: the extension loads, and nothing is ever highlighted.
		// scripts/verify-markdown-injection.mjs checks that end to end.
		assert.equal(file.injectionSelector, `L:${injection.injectTo[0]}`);
	});

	it('maps the embedded scope back to the xit language', () => {
		// Without this the fenced block is text as far as VS Code is
		// concerned, so comment toggling and bracket behaviour inside it
		// follow Markdown rather than xit.
		const injection = manifest.contributes.grammars.find((entry) => entry.injectTo);
		assert.deepEqual(injection.embeddedLanguages, { 'meta.embedded.block.xit': LANGUAGE_ID });
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

describe('language configuration', () => {
	// JSON with comments, which is what VS Code reads here.
	const configuration = JSON.parse(
		readFileSync(resolve(REPO_ROOT, manifest.contributes.languages[0].configuration), 'utf8')
			.replace(/^\s*\/\/.*$/gm, ''),
	);

	it('declares no brackets', () => {
		// Measured in a real editor: with ["[", "]"] declared, bracket pair
		// colorization repainted both brackets in its own blue, over the
		// colour the theme gave the checkbox scope. Every checkbox rendered
		// blue-ends-coloured-middle except "[~]", which escaped only because
		// its scope is a comment and VS Code leaves brackets in comments
		// alone. Declaring none also stops a lone "[" in a description being
		// flagged as an unclosed bracket.
		assert.deepEqual(configuration.brackets, []);
	});

	it('still auto-closes and surrounds with brackets', () => {
		// Those are separate settings, and typing "[" to get "[]" is the
		// fastest way to start an item.
		for (const key of ['autoClosingPairs', 'surroundingPairs']) {
			assert.ok(
				configuration[key].some(([open, close]) => open === '[' && close === ']'),
				`${key} lost the square bracket pair`,
			);
		}
	});

	it('describes the comment syntax the fork adds', () => {
		assert.deepEqual(configuration.comments.blockComment, ['<!--', '-->']);
	});
});

describe('first-line detection', () => {
	const firstLine = new RegExp(manifest.contributes.languages[0].firstLine);

	it('recognises a file that opens with any checkbox', () => {
		for (const status of [' ', 'x', '@', '~', '?']) {
			assert.match(`[${status}] An item`, firstLine, `[${status}] was not recognised`);
			assert.match(`[${status}]`, firstLine, `a bare [${status}] was not recognised`);
		}
	});

	it('recognises the first line of the reference fixture', () => {
		const [first] = readFileSync(resolve(REPO_ROOT, 'test/fixtures/reference.xit'), 'utf8').split('\n');
		assert.match(first, firstLine);
	});

	it('does not claim a Markdown task list', () => {
		// This is the one that would actually bite. Markdown writes them with
		// a list marker in front, so anchoring at the start of the line is
		// enough to tell them apart.
		for (const line of ['- [ ] A markdown task', '* [x] Another one', '  [ ] Indented']) {
			assert.doesNotMatch(line, firstLine, `${line} was claimed`);
		}
	});

	it('does not claim a file that opens with an HTML comment', () => {
		// A .xit comment and an HTML document both start this way, and HTML
		// is far more common.
		assert.doesNotMatch('<!-- a comment -->', firstLine);
	});

	it('does not claim arbitrary bracketed text', () => {
		for (const line of ['[INFO] a log line', '[]', '[ x ] spaced', '[TODO] a note']) {
			assert.doesNotMatch(line, firstLine, `${line} was claimed`);
		}
	});

	it('does not claim a plain title, which is indistinguishable from prose', () => {
		assert.doesNotMatch('My TODO list', firstLine);
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

describe('overdue due dates', () => {
	const COLOURS = [
		'xit.overdueDueDateBackground', 'xit.overdueDueDateForeground', 'xit.overdueDueDateBorder',
		'xit.criticallyOverdueDueDateBackground', 'xit.criticallyOverdueDueDateForeground', 'xit.criticallyOverdueDueDateBorder',
	];

	it('contributes every colour, with a description', () => {
		for (const id of COLOURS) {
			const colour = manifest.contributes.colors?.find((entry) => entry.id === id);
			assert.ok(colour, `${id} is not contributed`);
			assert.ok(colour.description?.length > 0, `${id} has no description`);
		}
	});

	it('names every contributed colour in the source', () => {
		// createTextEditorDecorationType takes a ThemeColor by id. An id that
		// nothing contributes resolves to undefined, and the decoration then
		// renders with nothing at all - invisible, with no error anywhere. The
		// ids are built from a tier name and a part, so this looks for the
		// pieces rather than for whole literals.
		const source = readFileSync(resolve(REPO_ROOT, 'src/extension.ts'), 'utf8');
		for (const id of COLOURS) {
			assert.ok(source.includes(id), `${id} is contributed but never used`);
		}
	});

	it('contributes exactly the colours it uses', () => {
		const source = readFileSync(resolve(REPO_ROOT, 'src/extension.ts'), 'utf8');
		// Command ids share the `xit.` prefix, so they have to come out first.
		const commands = new Set(manifest.contributes.commands.map((command) => command.command));
		const used = new Set([...source.matchAll(/'(xit\.[A-Za-z]+)'/g)]
			.map(([, id]) => id)
			.filter((id) => !commands.has(id)));
		const contributed = new Set(manifest.contributes.colors.map((entry) => entry.id));

		for (const id of used) assert.ok(contributed.has(id), `${id} is used but never contributed`);
		for (const id of contributed) assert.ok(used.has(id), `${id} is contributed but never used`);
	});

	it('gives every colour a default for every theme kind', () => {
		// Without a default for a kind, the colour is unset in themes of that
		// kind and the decoration silently does nothing there. High contrast
		// light is the one usually forgotten.
		for (const id of COLOURS) {
			const colour = manifest.contributes.colors.find((entry) => entry.id === id);
			for (const kind of ['dark', 'light', 'highContrast', 'highContrastLight']) {
				assert.ok(colour.defaults?.[kind], `${id} has no default for ${kind} themes`);
			}
		}
	});

	it('keeps completion stamping off by default', () => {
		// It rewrites the user's file. Opt in.
		const properties = manifest.contributes.configuration.properties;
		assert.equal(properties['xit.stampCompletionDate'].type, 'boolean');
		assert.equal(properties['xit.stampCompletionDate'].default, false);
		assert.equal(properties['xit.completionDateTag'].default, 'done');
	});

	it('can be turned off, restyled, and have its second tier retimed', () => {
		const properties = manifest.contributes.configuration?.properties ?? {};

		assert.equal(properties['xit.overdueDueDates']?.type, 'boolean');
		assert.equal(properties['xit.overdueDueDates']?.default, true);
		assert.equal(properties['xit.overdueDueDateStyle']?.default, 'border-and-background');
		assert.equal(properties['xit.criticallyOverdueAfterDays']?.type, 'number');
		assert.equal(properties['xit.criticallyOverdueAfterDays']?.default, 14);
		// Zero turns the second tier off. A negative threshold would make
		// everything critical, which is the opposite of what anyone means.
		assert.equal(properties['xit.criticallyOverdueAfterDays']?.minimum, 0);

		for (const [id, setting] of Object.entries(properties)) {
			assert.ok(setting.description?.length > 0, `${id} has no description`);
		}
	});

	it('reads every setting it contributes', () => {
		const source = readFileSync(resolve(REPO_ROOT, 'src/extension.ts'), 'utf8');
		for (const id of Object.keys(manifest.contributes.configuration.properties)) {
			const name = id.replace(/^xit\./, '');
			assert.ok(source.includes(`'${name}'`), `${id} is contributed but never read`);
		}
	});
});

describe('test scripts', () => {
	it('passes --headless explicitly to the web run', () => {
		// @vscode/test-web documents --headless as defaulting to true when an
		// extensionTestsPath is given. On the command line it does not, and
		// the reason is worth writing down, because the code reads as though
		// it works:
		//
		//   const headless = options.headless ?? options.extensionTestsPath !== undefined;
		//
		// minimist is handed `boolean: [... 'headless' ...]`, and minimist
		// sets a declared boolean flag to false when it is absent, not to
		// undefined. `false ?? anything` is false, so the fallback is dead on
		// the CLI path. It works through the API, where the field really is
		// undefined. Measured: without the flag, a Chromium window opens.
		// With it, the launched Chromium carries --headless in its argv.
		assert.match(manifest.scripts['test:web'], /(^|\s)--headless(\s|$)/);
	});

	it('runs the tests against a real folder', () => {
		// The language-association test looks for a .xit file in the
		// workspace. Without a folder argument the run opens on an empty
		// workbench and that test fails for a reason that looks like a bug in
		// the extension.
		assert.match(manifest.scripts['test:web'], /\sdemo(\s|$)/);
		assert.match(readFileSync(resolve(REPO_ROOT, '.vscode-test.mjs'), 'utf8'), /workspaceFolder:\s*'demo'/);
		assert.ok(existsSync(resolve(REPO_ROOT, 'demo/showcase.xit')));
	});

	it('builds the web test bundle before running it', () => {
		// vscode-test-web fails with a bare "path does not exist" if the
		// bundle is stale or missing, which says nothing about the cause.
		assert.match(manifest.scripts['test:web'], /^npm run build\s*&&/);
		assert.match(manifest.scripts['test:web'], /--extensionTestsPath=dist\/web\/test\/index\.js/);
	});
});

describe('the integration tests copy of the manifest', () => {
	// src/test/manifest.ts holds publisher, name and the command ids as
	// literals, because the integration tests also run in a web worker, where
	// require('../../package.json') cannot work. Literals drift. This is the
	// thing that stops them: without it, a rename would leave the integration
	// tests looking for an extension id that no longer exists, and they would
	// fail somewhere far from the cause.

	it('agrees with package.json on the extension identity', () => {
		assert.equal(testConstant('PUBLISHER'), manifest.publisher);
		assert.equal(testConstant('NAME'), manifest.name);
	});

	it('lists exactly the contributed commands', () => {
		assert.deepEqual(
			testConstant('COMMANDS'),
			manifest.contributes.commands.map((command) => command.command),
		);
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
