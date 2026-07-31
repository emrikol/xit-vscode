/**
 * Marked titles.
 *
 * The specification defines a title by what it is not, which leaves the format
 * with no invalid state for a line: anything failing to be an item becomes a
 * heading. These are the tests for the fork that fixes it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { isTitle, titleText, markTitle, MARKER } = createRequire(import.meta.url)('../out/title.js');

describe('what counts as a title', () => {
	it('takes a marker and a space', () => {
		assert.equal(isTitle('# Groceries'), true);
		assert.equal(isTitle('#\tGroceries'), true);
	});

	it('takes a bare marker, which heads a group with no name', () => {
		// Spec §Group lets a title precede no items at all, so a title that
		// says nothing in particular is no stranger than that.
		assert.equal(isTitle('#'), true);
		assert.equal(titleText('#'), '');
	});

	it('rejects the lines that used to become titles by accident', () => {
		// The whole reason the marker exists. Every one of these was a heading
		// before it, and the first two are what Markdown habits type.
		for (const line of ['- [ ] Buy milk', '* [ ] Call Sam', 'x] Slip', '[ x] Typo', 'My TODO list']) {
			assert.equal(isTitle(line), false, line);
		}
	});

	it('rejects a tag, because a tag has no space after the hash', () => {
		// `#[\p{L}\d_-]+` wants a name character straight after the hash. The
		// space is the whole separation between the two, so a bare tag on its
		// own line is an error rather than a heading that looks like a tag.
		assert.equal(isTitle('#groceries'), false);
		assert.equal(isTitle('#work=urgent'), false);
	});

	it('rejects an indented marker', () => {
		assert.equal(isTitle(' # Groceries'), false);
		assert.equal(isTitle('\t# Groceries'), false);
	});
});

describe('reading a title', () => {
	it('drops the marker and the surrounding space', () => {
		assert.equal(titleText('# Groceries'), 'Groceries');
		assert.equal(titleText('#   Lots of space   '), 'Lots of space');
	});

	it('leaves a line that is not a title trimmed but whole', () => {
		assert.equal(titleText('  Not a title  '), 'Not a title');
	});
});

describe('marking a title', () => {
	it('adds the marker', () => {
		assert.equal(markTitle('Groceries'), '# Groceries');
	});

	it('is idempotent, so migrating twice is migrating once', () => {
		const once = markTitle('Groceries');
		assert.equal(markTitle(once), once);
	});

	it('does not leave trailing space behind', () => {
		assert.equal(markTitle('Groceries   '), '# Groceries');
	});

	it('uses the marker the module exports, not a literal', () => {
		assert.ok(markTitle('x').startsWith(MARKER));
	});
});
