/**
 * Bringing an older file up to date.
 *
 * Three forks landed together - tab nesting, marked titles, priority without
 * dots - and each changes what an existing document means. This is the one
 * pass that applies all three.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { migrate, tabIndent, markTitles, stripPriorityDots } = createRequire(import.meta.url)('../out/migrate.js');
const { problems } = createRequire(import.meta.url)('../out/diagnostics.js');

describe('indentation', () => {
	it('turns two-space nesting into tabs', () => {
		assert.deepEqual(
			tabIndent(['[ ] Parent', '  [x] One', '  [ ] Two']),
			['[ ] Parent', '\t[x] One', '\t[ ] Two'],
		);
	});

	it('counts depth from the nesting, not from the width', () => {
		// The old rule was "deeper than the line above", not a fixed width, so
		// an inconsistent file still nested and has to keep its shape.
		assert.deepEqual(
			tabIndent(['[ ] A', '  [ ] B', '     [ ] C', '  [ ] D']),
			['[ ] A', '\t[ ] B', '\t\t[ ] C', '\t[ ] D'],
		);
	});

	it('moves a continuation with its item', () => {
		// Four spaces after the item's own indent, which has to stay four so
		// the text still lands under the description.
		assert.deepEqual(
			tabIndent(['[ ] Parent', '  [ ] Child ...', '      ... continued']),
			['[ ] Parent', '\t[ ] Child ...', '\t    ... continued'],
		);
	});

	it('resets at a blank line, as the nesting always did', () => {
		assert.deepEqual(
			tabIndent(['[ ] A', '  [ ] B', '', '  [ ] C']),
			['[ ] A', '\t[ ] B', '', '[ ] C'],
		);
	});

	it('leaves a comment alone', () => {
		const lines = ['<!--', '  [ ] parked', '-->'];
		assert.deepEqual(tabIndent(lines), lines);
	});
});

describe('titles', () => {
	it('marks an unmarked title', () => {
		assert.deepEqual(markTitles(['Groceries', '[ ] Milk']), ['# Groceries', '[ ] Milk']);
	});

	it('leaves a line that was already marked', () => {
		assert.deepEqual(markTitles(['# Groceries']), ['# Groceries']);
	});

	it('does not mark something that was meant to be an item', () => {
		// The bug marked titles exist to remove. Writing `# ` in front of
		// `- [ ] Buy milk` would preserve it forever; left alone it becomes an
		// unrecognised-line error the next time the file is opened.
		for (const text of ['- [ ] Buy milk', '* [ ] Call Sam', '[ x] Typo']) {
			assert.deepEqual(markTitles([text]), [text], text);
		}
	});

	it('leaves items, continuations and comments alone', () => {
		const lines = ['[ ] Item ...', '    ... continued', '<!-- parked -->'];
		assert.deepEqual(markTitles(lines), lines);
	});
});

describe('priority', () => {
	it('strips padding and keeps the marks', () => {
		assert.deepEqual(stripPriorityDots(['[ ] ..! Do this']), ['[ ] ! Do this']);
		assert.deepEqual(stripPriorityDots(['[ ] !!. Do this']), ['[ ] !! Do this']);
	});

	it('removes a priority that was only dots, and its separator', () => {
		// Dots alone carried an importance of zero. With nothing left of the
		// priority, the space before the description goes with it.
		assert.deepEqual(stripPriorityDots(['[ ] ... Not important']), ['[ ] Not important']);
		assert.deepEqual(stripPriorityDots(['[ ] . Not important']), ['[ ] Not important']);
	});

	it('leaves a priority that never had dots', () => {
		assert.deepEqual(stripPriorityDots(['[ ] !!! Ship it']), ['[ ] !!! Ship it']);
	});

	it('leaves dots in a description alone', () => {
		assert.deepEqual(stripPriorityDots(['[ ] Wait for it ...']), ['[ ] Wait for it ...']);
		assert.deepEqual(stripPriorityDots(['[ ] ! Wait ... for it']), ['[ ] ! Wait ... for it']);
	});
});

describe('the whole migration', () => {
	const OLD = [
		'Groceries',
		'[ ] ..! Milk',
		'  [x] Bread',
		'      ... the sourdough one',
		'',
		'Work',
		'[ ] ... Tidy the desk',
	];

	const NEW = [
		'# Groceries',
		'[ ] ! Milk',
		'\t[x] Bread',
		'\t    ... the sourdough one',
		'',
		'# Work',
		'[ ] Tidy the desk',
	];

	it('applies all three in one pass', () => {
		assert.deepEqual(migrate(OLD).lines, NEW);
	});

	it('reports every line it touched, and no others', () => {
		const { changes } = migrate(OLD);
		assert.deepEqual(changes.map((change) => change.line), [0, 1, 2, 3, 5, 6]);
		assert.equal(changes[0].before, 'Groceries');
		assert.equal(changes[0].after, '# Groceries');
	});

	it('is idempotent, so migrating twice is migrating once', () => {
		// Nobody remembers which files they have already done.
		const once = migrate(OLD).lines;
		const twice = migrate(once);
		assert.deepEqual(twice.lines, once);
		assert.deepEqual(twice.changes, []);
	});

	it('leaves a file that is already current completely alone', () => {
		assert.deepEqual(migrate(NEW).changes, []);
	});

	it('produces a document the diagnostics are happy with', () => {
		// The real test of a migration: the output has nothing left to report.
		assert.deepEqual(problems(migrate(OLD).lines), []);
	});

	it('does not lose a line', () => {
		assert.equal(migrate(OLD).lines.length, OLD.length);
	});
});
