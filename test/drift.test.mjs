/**
 * The four rules implemented twice, with nothing checking they agree.
 *
 * This repo's house pattern is that duplication which cannot be removed is
 * detected instead - the grammar cannot import TypeScript and VS Code offers
 * no way to read TextMate tokens from an extension, so several rules exist in
 * both. Four were guarded: due date, start date, priority, tag. Four were not.
 *
 * Three of them are this fork's own syntax - marked titles, comments, tab
 * nesting - so the conformance corpus cannot exercise them at all: it contains
 * no `#` title, no `<!--`, and one tab-indented line. Coverage that cannot
 * fire is not coverage, which is why they need the fixture below rather than
 * the guide.
 *
 * The fourth, `invalid`, had something worse than no test: a comment in
 * src/diagnostics.ts asserting that the grammar's rule and the
 * `unrecognised-line` check "match each other exactly, so the squiggles and
 * the colours cannot contradict each other". Nothing verified it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { tokenize, scoped } from './tokenizer.mjs';

const require_ = createRequire(import.meta.url);
const { isTitle } = require_('../out/title.js');
const { commentLines } = require_('../out/comment.js');
const { problems } = require_('../out/diagnostics.js');
const { items } = require_('../out/tree.js');

/**
 * Documents that exercise the fork's own syntax.
 *
 * Deliberately awkward: the interesting disagreements are at the edges - a
 * bare marker, a tag-shaped line, an unterminated comment, a mixed indent.
 */
const DOCUMENTS = [
	['# Groceries', '[ ] Milk', '[x] Bread'],
	['#', '[ ] A title with no name above it'],
	['#groceries', '[ ] A bare tag is not a title'],
	['My TODO list', '- [ ] Buy milk', '* [ ] Call Sam', 'x] Slip', '[ x] Typo'],
	['[ ] Parent', '\t[ ] Child', '\t\t[ ] Grandchild', '[ ] Sibling'],
	['[ ] Parent', '  [ ] Two spaces do not nest', '    [ ] Four spaces continue'],
	['[ ] Parent', '\t  [ ] A mixed indent nests nowhere'],
	['<!-- on hold -->', '[ ] After a one-line comment'],
	['<!--', '[ ] Parked', '#  a parked title', '-->', '[ ] After a block'],
	['[ ] Before', '<!--', 'never closed'],
	['# Todos', '[ ] One', '', '# Next', '[ ] Two'],
	['[ ] Item ...', '    ... continued', '\t[ ] and a subtask'],
];

/** Which lines of a tokenized document carry `scope` anywhere. */
function linesWith(tokenized, scope) {
	return new Set(tokenized.flatMap((line, at) => (scoped(line, scope).length > 0 ? [at] : [])));
}

/** Compare two sets of line numbers, reporting the document when they differ. */
function agree(disagreements, what, document, fromGrammar, fromCode) {
	const a = [...fromGrammar].sort((x, y) => x - y);
	const b = [...fromCode].sort((x, y) => x - y);
	if (JSON.stringify(a) === JSON.stringify(b)) return;

	disagreements.push(
		`  ${what}\n${document.map((text, at) => `    ${at} ${JSON.stringify(text)}`).join('\n')}\n` +
			`    grammar:    ${JSON.stringify(a)}\n    TypeScript: ${JSON.stringify(b)}`,
	);
}

describe("the grammar and the TypeScript agree about the fork's own syntax", () => {
	it('finds the same titles', async () => {
		const disagreements = [];
		for (const document of DOCUMENTS) {
			const tokenized = await tokenize(document.join('\n'));
			agree(
				disagreements,
				'title',
				document,
				linesWith(tokenized, 'markup.other.task.title'),
				document.flatMap((text, at) => (isTitle(text) && !commentLines(document).has(at) ? [at] : [])),
			);
		}
		assert.deepEqual(disagreements, [], `src/title.ts has drifted from the grammar:\n\n${disagreements.join('\n\n')}`);
	});

	it('finds the same comments', async () => {
		const disagreements = [];
		for (const document of DOCUMENTS) {
			const tokenized = await tokenize(document.join('\n'));
			agree(disagreements, 'comment', document, linesWith(tokenized, 'markup.other.comment'), commentLines(document));
		}
		assert.deepEqual(
			disagreements,
			[],
			`src/comment.ts has drifted from the grammar:\n\n${disagreements.join('\n\n')}`,
		);
	});

	it('calls the same lines wrong, though not always by the same name', async () => {
		// The claim asserted in a comment and never checked - and it was not
		// quite true. `[ x] Typo` is `invalid` to the grammar and
		// `malformed-checkbox` to the diagnostics, which is a *more specific*
		// message rather than a contradiction. What has to hold is that every
		// line the grammar refuses to colour is a line the Problems panel
		// objects to, by whichever name fits best.
		const WRONG = ['unrecognised-line', 'malformed-checkbox'];
		const disagreements = [];

		for (const document of DOCUMENTS) {
			const tokenized = await tokenize(document.join('\n'));
			agree(
				disagreements,
				'invalid',
				document,
				linesWith(tokenized, 'markup.other.task.invalid'),
				new Set(
					problems(document)
						.filter((one) => WRONG.includes(one.code))
						.map((one) => one.line),
				),
			);
		}
		assert.deepEqual(
			disagreements,
			[],
			`the grammar's invalid rule has drifted from the diagnostics:\n\n${disagreements.join('\n\n')}`,
		);
	});

	it('reads every line the grammar calls an item, and says why it reads more', async () => {
		// src/tree.ts is deliberately the more permissive of the two: the
		// grammar describes the format and has to be strict, while items()
		// records every line holding a checkbox so a space-indented one is
		// unnested rather than lost.
		//
		// So they are not equal, and asserting equality would be wrong. What
		// must hold is the direction - the grammar's items are a subset - and
		// that every extra is a line the Problems panel already explains.
		const disagreements = [];

		for (const document of DOCUMENTS) {
			const tokenized = await tokenize(document.join('\n'));
			const fromGrammar = linesWith(tokenized, 'markup.other.task.checkbox');
			const fromCode = new Set([...items(document).keys()].filter((at) => !commentLines(document).has(at)));
			const explained = new Set(
				problems(document)
					.filter((one) => one.code === 'cannot-nest' || one.code === 'starts-after-due')
					.map((one) => one.line),
			);

			for (const at of fromGrammar) {
				if (!fromCode.has(at))
					disagreements.push(
						`  the grammar reads line ${at} of ${JSON.stringify(document)} as an item and src/tree.ts does not`,
					);
			}
			for (const at of fromCode) {
				// An extra is allowed where the Problems panel already objects
				// to that line, or to one above it. The second case is not
				// slack: once an indent that cannot nest is kept as an item -
				// so it is not lost - everything below measures against it, so
				// the two readers legitimately disagree about what follows. The
				// user has been told the indentation is wrong either way.
				const flagged = [...explained].some((one) => one <= at);
				if (!fromGrammar.has(at) && !explained.has(at) && !flagged) {
					disagreements.push(
						`  src/tree.ts reads line ${at} of ${JSON.stringify(document)} as an item, the grammar does not, and nothing reports it`,
					);
				}
			}
		}

		assert.deepEqual(disagreements, [], `src/tree.ts has drifted from the grammar:\n\n${disagreements.join('\n')}`);
	});
});
