/**
 * Entry point for the web extension test run.
 *
 * `@vscode/test-web` loads this module inside the web extension host and
 * calls the `run` it exports. Resolving means the suite passed; rejecting
 * fails the run and sets the exit code. Nothing else in the repo imports it.
 *
 * The desktop run does not use this file. @vscode/test-cli owns Mocha there
 * and loads out/test/**\/*.test.js itself. This is the same job done by hand,
 * because a web worker has no file system to discover test files in.
 */

// mocha's browser build, which puts `mocha` on the global. It is the build
// that survives a worker: it shims process.stdout onto console, and it checks
// for `document` before touching it, because there is none here.
import 'mocha/mocha';

export function run(): Promise<void> {
	// `reporter: undefined` is not a no-op. The browser build defaults to the
	// html reporter, which writes into a DOM element that does not exist in a
	// worker; undefined falls through to spec, which writes to stdout.
	mocha.setup({ ui: 'bdd', reporter: undefined, timeout: 20000 });

	// Imported here rather than at the top of the file, and this ordering is
	// the whole reason run() is shaped like this. The browser build only puts
	// describe and it on the global when setup() picks the ui, so a test file
	// pulled in any earlier calls a describe that does not exist yet.
	//
	// One line per test file. The official sample globs with webpack's
	// require.context; esbuild has no equivalent, so test/bundle.test.mjs
	// checks the list against src/test/*.test.ts instead.
	return import('./extension.test').then(
		() =>
			new Promise<void>((resolve, reject) => {
				try {
					mocha.run((failures) => {
						if (failures > 0) {
							reject(new Error(`${failures} tests failed.`));
						} else {
							resolve();
						}
					});
				} catch (error) {
					// Without this the failure surfaces as a browser timeout
					// with no output at all.
					console.error(error);
					reject(error);
				}
			}),
	);
}
