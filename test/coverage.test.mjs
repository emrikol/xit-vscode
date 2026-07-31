/**
 * Every reader, against every format element, classified.
 *
 * `test/parity.test.mjs` detects a reader that treats one element differently
 * from its sibling. It cannot reach elements with no sibling - nesting,
 * titles, comments, directives, ids, estimates - and everything found in that
 * hole was found by hand: alignment padding across nesting levels, a group
 * with a comment in it never sorting, parked tags leaking into completion.
 *
 * This is the ledger that closes it. Fourteen readers by eleven elements is
 * 154 cells, and every one must be declared:
 *
 *   must  the reader has to understand this, and a named test exercises it
 *   gap   it does not, and a task says so
 *   n/a   it has no business knowing, with the reason
 *
 * A cell left out fails. A `must` whose test does not actually exercise the
 * element fails. A `gap` without a task number fails. So adding a format
 * element, or a new reader, forces someone to say what happens in each new
 * cell rather than leaving it unexamined - which is the only property that
 * makes "have we found all the gaps" answerable at all.
 *
 * This is a coverage ledger, not a behavioural check. It cannot tell you a
 * reader is *correct* about an element, only that something exercises it.
 * `test/parity.test.mjs` records why a behavioural version was tried and
 * rejected.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** How to recognise a document exercising each element, in a test's source. */
const ELEMENTS = {
	status: /\[[@~?>]\]/,
	priority: /\[[ x@~?>]\] *!/,
	due: /-> *\d{4}/,
	start: /<- *\d{4}/,
	tags: /#[a-z]/i,
	title: /'# |"# /,
	comment: /<!--/,
	nesting: /\\t\[/,
	ids: /#(id|after)=/,
	estimate: /#est=/,
	directive: /xit: /,
};

/**
 * A named test's source.
 *
 * Integration tests live in `src/test/` and are named with that prefix. Some
 * behaviour can only be covered there - a command's guard needs a real
 * document - and a ledger that could not point at them would push cells to
 * `n/a` that are genuinely tested.
 */
const source = (file) => readFileSync(new URL(file.startsWith('../') ? file : `./${file}`, import.meta.url), 'utf8');

const LEDGER = {
	outline: {
		must: { status: 'outline.test.mjs', due: 'outline.test.mjs', start: 'outline.test.mjs', tags: 'outline.test.mjs',
			title: 'outline.test.mjs', comment: 'outline.test.mjs', nesting: 'outline.test.mjs' },
		gap: {},
		na: { priority: 'stays in the description text, which the name shows verbatim',
			ids: 'a tag like any other in the name', estimate: 'a tag like any other in the name',
			directive: 'lives in a comment, which the outline already skips' },
	},
	folding: {
		must: { title: 'folding.test.mjs', comment: 'folding.test.mjs', nesting: 'folding.test.mjs' },
		gap: {},
		na: { status: 'a fold covers an item whatever its checkbox says',
			priority: 'not structural', due: 'not structural', start: 'not structural',
			tags: 'not structural', ids: 'not structural', estimate: 'not structural',
			directive: 'lives in a comment, which folds as a comment' },
	},
	sort: {
		must: { priority: 'sort.test.mjs', due: 'sort.test.mjs', title: 'sort.test.mjs', nesting: 'sort.test.mjs',
			comment: 'sort.test.mjs', start: 'sort.test.mjs', status: 'sort.test.mjs',
			ids: 'invariants.test.mjs' },
		gap: {},
		na: { tags: 'carried with the line', estimate: 'ranking by estimate is not what this sorts by',
			directive: 'lives in a comment' },
	},
	archive: {
		must: { status: 'archive.test.mjs', title: 'archive.test.mjs', comment: 'archive.test.mjs',
			nesting: 'archive.test.mjs', directive: 'directive.test.mjs', ids: 'invariants.test.mjs' },
		gap: {},
		na: { priority: 'carried with the line', due: 'carried with the line',
			start: 'carried with the line', tags: 'carried with the line', estimate: 'carried with the line' },
	},
	migrate: {
		must: { priority: 'migrate.test.mjs', title: 'migrate.test.mjs', comment: 'migrate.test.mjs',
			nesting: 'migrate.test.mjs' },
		gap: {},
		na: { status: 'untouched by every transform', due: 'untouched', start: 'untouched',
			tags: 'untouched', ids: 'untouched', estimate: 'untouched',
			directive: 'lives in a comment, which migration leaves alone' },
	},
	diagnostics: {
		must: { priority: 'diagnostics.test.mjs', due: 'diagnostics.test.mjs', start: 'diagnostics.test.mjs',
			tags: 'diagnostics.test.mjs', title: 'diagnostics.test.mjs', comment: 'diagnostics.test.mjs',
			nesting: 'diagnostics.test.mjs', estimate: 'diagnostics.test.mjs', ids: 'link.test.mjs',
			directive: 'directive.test.mjs' },
		gap: {},
		na: { status: 'a malformed checkbox is reported; a valid status has nothing to report' },
	},
	collect: {
		must: { status: 'collect.test.mjs', due: 'collect.test.mjs', start: 'collect.test.mjs',
			tags: 'collect.test.mjs', comment: 'collect.test.mjs', nesting: 'collect.test.mjs',
			estimate: 'estimate.test.mjs', ids: 'link.test.mjs', directive: 'directive.test.mjs' },
		gap: {},
		na: { priority: 'the sidebar shows it as part of the description',
			title: 'collect gathers items; titles are the outline\'s business' },
	},
	align: {
		must: { priority: 'align.test.mjs', comment: 'align.test.mjs', nesting: 'align.test.mjs' },
		gap: {},
		na: { status: 'every status can carry a priority, and does', due: 'not on the line\'s left edge',
			start: 'not on the line\'s left edge', tags: 'not on the line\'s left edge',
			title: 'has no priority', ids: 'a tag', estimate: 'a tag', directive: 'lives in a comment' },
	},
	link: {
		must: { ids: 'link.test.mjs', status: 'link.test.mjs', comment: 'link.test.mjs', tags: 'link.test.mjs' },
		gap: {},
		na: { priority: 'irrelevant to a reference', due: 'irrelevant', start: 'irrelevant',
			title: 'cannot carry an id, since it is not an item', nesting: 'an id is per item, not per level',
			estimate: 'irrelevant', directive: 'lives in a comment' },
	},
	repeat: {
		must: { status: 'repeat.test.mjs', priority: 'repeat.test.mjs', due: 'repeat.test.mjs',
			start: 'repeat.test.mjs', tags: 'repeat.test.mjs', nesting: 'repeat.test.mjs',
			comment: '../src/test/extension.test.ts' },
		gap: {},
		na: { title: 'not an item', ids: 'carried to the next occurrence unchanged, like any tag',
			estimate: 'carried unchanged', directive: 'lives in a comment' },
	},
	tag: {
		must: { tags: 'tag.test.mjs', ids: 'tag.test.mjs', estimate: 'tag.test.mjs',
			nesting: 'tag.test.mjs', comment: 'tag.test.mjs' },
		gap: {},
		na: { status: 'a tag is read from a description, whatever the checkbox',
			priority: 'read separately', due: 'read separately', start: 'read separately',
			title: 'has no description', directive: 'read by src/directive.ts, not here' },
	},
	cycle: {
		must: { tags: 'cycle.test.mjs' },
		gap: {},
		na: { status: 'reads two date tags and nothing else', priority: 'irrelevant', due: 'irrelevant',
			start: 'irrelevant', title: 'not an item', comment: 'collect filters parked items first',
			nesting: 'per item', ids: 'irrelevant', estimate: 'irrelevant', directive: 'irrelevant' },
	},
	estimate: {
		must: { tags: 'estimate.test.mjs', estimate: 'estimate.test.mjs' },
		gap: {},
		na: { status: 'reads one tag and nothing else', priority: 'irrelevant', due: 'irrelevant',
			start: 'irrelevant', title: 'not an item', comment: 'collect filters parked items first',
			nesting: 'per item', ids: 'irrelevant', directive: 'irrelevant' },
	},
	directive: {
		must: { directive: 'directive.test.mjs', tags: 'directive.test.mjs', comment: 'directive.test.mjs' },
		gap: {},
		na: { status: 'a directive is not an item', priority: 'not an item', due: 'not an item',
			start: 'not an item', title: 'a directive lives in a comment, not a title',
			nesting: 'file-level, not per item', ids: 'not a directive key', estimate: 'not a directive key' },
	},
};

describe('every reader is classified against every element', () => {
	const elements = Object.keys(ELEMENTS);

	it('leaves no cell undeclared', () => {
		const undeclared = [];
		for (const [reader, { must, gap, na }] of Object.entries(LEDGER)) {
			for (const element of elements) {
				const where = [must[element] && 'must', gap[element] && 'gap', na[element] && 'n/a'].filter(Boolean);
				if (where.length !== 1) undeclared.push(`${reader} x ${element}: declared ${where.length} times`);
			}
		}
		assert.deepEqual(undeclared, [],
			`every cell must be exactly one of must, gap or n/a:\n  ${undeclared.join('\n  ')}`);
	});

	it('exercises everything it claims to', () => {
		const unproven = [];
		for (const [reader, { must }] of Object.entries(LEDGER)) {
			for (const [element, file] of Object.entries(must)) {
				if (!ELEMENTS[element].test(source(file))) unproven.push(`${reader} x ${element}: ${file} does not exercise it`);
			}
		}
		assert.deepEqual(unproven, [],
			`a cell claims to be covered and is not:\n  ${unproven.join('\n  ')}`);
	});

	it('has no gap left', () => {
		// Every one of the 154 cells is now `must` with a test that exercises
		// it, or `n/a` with a reason. This assertion is not decoration: it is
		// what stops a future gap being parked here indefinitely instead of
		// being fixed, and it fails the moment one is added.
		const open = Object.entries(LEDGER).flatMap(([reader, { gap }]) =>
			Object.entries(gap).map(([element, task]) => `${reader} x ${element}: ${task}`));
		assert.deepEqual(open, [], `cells still recorded as gaps:\n  ${open.join('\n  ')}`);
	});

	it('gives every gap a task number', () => {
		const loose = [];
		for (const [reader, { gap }] of Object.entries(LEDGER)) {
			for (const [element, task] of Object.entries(gap)) {
				if (!/^#\d+$/.test(task)) loose.push(`${reader} x ${element}: ${JSON.stringify(task)} is not a task number`);
			}
		}
		assert.deepEqual(loose, [], `a gap must name the task tracking it:\n  ${loose.join('\n  ')}`);
	});

	it('covers every reader that reads a document', () => {
		// A new reader with no ledger entry is the failure this exists to
		// prevent, so the list is asserted rather than derived from the ledger.
		assert.deepEqual(Object.keys(LEDGER).sort(), [
			'align', 'archive', 'collect', 'cycle', 'diagnostics', 'directive', 'estimate',
			'folding', 'link', 'migrate', 'outline', 'repeat', 'sort', 'tag',
		]);
	});
});
