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

const targets = [
	{
		...common,
		// VS Code 1.75, the engine floor, runs on Electron 19 and Node 16.
		platform: 'node',
		target: 'node16',
		format: 'cjs',
		outfile: 'dist/extension.js',
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
