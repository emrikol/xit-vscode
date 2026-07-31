/**
 * Tests for the built bundles.
 *
 * The web bundle is the one that needs watching. It runs in a web worker,
 * where there is no module loader, no importScripts and no Node standard
 * library. Nothing in the toolchain fails when a Node builtin creeps in: the
 * build succeeds, the vsix packages, and the extension throws on activation
 * in vscode.dev, where nobody is watching the console.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { builtinModules } from 'node:module';

import { REPO_ROOT } from './tokenizer.mjs';

const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));

/** The web test bundle, which the manifest does not name because it does not ship. */
const WEB_TEST_BUNDLE = 'dist/web/test/index.js';

function read(path) {
	const full = resolve(REPO_ROOT, path);
	assert.ok(existsSync(full), `${path} does not exist; run \`npm run build\``);
	return readFileSync(full, 'utf8');
}

function bundle(field) {
	return read(manifest[field]);
}

/** Every module the bundle asks the host for at run time. */
function requiredModules(source) {
	return new Set([...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map(([, id]) => id));
}

describe('both bundles', () => {
	it('are declared and built', () => {
		assert.equal(manifest.main, './dist/extension.js');
		assert.equal(manifest.browser, './dist/web/extension.js');
		bundle('main');
		bundle('browser');
	});

	it('ask the host for nothing but vscode', () => {
		// Anything else means the bundler left a dependency unresolved, which
		// fails at activation rather than at build time.
		for (const field of ['main', 'browser']) {
			assert.deepEqual([...requiredModules(bundle(field))], ['vscode'], `${field} bundle`);
		}
	});
});

describe('web bundle', () => {
	// Names that exist in Node and in the Electron extension host but not in
	// a web worker. A hit here is a crash on vscode.dev.
	//
	// Anchored on a word boundary rather than matched as substrings. "Buffer."
	// as a substring also matches "ArrayBuffer.", which is perfectly legal in
	// a worker, and that false positive would one day fail the build for
	// nothing.
	const NODE_ONLY = [/\b__dirname\b/, /\b__filename\b/, /\bprocess\./, /\bBuffer\./, /\bsetImmediate\(/];

	it('touches no Node-only global', () => {
		const source = bundle('browser');
		for (const pattern of NODE_ONLY) {
			assert.doesNotMatch(source, pattern, `the web bundle uses ${pattern.source}, which a web worker does not have`);
		}
	});

	it('is a single file, because a worker cannot load a second one', () => {
		// The web extension host has no module loader and no importScripts.
		// esbuild would emit a chunk beside the entry if anything were split.
		assert.ok(!existsSync(resolve(REPO_ROOT, 'dist/web/chunk.js')));
		assert.doesNotMatch(bundle('browser'), /\bimportScripts\b/);
	});
});

describe('web test bundle', () => {
	// The integration tests, bundled for the same worker so they can run in a
	// headless browser instead of a windowed Electron. It carries all of
	// mocha, which is why it is checked differently from the extension
	// bundle: scanning three quarters of a megabyte of vendored code for the
	// name of a Node global finds it in error message strings, not in live
	// code. What is checked here is the contract with the host.

	it('is built beside the extension bundle', () => {
		read(WEB_TEST_BUNDLE);
	});

	it('exports the run() the host calls', () => {
		// @vscode/test-web imports this module and calls run(). No run, and
		// the run fails with nothing useful said about why.
		assert.match(read(WEB_TEST_BUNDLE), /\brun:\s*\(\)\s*=>\s*run\b/);
	});

	it('asks the host for vscode', () => {
		assert.ok(requiredModules(read(WEB_TEST_BUNDLE)).has('vscode'));
	});

	it('leaves no Node builtin unbundled', () => {
		// The extension bundles are checked against an exact list of one. That
		// does not work here: mocha's own JSDoc contains `require('mocha')`,
		// and with minify off the comment survives into the output. So this
		// asks the question that actually matters instead. A literal require
		// of a Node builtin is a module the bundler could not resolve, which
		// is a worker that dies on load. mocha's node entry point would drag
		// in fs and child_process exactly this way, so this is really a check
		// that mainFields put `browser` first.
		const builtins = new Set(builtinModules);
		for (const id of requiredModules(read(WEB_TEST_BUNDLE))) {
			const name = id.replace(/^node:/, '');
			assert.ok(!builtins.has(name), `the web test bundle requires ${id}, which a worker does not have`);
		}
	});

	it('is a single file', () => {
		assert.doesNotMatch(read(WEB_TEST_BUNDLE), /\bimportScripts\b/);
	});

	it('runs every test file there is', () => {
		// src/test/index.ts names its test files one import at a time,
		// because esbuild has no equivalent of the require.context glob the
		// official sample uses. A new test file that nobody adds to that list
		// would not fail: it would silently never run, and the suite would
		// still report green. This is what notices.
		const runner = read('src/test/index.ts');
		const files = readdirSync(resolve(REPO_ROOT, 'src/test')).filter((name) => name.endsWith('.test.ts'));

		assert.ok(files.length > 0, 'no test files found in src/test');
		for (const file of files) {
			const specifier = `./${file.replace(/\.ts$/, '')}`;
			assert.match(
				runner,
				new RegExp(`import\\('${specifier.replace('.', '\\.')}'\\)`),
				`src/test/index.ts never imports ${file}, so it would never run`,
			);
		}
	});

	it('stays out of the vsix', () => {
		// Nothing here ships. It is bigger than the extension bundle by two
		// orders of magnitude, and it is test code.
		const ignored = readFileSync(resolve(REPO_ROOT, '.vscodeignore'), 'utf8');
		assert.match(ignored, /^dist\/web\/test\/\*\*$/m);
	});
});
