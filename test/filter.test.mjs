/**
 * Narrowing the sidebar to a tag, and grouping it by one.
 *
 * The reason this module exists is worth restating where it is tested: the
 * fork added file-wide tag directives and then read them nowhere, so a
 * `<!-- xit: tags=client-acme -->` at the top of a file changed nothing anyone
 * could see. These are the tests for the thing that finally reads them.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { UNTAGGED, byTag, describeSelection, matchesTags, tagChoices } = require_('../out/filter.js');
const { collect } = require_('../out/collect.js');

/** Rows as the view builds them, from real documents rather than hand-written tags. */
const tagsOf = (row) => row.tags;

describe('the tags on offer', () => {
	it('counts how many items carry each one', () => {
		const rows = [{ tags: ['work'] }, { tags: ['work', 'urgent'] }, { tags: ['home'] }];
		assert.deepEqual(tagChoices(rows, tagsOf), [
			{ tag: 'home', count: 1 },
			{ tag: 'urgent', count: 1 },
			{ tag: 'work', count: 2 },
		]);
	});

	it('counts an item with no tags under the untagged choice', () => {
		assert.deepEqual(tagChoices([{ tags: [] }, { tags: ['work'] }], tagsOf), [
			{ tag: 'work', count: 1 },
			{ tag: UNTAGGED, count: 1 },
		]);
	});

	it('puts the untagged choice last, wherever it falls alphabetically', () => {
		// UNTAGGED is the empty string, which sorts before everything. It is
		// not a tag and should not head the list of them.
		const [first] = tagChoices([{ tags: [] }, { tags: ['aaa'] }], tagsOf);
		assert.equal(first.tag, 'aaa');
	});

	it('is alphabetical, not commonest first', () => {
		// Ordering by count would rearrange the panel as items are ticked off,
		// so the group being read moves while it is read.
		const rows = [{ tags: ['zebra'] }, { tags: ['zebra'] }, { tags: ['apple'] }];
		assert.deepEqual(tagChoices(rows, tagsOf).map((choice) => choice.tag), ['apple', 'zebra']);
	});

	it('counts an item once per tag, however often the tag is written on it', () => {
		assert.deepEqual(tagChoices([{ tags: ['work', 'work'] }], tagsOf), [{ tag: 'work', count: 1 }]);
	});

	it('is empty for no rows', () => {
		assert.deepEqual(tagChoices([], tagsOf), []);
	});
});

describe('matching a selection', () => {
	it('passes everything when nothing is selected', () => {
		assert.equal(matchesTags(['work'], null), true);
		assert.equal(matchesTags([], null), true);
		assert.equal(matchesTags(['work'], new Set()), true);
	});

	it('passes an item carrying the selected tag', () => {
		assert.equal(matchesTags(['work', 'urgent'], new Set(['work'])), true);
	});

	it('turns away an item that does not carry it', () => {
		assert.equal(matchesTags(['home'], new Set(['work'])), false);
	});

	it('passes an item carrying any of several, not all of them', () => {
		// Ticking a second box in a picker adds to what is shown everywhere
		// else, and intersecting project tags is almost always empty.
		const selection = new Set(['work', 'home']);
		assert.equal(matchesTags(['home'], selection), true);
		assert.equal(matchesTags(['work'], selection), true);
	});

	it('matches an untagged item only against the untagged choice', () => {
		assert.equal(matchesTags([], new Set([UNTAGGED])), true);
		assert.equal(matchesTags([], new Set(['work'])), false);
		assert.equal(matchesTags(['work'], new Set([UNTAGGED])), false);
	});
});

describe('grouping by tag', () => {
	it('puts an item under each tag it carries', () => {
		// The honest answer: it really is part of both projects. Filing it
		// under one would have to pick arbitrarily, and hide it from the other
		// group where someone is looking for it.
		const row = { tags: ['work', 'urgent'] };
		assert.deepEqual(byTag([row], tagsOf), [
			{ tag: 'urgent', rows: [row] },
			{ tag: 'work', rows: [row] },
		]);
	});

	it('collects untagged items into a group of their own, last', () => {
		const groups = byTag([{ tags: [] }, { tags: ['work'] }], tagsOf);
		assert.deepEqual(groups.map((group) => group.tag), ['work', UNTAGGED]);
	});

	it('keeps the row order it was given, so the caller decides it', () => {
		const rows = [{ id: 1, tags: ['work'] }, { id: 2, tags: ['work'] }];
		assert.deepEqual(byTag(rows, tagsOf)[0].rows.map((row) => row.id), [1, 2]);
	});

	it('loses no row', () => {
		const rows = [{ tags: ['a'] }, { tags: [] }, { tags: ['a', 'b'] }];
		const grouped = byTag(rows, tagsOf).flatMap((group) => group.rows);
		for (const row of rows) assert.ok(grouped.includes(row));
	});

	it('is empty for no rows', () => {
		assert.deepEqual(byTag([], tagsOf), []);
	});
});

describe('saying what the filter is', () => {
	it('says nothing when nothing is filtered', () => {
		assert.equal(describeSelection(null), null);
		assert.equal(describeSelection(new Set()), null);
	});

	it('names the tag rather than counting it', () => {
		// "1 filter active" makes you open the picker to find out what you
		// filtered to, which is the question the message was there to answer.
		assert.equal(describeSelection(new Set(['work'])), 'Filtered to #work.');
	});

	it('names the untagged choice in words', () => {
		assert.equal(describeSelection(new Set([UNTAGGED])), 'Filtered to untagged.');
	});

	it('lists a few, then counts the rest', () => {
		assert.equal(describeSelection(new Set(['a', 'b', 'c'])), 'Filtered to #a, #b, #c.');
		assert.equal(describeSelection(new Set(['a', 'b', 'c', 'd', 'e'])), 'Filtered to #a, #b, #c and 2 more.');
	});
});

describe('over items from a real document', () => {
	it('finds the tags a file declares about itself', () => {
		// The whole point. A directive tags every item in the file, and this is
		// what turns that into something the sidebar can be narrowed to.
		const items = collect(['<!-- xit: tags=client-acme -->', '[ ] Draft the contract', '[ ] Send it']);
		assert.deepEqual(tagChoices(items, tagsOf), [{ tag: 'client-acme', count: 2 }]);
		assert.equal(items.every((item) => matchesTags(item.tags, new Set(['client-acme']))), true);
	});

	it('folds spelling, so #Work and #work are one group', () => {
		const items = collect(['[ ] One #Work', '[ ] Two #work']);
		assert.deepEqual(byTag(items, tagsOf).map((group) => group.tag), ['work']);
	});

	it('does not offer a tag that only appears inside a comment', () => {
		// Parked work is not work, and a filter offering a tag with nothing
		// behind it is a dead end.
		const items = collect(['[ ] Real #work', '<!--', '[ ] Parked #parked', '-->']);
		assert.deepEqual(tagChoices(items, tagsOf).map((choice) => choice.tag), ['work']);
	});

	it('narrows to a tag written on one item among several', () => {
		const items = collect(['[ ] Groceries #home', '[ ] Report #work', '[ ] Unfiled']);
		const kept = items.filter((item) => matchesTags(item.tags, new Set(['work'])));
		assert.deepEqual(kept.map((item) => item.description), ['Report #work']);
	});

	it('finds the unfiled work, which is the thing about to be lost', () => {
		const items = collect(['[ ] Groceries #home', '[ ] Unfiled']);
		const kept = items.filter((item) => matchesTags(item.tags, new Set([UNTAGGED])));
		assert.deepEqual(kept.map((item) => item.description), ['Unfiled']);
	});
});
