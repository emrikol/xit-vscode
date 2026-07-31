/**
 * Bundle the extension with esbuild.
 *
 * VS Code loads one file per extension host, and it loads it on activation.
 * Shipping the raw tsc output means one require() per module at that moment;
 * a bundle means one. It also strips comments and type-only leftovers, so the
 * vsix is smaller.
 *
 * Type checking is not esbuild's job. `npm run compile` runs tsc for that, and
 * emits to out/ for the tests to require.
 *
 *   node scripts/build.mjs              development bundle, with source maps
 *   node scripts/build.mjs --production minified, no source maps
 *   node scripts/build.mjs --watch      rebuild on change
 */

import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const common = {
	entryPoints: ['src/extension.ts'],
	bundle: true,
	// `vscode` is provided by the host at run time. Bundling it is impossible
	// and trying to resolve it is an error.
	external: ['vscode'],
	minify: production,
	sourcemap: !production,
	logLevel: 'warning',
};

/** Shared by everything that runs in the web extension host's worker. */
const WEB = {
	platform: 'browser',
	target: 'es2022',
	format: 'cjs',
	// So esbuild picks the browser build of a package that ships both. mocha
	// is the one that matters: its node entry loads fs and child_process.
	mainFields: ['browser', 'module', 'main'],
};

const targets = [
	{
		...common,
		// VS Code 1.75, the engine floor, runs on Electron 19 and Node 16.
		platform: 'node',
		target: 'node16',
		format: 'cjs',
		outfile: 'dist/extension.js',
	},
	{
		...common,
		// The web extension host runs each extension in a web worker. There
		// is no module loader and no importScripts, so a single file is not
		// an optimisation there, it is the only thing that loads. `vscode`
		// stays external because the host intercepts that one require.
		...WEB,
		outfile: 'dist/web/extension.js',
	},
	{
		...common,
		...WEB,
		// The integration tests, bundled for the same worker, so they can run
		// headless in a browser instead of in a windowed Electron. Mocha and
		// the assert shim come along: there is nothing to require them from.
		entryPoints: ['src/test/index.ts'],
		outfile: 'dist/web/test/index.js',
		// Never minified, even for a release build. Nothing here ships, and a
		// minified stack trace from a failing assertion is worthless. The
		// vsix excludes dist/web/test; the pre-push hook checks that it did.
		minify: false,
		sourcemap: true,
		// mocha's browser entry starts by assigning to process.stdout, and
		// the assert shim reaches for process.env. Neither exists in a
		// worker. webpack's ProvidePlugin does this in the official sample;
		// inject is esbuild's equivalent.
		inject: ['scripts/process-shim.mjs'],
	},
];

if (watch) {
	const contexts = await Promise.all(targets.map((options) => esbuild.context(options)));
	await Promise.all(contexts.map((context) => context.watch()));
	console.log('build: watching');
} else {
	await Promise.all(targets.map((options) => esbuild.build(options)));
	console.log(`build: wrote ${targets.map((target) => target.outfile).join(', ')}`);
}
