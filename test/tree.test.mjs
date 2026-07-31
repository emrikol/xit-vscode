/**
 * Nesting, and the parent auto-check that rides on it.
 *
 * Subtasks are this fork's addition (discussion #2). The grammar highlights
 * them without knowing their depth; this is the part that has to count.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { items, cascade } = require_('../out/tree.js');
const { STATUS_CLASS } = require_('../out/checkbox.js');

const ANY_CHECKBOX = new RegExp(`\\[[${STATUS_CLASS}]\\]`);

/** Apply a cascade to a document, so a test can assert on the result. */
function applied(lines, changed) {
	const updates = cascade(lines, changed);
	return lines.map((text, line) =>
		updates.has(line) ? text.replace(ANY_CHECKBOX, `[${updates.get(line)}]`) : text);
}

describe('reading the nesting', () => {
	it('finds a parent and its children', () => {
		const tree = items(['[ ] Parent', '\t[ ] One', '\t[ ] Two']);
		assert.equal(tree.get(0).parent, null);
		assert.deepEqual(tree.get(0).children, [1, 2]);
		assert.equal(tree.get(1).parent, 0);
		assert.equal(tree.get(2).parent, 0);
	});

	it('nests to any depth', () => {
		const tree = items(['[ ] One', '\t[ ] Two', '\t\t[ ] Three', '\t\t\t[ ] Four']);
		assert.equal(tree.get(1).parent, 0);
		assert.equal(tree.get(2).parent, 1);
		assert.equal(tree.get(3).parent, 2);
	});

	it('nests well past the six levels the design mentioned', () => {
		// There is no limit, deliberately. A cap would have to live here and
		// in diagnostics, and could not live in the grammar, which nests by
		// back-referencing its parent's indent and so cannot count. The
		// highlighting and the diagnostics disagreeing about one line is
		// worse than no limit at all.
		const lines = Array.from({ length: 12 }, (_, depth) => '\t'.repeat(depth) + '[ ] Level');
		const tree = items(lines);
		assert.equal(tree.size, 12);
		for (let depth = 1; depth < 12; depth++) assert.equal(tree.get(depth).parent, depth - 1, `level ${depth}`);
	});

	it('does not nest a space-indented line', () => {
		// Spaces used to nest, at "two or more from the previous level", and
		// that was too loose to keep: a stray space made a three-space line a
		// child of a two-space one. A tab is a level; a space is a mistake.
		const tree = items(['[ ] Top', '  [ ] Spaces']);
		assert.equal(tree.get(1).parent, null);
	});

	it('closes the nest at a space-indented line, as it would at any sibling', () => {
		// Not nested means not inside, so it ends the item above it exactly as
		// a line in column zero would. The item is still recorded and the tab
		// below it starts a nest of its own; nothing is lost, only unnested.
		// src/diagnostics.ts is what tells the user, and the migration is what
		// fixes the file.
		const tree = items(['[ ] Top', '  [ ] Spaces', '\t[ ] Tab']);
		assert.equal(tree.get(2).parent, null, 'Top was closed by the space-indented line');
		assert.equal(tree.size, 3, 'all three are still items');
	});

	it('still records a space-indented item, rather than losing it', () => {
		// The safe failure. Indentation only decides parentage; every line
		// holding a checkbox is an item either way, so a file written before
		// this rule loses its nesting and not its tasks.
		const tree = items(['[ ] Top', '    [x] Was a subtask']);
		assert.equal(tree.size, 2);
		assert.equal(tree.get(1).status, 'x');
	});

	it('does not nest a tab inside spaces, or the reverse', () => {
		// Depth is compared as a prefix, not as a width. That mattered more
		// when spaces nested - four tabs is four characters and six spaces is
		// six, so measuring by width made the deeper-looking line measure as
		// the shallower one - and it is kept because it is still correct.
		const tree = items(['[ ] Top', '\t[ ] Tab', '\t  [ ] Tab then spaces']);
		assert.equal(tree.get(1).parent, 0);
		assert.equal(tree.get(2).parent, null, 'a mixed indent does not nest anywhere');
	});

	it('treats equal indentation as siblings, not as nesting', () => {
		const tree = items(['[ ] Parent', '\t[ ] One', '\t[ ] Two', '[ ] Another top level']);
		assert.deepEqual(tree.get(0).children, [1, 2]);
		assert.equal(tree.get(3).parent, null);
	});

	it('closes the whole nest at a blank line', () => {
		// Spec §Item: "The item MUST NOT contain any blank lines."
		const tree = items(['[ ] Parent', '\t[ ] Child', '', '\t[ ] Not a child of anything']);
		assert.deepEqual(tree.get(0).children, [1]);
		assert.equal(tree.get(3).parent, null);
	});

	it('steps back out correctly after a deeper level', () => {
		const tree = items(['[ ] A', '\t\t[ ] B', '\t\t\t\t[ ] C', '\t\t[ ] D']);
		assert.equal(tree.get(3).parent, 0, 'D should return to A, not stay under C');
		assert.deepEqual(tree.get(0).children, [1, 3]);
	});

	it('ignores lines that are not items', () => {
		const tree = items(['A title', '[ ] Item', '    continuation text', '\t[ ] Child']);
		assert.equal(tree.size, 2);
		assert.equal(tree.get(3).parent, 1);
	});
});

describe('auto-checking a parent', () => {
	it('checks a parent once its last child is checked', () => {
		const before = ['[ ] Parent', '\t[x] One', '\t[ ] Two'];
		const after = applied(['[ ] Parent', '\t[x] One', '\t[x] Two'], [2]);
		assert.equal(before[0], '[ ] Parent');
		assert.equal(after[0], '[x] Parent');
	});

	it('leaves a parent alone while a child is outstanding', () => {
		const after = applied(['[ ] Parent', '\t[x] One', '\t[ ] Two'], [1]);
		assert.equal(after[0], '[ ] Parent');
	});

	it('cascades up more than one level', () => {
		const after = applied(['[ ] A', '\t[ ] B', '\t\t[x] C'], [2]);
		assert.equal(after[1], '\t[x] B');
		assert.equal(after[0], '[x] A');
	});

	it('stops cascading where a sibling is outstanding', () => {
		const after = applied(['[ ] A', '\t[ ] B', '\t\t[x] C', '\t[ ] D'], [2]);
		assert.equal(after[1], '\t[x] B', 'B has only C, which is done');
		assert.equal(after[0], '[ ] A', 'A still has D outstanding');
	});

	it('reopens a parent when a child is unchecked', () => {
		// Not asked for, but the pair is what makes it coherent: a ticked
		// parent above an unticked child states something false.
		const after = applied(['[x] Parent', '\t[x] One', '\t[ ] Two'], [2]);
		assert.equal(after[0], '[ ] Parent');
	});

	it('reopens all the way up', () => {
		const after = applied(['[x] A', '\t[x] B', '\t\t[ ] C'], [2]);
		assert.equal(after[1], '\t[ ] B');
		assert.equal(after[0], '[ ] A');
	});

	it('does not touch a parent that is ongoing, obsolete, in question or waiting', () => {
		// Those were set deliberately. A child being ticked is not a reason to
		// overrule someone who marked the parent as blocked or abandoned.
		for (const status of ['@', '~', '?', '>']) {
			const after = applied([`[${status}] Parent`, '\t[x] Child'], [1]);
			assert.equal(after[0], `[${status}] Parent`, `[${status}] was overwritten`);
		}
	});

	it('does not count a waiting child as done', () => {
		// The whole point of waiting is that it is not finished. A parent
		// checking itself over one would be the format asserting something
		// false, which is the reason auto-check exists in the first place.
		const after = applied(['[ ] Parent', '\t[x] One', '\t[>] Waiting'], [1]);
		assert.equal(after[0], '[ ] Parent');
	});

	it('does not count an obsolete child as done', () => {
		// The conservative reading. Arguable the other way, and the reasoning
		// is written down in src/tree.ts.
		const after = applied(['[ ] Parent', '\t[x] One', '\t[~] Abandoned'], [1]);
		assert.equal(after[0], '[ ] Parent');
	});

	it('does nothing for an item with no children', () => {
		assert.equal(cascade(['[ ] Alone'], [0]).size, 0);
	});

	it('does nothing for a line that is not an item', () => {
		assert.equal(cascade(['Just a title'], [0]).size, 0);
	});

	it('handles several edits at once without contradicting itself', () => {
		// Toggling a whole selection is one edit over many lines.
		const after = applied(['[ ] Parent', '\t[ ] One', '\t[ ] Two'].map((line, i) =>
			i === 0 ? line : line.replace('[ ]', '[x]')), [1, 2]);
		assert.equal(after[0], '[x] Parent');
	});
});

describe('parked work is not work', () => {
	it('does not record a checkbox inside a comment as an item', () => {
		// Every caller used to have to remember this, and one forgot: a tag
		// inside a comment reached completion, because tags() walks these.
		const tree = items(['[ ] Parent', '\t[x] Real', '<!--', '\t[ ] Parked', '-->']);
		assert.deepEqual([...tree.keys()], [0, 1]);
	});

	it('still ends an item at a comment, which does not split a group', () => {
		// The fork's rule is that a comment cannot appear inside an item.
		// Skipping parked lines outright made the item before a comment
		// swallow the comment and everything after it.
		const tree = items(['[ ] Before', '<!--', 'parked', '-->', '[ ] After']);
		assert.equal(tree.get(0).endLine, 0);
		assert.equal(tree.get(4).parent, null);
	});

	it('does not let a parked child hold its parent open', () => {
		const tree = items(['[ ] Parent', '\t[ ] Real', '<!--', '\t[x] Parked', '-->']);
		assert.deepEqual(tree.get(0).children, [1]);
	});
});
