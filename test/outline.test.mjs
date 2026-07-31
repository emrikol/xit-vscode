/**
 * The Outline structure.
 *
 * extension.ts turns these into DocumentSymbols, which also drives Go to
 * Symbol and the breadcrumbs. Nothing here needs VS Code, so it is tested in
 * plain Node like the rest of src/.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { outline } = createRequire(import.meta.url)('../out/outline.js');

/**
 * The tree as indented text, which is far easier to assert on than nested
 * objects. A tab per level, matching the format itself, so the expected shape
 * of an outline reads the same as the document that produced it.
 */
function shape(nodes, depth = 0) {
	return nodes.flatMap((node) => [
		'\t'.repeat(depth) + node.name,
		...shape(node.children, depth + 1),
	]);
}

describe('outline', () => {
	it('puts items under the title above them', () => {
		// Spec §Group: "any consecutive number of items … that MAY be preceded
		// by one title".
		assert.deepEqual(shape(outline(['# Reading list', '[ ] A book', '[x] Another'])), [
			'Reading list',
			'\t[ ] A book',
			'\t[x] Another',
		]);
	});

	it('nests subtasks under their parent', () => {
		assert.deepEqual(shape(outline(['[ ] Parent', '\t[x] One', '\t\t[ ] Deeper', '\t[ ] Two'])), [
			'[ ] Parent',
			'\t[x] One',
			'\t\t[ ] Deeper',
			'\t[ ] Two',
		]);
	});

	it('starts a new section at each title', () => {
		const lines = ['# First', '[ ] One', '', '# Second', '[ ] Two'];
		assert.deepEqual(shape(outline(lines)), ['First', '\t[ ] One', 'Second', '\t[ ] Two']);
	});

	it('keeps items before any title at the top level', () => {
		assert.deepEqual(shape(outline(['[ ] Loose', '# A title', '[ ] Owned'])), [
			'[ ] Loose',
			'A title',
			'\t[ ] Owned',
		]);
	});

	it('shows the status in the name, so it reads without an icon', () => {
		const names = shape(outline(['[ ] a', '[x] b', '[@] c', '[~] d', '[?] e']));
		assert.deepEqual(names, ['[ ] a', '[x] b', '[@] c', '[~] d', '[?] e']);
	});

	it('lifts the due date into the detail rather than repeating it', () => {
		const [node] = outline(['[@] Ship it -> 2026-08-14 #release']);
		assert.equal(node.name, '[@] Ship it #release');
		assert.equal(node.detail, '-> 2026-08-14');
	});

	it('leaves a description that is only a due date with an empty name', () => {
		const [node] = outline(['[ ] -> 2026-01-01']);
		assert.equal(node.name, '[ ]');
		assert.equal(node.detail, '-> 2026-01-01');
	});

	it('ignores everything inside a comment', () => {
		// The comment syntax is this fork's own. Items parked inside one are
		// not outstanding and should not appear in a list of what is.
		const lines = ['[ ] Real', '<!--', '[ ] Parked', 'A parked title', '-->', '[ ] Also real'];
		assert.deepEqual(shape(outline(lines)), ['[ ] Real', '[ ] Also real']);
	});

	it('handles a comment opened and closed on one line', () => {
		assert.deepEqual(shape(outline(['<!-- on hold -->', '[ ] Real'])), ['[ ] Real']);
	});

	it('covers an item and everything under it', () => {
		// The range is what collapsing the panel row collapses, so it has to
		// include continuations and subtasks.
		const [parent] = outline(['[ ] Parent ...', '    ... continued', '\t[ ] Child', '[ ] Next']);
		assert.equal(parent.line, 0);
		assert.equal(parent.endLine, 2);
	});

	it('covers a title to the end of its group', () => {
		const [title] = outline(['# Todos', '[ ] One', '\t[ ] Nested', '', '# Next', '[ ] Two']);
		assert.equal(title.endLine, 2);
	});

	it('gives an empty group a title covering only itself', () => {
		// Spec §Group: a title may be followed by no items at all.
		const [title] = outline(['# Empty Group']);
		assert.equal(title.endLine, 0);
		assert.deepEqual(title.children, []);
	});

	it('selects the checkbox, not the whole line', () => {
		const [parent] = outline(['[ ] Parent', '\t[ ] Child']);
		assert.equal(parent.selectionStart, 0);
		assert.equal(parent.selectionEnd, 3);
		assert.equal(parent.children[0].selectionStart, 1, 'a subtask selects its own indented checkbox');
		assert.equal(parent.children[0].selectionEnd, 4);
	});

	it('collapses whitespace in a name', () => {
		const [node] = outline(['[ ]    lots     of      space']);
		assert.equal(node.name, '[ ] lots of space');
	});

	it('is empty for a document with nothing in it', () => {
		assert.deepEqual(outline([]), []);
		assert.deepEqual(outline(['', '   ', '']), []);
	});
});

describe('both arrows are lifted out of the name', () => {
	it('shows a start date in the detail, like a due date', () => {
		// The due date was lifted and the start date was not, so `<- 2026-09-01`
		// sat in the item name while `-> 2026-09-30` did not. Found by the
		// sibling check in test/parity.test.mjs.
		const [node] = outline(['[ ] Book the venue <- 2026-09-01 -> 2026-09-30 #release']);
		assert.equal(node.name, '[ ] Book the venue #release');
		assert.equal(node.detail, '<- 2026-09-01  -> 2026-09-30');
	});

	it('shows whichever one is there', () => {
		assert.equal(outline(['[ ] Only due -> 2026-01-01'])[0].detail, '-> 2026-01-01');
		assert.equal(outline(['[ ] Only start <- 2026-01-01'])[0].detail, '<- 2026-01-01');
		assert.equal(outline(['[ ] Neither'])[0].detail, '');
	});

	it('cuts back to front, so the second arrow is not mangled', () => {
		// Removing the earlier one first would move the later one and take the
		// wrong characters out. Either written order has to work.
		for (const line of [
			'[ ] Ship it <- 2026-08-01 -> 2026-08-14 #release',
			'[ ] Ship it -> 2026-08-14 <- 2026-08-01 #release',
		]) {
			assert.equal(outline([line])[0].name, '[ ] Ship it #release', line);
		}
	});
});
