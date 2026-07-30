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
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT } from './tokenizer.mjs';

const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));

function bundle(field) {
	const path = resolve(REPO_ROOT, manifest[field]);
	assert.ok(existsSync(path), `${manifest[field]} does not exist; run \`npm run build\``);
	return readFileSync(path, 'utf8');
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
	const NODE_ONLY = ['__dirname', '__filename', 'process.', 'Buffer.', 'setImmediate('];

	it('touches no Node-only global', () => {
		const source = bundle('browser');
		for (const name of NODE_ONLY) {
			assert.ok(!source.includes(name), `the web bundle uses ${name}, which a web worker does not have`);
		}
	});

	it('is a single file, because a worker cannot load a second one', () => {
		// The web extension host has no module loader and no importScripts.
		// esbuild would emit a chunk beside the entry if anything were split.
		assert.ok(!existsSync(resolve(REPO_ROOT, 'dist/web/chunk.js')));
		assert.doesNotMatch(bundle('browser'), /\bimportScripts\b/);
	});
});
