/**
 * Inject the Markdown grammar for real, and check the fence highlights.
 *
 *   node scripts/verify-markdown-injection.mjs
 *
 * test/markdown.test.mjs tokenizes our injection on its own, which proves the
 * fenced-code rule works but says nothing about the wiring: whether
 * `injectionSelector` names a scope that Markdown actually produces, and
 * whether VS Code would splice the grammar in at all. Getting that wrong is
 * silent - the extension loads, the tests pass, and nothing is highlighted.
 *
 * This checks it against VS Code's own markdown.tmLanguage.json, using
 * vscode-textmate's getInjections hook, which is the same mechanism VS Code
 * uses to apply an `injectTo` grammar.
 *
 * It is a script rather than a test because it needs a copy of VS Code on
 * disk. `.vscode-test/` only exists after `npm run test:integration` has
 * downloaded one, and is not in the repository, so as a test it would either
 * fail on a clean checkout or skip itself quietly. Neither is worth having.
 */

import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const oniguruma = require('vscode-oniguruma');
const textmate = require('vscode-textmate');

const MARKDOWN_SCOPE = 'text.html.markdown';
const INJECTION_SCOPE = 'markdown.xit.codeblock';

/** VS Code's own Markdown grammar, from whatever build test-electron downloaded. */
async function findMarkdownGrammar() {
	const root = resolve(REPO_ROOT, '.vscode-test');
	const candidates = [];

	if (existsSync(root)) {
		for (const build of await readdir(root)) {
			candidates.push(resolve(root, build,
				'Visual Studio Code.app/Contents/Resources/app/extensions/markdown-basics/syntaxes/markdown.tmLanguage.json'));
			candidates.push(resolve(root, build,
				'resources/app/extensions/markdown-basics/syntaxes/markdown.tmLanguage.json'));
		}
	}
	candidates.push('/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/markdown-basics/syntaxes/markdown.tmLanguage.json');

	const found = candidates.find((path) => existsSync(path));
	if (!found) {
		console.error('verify-markdown-injection: no VS Code Markdown grammar found.');
		console.error('                           run `npm run test:integration` once to download one.');
		process.exit(2);
	}
	return found;
}

const markdownPath = await findMarkdownGrammar();

const PATHS = {
	[MARKDOWN_SCOPE]: markdownPath,
	[INJECTION_SCOPE]: resolve(REPO_ROOT, 'syntaxes/xit.markdown.tmLanguage.json'),
	'source.xit': resolve(REPO_ROOT, 'syntaxes/xit.tmLanguage.json'),
};

await oniguruma.loadWASM(await readFile(require.resolve('vscode-oniguruma/release/onig.wasm')));

const registry = new textmate.Registry({
	onigLib: Promise.resolve({
		createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
		createOnigString: (string) => new oniguruma.OnigString(string),
	}),
	loadGrammar: async (scope) => {
		const path = PATHS[scope];
		if (!path) return null;
		return textmate.parseRawGrammar(await readFile(path, 'utf8'), path);
	},
	// What `injectTo: ["text.html.markdown"]` in package.json means, expressed
	// the way vscode-textmate takes it. If injectionSelector does not match,
	// the grammar loads and simply never fires, which is the failure this
	// script exists to catch.
	getInjections: (scope) => (scope === MARKDOWN_SCOPE ? [INJECTION_SCOPE] : undefined),
});

const grammar = await registry.loadGrammar(MARKDOWN_SCOPE);

const document = [
	'# A heading',
	'',
	'Some **prose** before the block.',
	'',
	'```xit',
	'Todos',
	'[ ] ! Write the thing -> 2026-08-14 #work',
	'[x] Ship it',
	'```',
	'',
	'And *prose* after it.',
];

let stack = textmate.INITIAL;
const lines = document.map((line) => {
	const result = grammar.tokenizeLine(line, stack);
	stack = result.ruleStack;
	return result.tokens.map((token) => ({ text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes }));
});

const has = (index, fragment) =>
	lines[index].some((token) => token.scopes.some((scope) => scope.includes(fragment)));

const checks = [
	['item inside the fence is an xit checkbox', has(6, 'markup.other.task.checkbox.open')],
	['priority inside the fence', has(6, 'markup.other.task.priority')],
	['due date inside the fence', has(6, 'markup.other.task.date')],
	['tag inside the fence', has(6, 'markup.other.task.tag')],
	['checked item inside the fence', has(7, 'markup.other.task.checkbox.checked')],
	['fence content is marked embedded xit', has(6, 'meta.embedded.block.xit')],
	['heading above still highlights as Markdown', has(0, 'markup.heading')],
	['prose above is not xit', !has(2, 'markup.other.task')],
	['prose below is not xit', !has(10, 'markup.other.task')],
	['prose below still highlights as Markdown', has(10, 'markup.italic')],
];

console.log(`verify-markdown-injection: using ${markdownPath.replace(REPO_ROOT + '/', '')}`);
for (const [label, ok] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
	console.error(`\n${failed.length} check(s) failed: the injection is wired up wrong.`);
	console.error('Look at injectionSelector in syntaxes/xit.markdown.tmLanguage.json');
	console.error('and injectTo in package.json.');
	process.exit(1);
}
console.log('\nAll checks passed against VS Code\'s own Markdown grammar.');
