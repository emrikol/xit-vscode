/**
 * Folding ranges.
 *
 * VS Code folds by indentation with no provider at all, so the bar this has
 * to clear is not "does it fold" but "does it fold the things indentation
 * alone gets wrong": a description continuation is not a subtask, a blank
 * line ends an item, and `<!--` means something here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { folds } = createRequire(import.meta.url)('../out/folding.js');

/** Folds as "kind start-end" strings, which read far better in a diff. */
function shape(lines) {
	return folds(lines).map((fold) => `${fold.kind} ${fold.start}-${fold.end}`);
}

describe('folding items', () => {
	it('folds an item with subtasks', () => {
		assert.deepEqual(shape(['[ ] Parent', '\t[x] One', '\t[ ] Two']), ['item 0-2']);
	});

	it('folds an item with a description continuation', () => {
		assert.deepEqual(shape(['[ ] Item ...', '    ... continued']), ['item 0-1']);
	});

	it('offers nothing for an item on one line', () => {
		// A fold arrow that collapses nothing is noise.
		assert.deepEqual(shape(['[ ] Alone', '[ ] Also alone']), []);
	});

	it('folds each level of a nest', () => {
		assert.deepEqual(shape(['[ ] A', '\t[ ] B', '\t\t[ ] C']), ['item 0-2', 'item 1-2']);
	});

	it('stops at a blank line', () => {
		// Spec §Item: "The item MUST NOT contain any blank lines."
		assert.deepEqual(shape(['[ ] Parent', '\t[ ] Child', '', '\t[ ] Unrelated']), ['item 0-1']);
	});

	it('does not treat a continuation as a subtask, which plain indentation would', () => {
		// The whole reason this provider exists. Indentation folding cannot
		// see that line 2 belongs to line 0 rather than to line 1.
		assert.deepEqual(shape(['[ ] Parent ...', '\t[ ] Child', '    ... parent continued']), ['item 0-2', 'item 1-2']);
	});
});

describe('folding comments', () => {
	it('folds a comment block', () => {
		assert.deepEqual(shape(['<!--', 'parked', '-->']), ['comment 0-2']);
	});

	it('offers nothing for a comment on one line', () => {
		assert.deepEqual(shape(['<!-- on hold -->', '[ ] Item']), []);
	});

	it('folds an unterminated comment to the end of the file', () => {
		// The fork's rule: an unterminated comment runs to the end, which is
		// exactly when being able to collapse it is worth something.
		assert.deepEqual(shape(['[ ] Before', '<!--', 'and everything after']), ['comment 1-2']);
	});

	it('offers no item or group folds inside a comment', () => {
		const lines = ['<!--', '[ ] parked', '\t[ ] parked child', 'A parked title', '[ ] more', '-->'];
		assert.deepEqual(shape(lines), ['comment 0-5']);
	});
});

describe('folding groups', () => {
	it('folds a title with its items', () => {
		// Spec §Group: "any consecutive number of items ... that MAY be
		// preceded by one title".
		assert.deepEqual(shape(['Todos', '[ ] One', '[ ] Two']), ['group 0-2']);
	});

	it('ends a group at a blank line', () => {
		assert.deepEqual(shape(['First', '[ ] One', '', 'Second', '[ ] Two']), ['group 0-1', 'group 3-4']);
	});

	it('ends a group at the next title', () => {
		assert.deepEqual(shape(['First', '[ ] One', 'Second', '[ ] Two']), ['group 0-1', 'group 2-3']);
	});

	it('offers nothing for a title with no items', () => {
		assert.deepEqual(shape(['Empty Group']), []);
	});

	it('offers nothing for items with no title', () => {
		// They already fold one by one where they have children. A second
		// range over the same lines gives two arrows that do the same thing.
		assert.deepEqual(shape(['[ ] One', '[ ] Two']), []);
	});
});

describe('folding a whole document', () => {
	it('sorts ranges by where they start', () => {
		const lines = ['Todos', '[ ] Parent', '\t[x] Child', '', '<!--', 'parked', '-->'];
		assert.deepEqual(shape(lines), ['group 0-2', 'item 1-2', 'comment 4-6']);
	});

	it('offers nothing for an empty document', () => {
		assert.deepEqual(shape([]), []);
		assert.deepEqual(shape(['', '  ']), []);
	});
});
