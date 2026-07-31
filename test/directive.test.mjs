/**
 * What a file says about itself.
 *
 * A comment is where this costs least: comments are already a fork, so a
 * directive inside one adds no new breakage, and every reader that already
 * skips comments skips this without being taught anything.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { directives } = require_('../out/directive.js');
const { collect } = require_('../out/collect.js');
const { archive } = require_('../out/archive.js');

describe('reading a directive', () => {
	it('takes tags from a one-line comment', () => {
		assert.deepEqual(directives(['<!-- xit: tags=work -->']).tags, ['work']);
	});

	it('takes several, separated by commas', () => {
		assert.deepEqual(directives(['<!-- xit: tags=work, client-acme -->']).tags, ['work', 'client-acme']);
	});

	it('folds them, like every other tag name', () => {
		assert.deepEqual(directives(['<!-- xit: tags=Work -->']).tags, ['work']);
	});

	it('works inside a block comment too', () => {
		assert.deepEqual(directives(['<!--', 'xit: tags=work', '-->']).tags, ['work']);
	});

	it('takes an archive title', () => {
		assert.equal(directives(['<!-- xit: archive=Done -->']).archive, 'Done');
	});

	it('ignores an unknown key, in silence', () => {
		// A directive written for a later version must not break an earlier
		// one. Reporting it would make every new key a breaking change for
		// anyone who has not updated.
		assert.deepEqual(directives(['<!-- xit: colour=blue -->']), { tags: [], archive: null });
	});

	it('ignores a tag name the format could not express', () => {
		// A directive must not be able to declare something you could not
		// have written by hand.
		assert.deepEqual(directives(['<!-- xit: tags=not a tag, ok -->']).tags, ['ok']);
	});

	it('ignores anything outside a comment', () => {
		assert.deepEqual(directives(['xit: tags=work', '[ ] Item']), { tags: [], archive: null });
	});

	it('finds nothing in a file that declares nothing', () => {
		assert.deepEqual(directives(['[ ] Item']), { tags: [], archive: null });
	});
});

describe('what a directive changes', () => {
	it('gives every item the file\'s tags', () => {
		// The point: a work.xit should not need #work on every line.
		const [item] = collect(['<!-- xit: tags=work -->', '[ ] Do this']);
		assert.deepEqual(item.tags, ['work']);
	});

	it('does not duplicate one the item already carries', () => {
		const [item] = collect(['<!-- xit: tags=work -->', '[ ] Do this #work']);
		assert.deepEqual(item.tags, ['work']);
	});

	it('adds to the item\'s own rather than replacing them', () => {
		const [item] = collect(['<!-- xit: tags=work -->', '[ ] Do this #urgent']);
		assert.deepEqual(item.tags.sort(), ['urgent', 'work']);
	});

	it('names the archive group, beating the setting', () => {
		// The setting is one answer for every file; this is the file's answer
		// for itself.
		const { lines } = archive(['<!-- xit: archive=Done -->', '[x] Finished'], 'Archive');
		assert.ok(lines.includes('# Done'), lines.join('\n'));
		assert.ok(!lines.includes('# Archive'));
	});
});
