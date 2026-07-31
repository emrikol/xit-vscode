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
		const tree = items(['[ ] Parent', '  [ ] One', '  [ ] Two']);
		assert.equal(tree.get(0).parent, null);
		assert.deepEqual(tree.get(0).children, [1, 2]);
		assert.equal(tree.get(1).parent, 0);
		assert.equal(tree.get(2).parent, 0);
	});

	it('nests to any depth, at any indent width', () => {
		const tree = items(['[ ] One', '  [ ] Two', '      [ ] Three', '        [ ] Four']);
		assert.equal(tree.get(1).parent, 0);
		assert.equal(tree.get(2).parent, 1);
		assert.equal(tree.get(3).parent, 2);
	});

	it('nests with tabs just as well', () => {
		const tree = items(['[ ] One', '\t[ ] Two', '\t\t[ ] Three']);
		assert.equal(tree.get(1).parent, 0);
		assert.equal(tree.get(2).parent, 1);
	});

	it('does not nest a tab inside spaces, or the reverse', () => {
		// Depth is compared as a prefix, not as a width, because a width
		// cannot answer this: four tabs is four characters and six spaces is
		// six, so the deeper-looking line measures as the shallower one.
		// Neither indent is a prefix of the other, so neither contains the
		// other, and both fall back to the nearest ancestor that does.
		const tree = items(['[ ] Top', '  [ ] Spaces', '\t\t[ ] Tabs']);
		assert.equal(tree.get(1).parent, 0);
		assert.equal(tree.get(2).parent, 0, 'a tab-indented line is not inside a space-indented one');
	});

	it('treats equal indentation as siblings, not as nesting', () => {
		const tree = items(['[ ] Parent', '  [ ] One', '  [ ] Two', '[ ] Another top level']);
		assert.deepEqual(tree.get(0).children, [1, 2]);
		assert.equal(tree.get(3).parent, null);
	});

	it('closes the whole nest at a blank line', () => {
		// Spec §Item: "The item MUST NOT contain any blank lines."
		const tree = items(['[ ] Parent', '  [ ] Child', '', '  [ ] Not a child of anything']);
		assert.deepEqual(tree.get(0).children, [1]);
		assert.equal(tree.get(3).parent, null);
	});

	it('steps back out correctly after a deeper level', () => {
		const tree = items(['[ ] A', '    [ ] B', '        [ ] C', '    [ ] D']);
		assert.equal(tree.get(3).parent, 0, 'D should return to A, not stay under C');
		assert.deepEqual(tree.get(0).children, [1, 3]);
	});

	it('ignores lines that are not items', () => {
		const tree = items(['A title', '[ ] Item', '    continuation text', '  [ ] Child']);
		assert.equal(tree.size, 2);
		assert.equal(tree.get(3).parent, 1);
	});
});

describe('auto-checking a parent', () => {
	it('checks a parent once its last child is checked', () => {
		const before = ['[ ] Parent', '  [x] One', '  [ ] Two'];
		const after = applied(['[ ] Parent', '  [x] One', '  [x] Two'], [2]);
		assert.equal(before[0], '[ ] Parent');
		assert.equal(after[0], '[x] Parent');
	});

	it('leaves a parent alone while a child is outstanding', () => {
		const after = applied(['[ ] Parent', '  [x] One', '  [ ] Two'], [1]);
		assert.equal(after[0], '[ ] Parent');
	});

	it('cascades up more than one level', () => {
		const after = applied(['[ ] A', '  [ ] B', '    [x] C'], [2]);
		assert.equal(after[1], '  [x] B');
		assert.equal(after[0], '[x] A');
	});

	it('stops cascading where a sibling is outstanding', () => {
		const after = applied(['[ ] A', '  [ ] B', '    [x] C', '  [ ] D'], [2]);
		assert.equal(after[1], '  [x] B', 'B has only C, which is done');
		assert.equal(after[0], '[ ] A', 'A still has D outstanding');
	});

	it('reopens a parent when a child is unchecked', () => {
		// Not asked for, but the pair is what makes it coherent: a ticked
		// parent above an unticked child states something false.
		const after = applied(['[x] Parent', '  [x] One', '  [ ] Two'], [2]);
		assert.equal(after[0], '[ ] Parent');
	});

	it('reopens all the way up', () => {
		const after = applied(['[x] A', '  [x] B', '    [ ] C'], [2]);
		assert.equal(after[1], '  [ ] B');
		assert.equal(after[0], '[ ] A');
	});

	it('does not touch a parent that is ongoing, obsolete, in question or waiting', () => {
		// Those were set deliberately. A child being ticked is not a reason to
		// overrule someone who marked the parent as blocked or abandoned.
		for (const status of ['@', '~', '?', '>']) {
			const after = applied([`[${status}] Parent`, '  [x] Child'], [1]);
			assert.equal(after[0], `[${status}] Parent`, `[${status}] was overwritten`);
		}
	});

	it('does not count a waiting child as done', () => {
		// The whole point of waiting is that it is not finished. A parent
		// checking itself over one would be the format asserting something
		// false, which is the reason auto-check exists in the first place.
		const after = applied(['[ ] Parent', '  [x] One', '  [>] Waiting'], [1]);
		assert.equal(after[0], '[ ] Parent');
	});

	it('does not count an obsolete child as done', () => {
		// The conservative reading. Arguable the other way, and the reasoning
		// is written down in src/tree.ts.
		const after = applied(['[ ] Parent', '  [x] One', '  [~] Abandoned'], [1]);
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
		const after = applied(['[ ] Parent', '  [ ] One', '  [ ] Two'].map((line, i) =>
			i === 0 ? line : line.replace('[ ]', '[x]')), [1, 2]);
		assert.equal(after[0], '[x] Parent');
	});
});
