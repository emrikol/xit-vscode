/**
 * Configuration for @vscode/test-cli, the runner the VS Code team publishes
 * for integration tests.
 *
 * It downloads a real VS Code the first time and caches it in .vscode-test/,
 * then launches an Extension Development Host and runs the tests inside it.
 * That is why these are not in `npm test`: the unit tests run in a second and
 * are on the pre-commit hook, and this one needs a browser-sized download and
 * opens a window.
 */

import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	version: 'stable',
	// A real folder with a real .xit file in it, so the language-association
	// test has something to find.
	workspaceFolder: 'demo',
	mocha: {
		ui: 'bdd',
		timeout: 20000,
	},
});
