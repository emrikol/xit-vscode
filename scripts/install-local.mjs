/**
 * Package the extension and install it into VS Code.
 *
 *   npm run install:local
 *
 * Deliberately its own script rather than a step tacked onto `build`, and the
 * reason is worth writing down because "install whenever the build succeeds"
 * is the obvious thing to want.
 *
 * `npm run build` is what `npm test` runs first, and `npm test` is what the
 * pre-commit hook runs. So building and installing together would reinstall
 * the extension on every test run and every commit - tens of times in a
 * working session, each one silently replacing what is running in the editor
 * you have open, in the middle of unrelated work. A reinstall is a change to
 * the machine, and it should happen when you ask for it.
 *
 * The version never changes - the manifest says 0.1.0 and this is unpublished
 * - so VS Code has no reason to believe anything is new. Hence --force on
 * every install, and hence there is no version number to check afterwards if
 * you later wonder which build is running. That is what the git hash printed
 * at the end is for.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Run a command, letting its output through, and fail loudly rather than silently. */
function run(command, args, { quiet = false } = {}) {
	return execFileSync(command, args, {
		cwd: REPO_ROOT,
		encoding: 'utf8',
		stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
	});
}

/** Whichever VS Code command-line tool is on PATH, or null. */
function editorCommand() {
	for (const candidate of ['code', 'code-insiders', 'codium']) {
		try {
			run('which', [candidate], { quiet: true });
			return candidate;
		} catch {
			// Not installed. Try the next one.
		}
	}
	return null;
}

const editor = editorCommand();

if (!editor) {
	console.error('install-local: no VS Code command line tool found on PATH.');
	console.error("            open VS Code and run “Shell Command: Install 'code' command in PATH”,");
	console.error('            or install the vsix by hand from the Extensions view.');
	process.exit(1);
}

const workspace = mkdtempSync(resolve(tmpdir(), 'xit-install-'));
const vsix = resolve(workspace, 'xit.vsix');

try {
	// --no-git-tag-version because the version is not bumped per build, and
	// vsce otherwise refuses on a repository whose tag does not match.
	run('npx', ['--yes', '@vscode/vsce', 'package', '--no-git-tag-version', '--out', vsix]);
	run(editor, ['--install-extension', vsix, '--force']);

	// Which build is now installed. The version cannot say, so this does.
	let describe = 'unknown revision';
	try {
		describe = run('git', ['describe', '--always', '--dirty'], { quiet: true }).trim();
	} catch {
		// Not a git checkout, or no commits yet. Not worth failing over.
	}

	console.log(`\ninstall-local: installed into ${editor} at ${describe}.`);
	console.log('               reload the window to pick it up: Developer: Reload Window');
} finally {
	rmSync(workspace, { recursive: true, force: true });
}
