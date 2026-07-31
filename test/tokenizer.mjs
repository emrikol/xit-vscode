/**
 * Tokenizer harness for the [x]it! TextMate grammar.
 *
 * The tests run the grammar through vscode-textmate and vscode-oniguruma,
 * which are the same libraries VS Code uses. This matters: the grammar is
 * evaluated by Oniguruma, not by the JavaScript RegExp engine, and the two
 * do not agree on every pattern.
 */

import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

// Both libraries ship CommonJS only, and their ESM interop namespace does not
// expose the named exports. Require them instead.
const oniguruma = require('vscode-oniguruma');
const textmate = require('vscode-textmate');

export const REPO_ROOT = resolve(here, '..');
export const GRAMMAR_PATH = resolve(REPO_ROOT, 'syntaxes/xit.tmLanguage.json');
export const FIXTURE_PATH = resolve(here, 'fixtures/reference.xit');

const SCOPE_NAME = 'source.xit';

/**
 * Every grammar this extension ships, by the scope name it declares.
 *
 * The Markdown one is here so its fenced-code rule can be tested without a
 * Markdown grammar to inject into. Loaded on its own it still tokenizes a
 * fenced block, because its patterns are top-level; the injectionSelector
 * only decides where VS Code splices it in. That keeps the test independent
 * of a downloaded copy of VS Code, which only exists after `test:integration`
 * has run once and is not in the repository.
 */
const GRAMMARS = {
	[SCOPE_NAME]: GRAMMAR_PATH,
	'markdown.xit.codeblock': resolve(REPO_ROOT, 'syntaxes/xit.markdown.tmLanguage.json'),
};

const grammarPromises = new Map();

async function loadGrammar(scopeName) {
	await oniguruma.loadWASM(await readFile(require.resolve('vscode-oniguruma/release/onig.wasm')));

	const registry = new textmate.Registry({
		onigLib: Promise.resolve({
			createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
			createOnigString: (string) => new oniguruma.OnigString(string),
		}),
		loadGrammar: async (wanted) => {
			const path = GRAMMARS[wanted];
			if (!path) return null;
			return textmate.parseRawGrammar(await readFile(path, 'utf8'), path);
		},
	});

	const grammar = await registry.loadGrammar(scopeName);
	if (!grammar) throw new Error(`could not load grammar for ${scopeName}`);
	return grammar;
}

export function grammar(scopeName = SCOPE_NAME) {
	if (!grammarPromises.has(scopeName)) grammarPromises.set(scopeName, loadGrammar(scopeName));
	return grammarPromises.get(scopeName);
}

/**
 * Tokenize a whole document.
 *
 * The rule stack carries across lines, so multi-line constructs (indented
 * description continuations, and later on comment blocks) behave as they do
 * in the editor.
 *
 * @param {string} text
 * @param {string} [scopeName] which of this extension's grammars to use
 * @returns {Promise<Array<{ text: string, tokens: Array<{ text: string, scopes: string[] }> }>>}
 */
export async function tokenize(text, scopeName) {
	const rules = await grammar(scopeName);
	let stack = textmate.INITIAL;

	return text.split(/\r?\n/).map((line) => {
		const result = rules.tokenizeLine(line, stack);
		stack = result.ruleStack;
		return {
			text: line,
			tokens: result.tokens.map((token) => ({
				text: line.slice(token.startIndex, token.endIndex),
				scopes: token.scopes,
			})),
		};
	});
}

/** Tokenize a single line on its own. */
export async function tokenizeLine(line) {
	const [first] = await tokenize(line);
	return first;
}

/**
 * Every piece of text on a line that carries a scope containing `fragment`.
 *
 * Whitespace-only tokens are dropped, and adjacent tokens that share the
 * scope are joined, so a caller can assert on "the priority" rather than on
 * however many tokens the grammar happened to split it into.
 *
 * @param {{ tokens: Array<{ text: string, scopes: string[] }> }} line
 * @param {string} fragment
 * @returns {string[]}
 */
export function scoped(line, fragment) {
	const runs = [];
	let open = false;

	for (const token of line.tokens) {
		if (token.scopes.some((scope) => scope.includes(fragment))) {
			if (open) runs[runs.length - 1] += token.text;
			else runs.push(token.text);
			open = true;
		} else {
			open = false;
		}
	}

	return runs.map((run) => run.trim()).filter(Boolean);
}

/** Convenience for the common "there should be exactly one of these" case. */
export function onlyScoped(line, fragment) {
	const runs = scoped(line, fragment);
	return runs.length === 1 ? runs[0] : null;
}

/** The reference conformance fixture, split into lines. */
export async function fixture() {
	return readFile(FIXTURE_PATH, 'utf8');
}
