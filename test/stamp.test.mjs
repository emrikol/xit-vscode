/**
 * Completion dates, recorded as a tag.
 *
 * jotaen's own answer in #3, #4 and #59: the format already allows this by
 * convention, so no new syntax is needed and other tools keep reading the
 * file. Everything here is about not breaking that promise.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { stamp, formatDay, isTagName } = require_('../out/stamp.js');
const { tagsOn } = require_('../out/tag.js');
const { dueDatesOn } = require_('../out/dueDate.js');

describe('formatting a day', () => {
	it('writes the date the way the spec does', () => {
		assert.equal(formatDay(20260731), '2026-07-31');
		assert.equal(formatDay(20260101), '2026-01-01');
	});
});

describe('tag names', () => {
	it('accepts what the spec allows', () => {
		// Spec §Tag: "letters, digits, or the characters `_` or `-`".
		for (const name of ['done', 'completed', 'DONE', 'done-at', 'done_at', 'σκληρά', 'x2']) {
			assert.ok(isTagName(name), name);
		}
	});

	it('rejects anything that would not be a tag', () => {
		for (const name of ['', 'has space', 'done!', '#done', 'done=', 'a.b']) {
			assert.ok(!isTagName(name), name);
		}
	});

	it('leaves the line alone rather than writing an invalid tag', () => {
		assert.equal(stamp('[x] Do this', 'not a name', 20260731), '[x] Do this');
	});
});

describe('stamping', () => {
	it('appends the tag', () => {
		assert.equal(stamp('[x] Do this', 'done', 20260731), '[x] Do this #done=2026-07-31');
	});

	it('writes a tag that is a tag', () => {
		// The whole point of the convention: it has to parse as one.
		const [tag] = tagsOn(stamp('[x] Do this', 'done', 20260731));
		assert.equal(tag.name, 'done');
		assert.equal(tag.value, '2026-07-31');
	});

	it('keeps the due date readable', () => {
		// A due date ends at whitespace or punctuation, so appending after a
		// space must not swallow it.
		const stamped = stamp('[x] Ship it -> 2026-08-14', 'done', 20260731);
		assert.deepEqual(
			dueDatesOn(stamped).map((d) => d.text),
			['-> 2026-08-14'],
		);
	});

	it('goes after any existing tags', () => {
		const stamped = stamp('[x] Ship it #release #urgent', 'done', 20260731);
		assert.deepEqual(
			tagsOn(stamped).map((t) => t.name),
			['release', 'urgent', 'done'],
		);
	});

	it('is idempotent', () => {
		// shuffle can pass through checked more than once, so this is reached
		// in normal use rather than only in a test.
		const once = stamp('[x] Do this', 'done', 20260731);
		assert.equal(stamp(once, 'done', 20260731), once);
	});

	it('rewrites the value rather than adding a second tag', () => {
		const stamped = stamp('[x] Do this #done=2026-01-01', 'done', 20260731);
		assert.equal(stamped, '[x] Do this #done=2026-07-31');
	});

	it('matches an existing tag case-insensitively, as the spec requires', () => {
		const stamped = stamp('[x] Do this #DONE=2026-01-01', 'done', 20260731);
		assert.equal(tagsOn(stamped).length, 1, 'a second tag was added instead of rewriting the first');
	});

	it('tidies the trailing whitespace it would otherwise leave', () => {
		assert.equal(stamp('[x] Do this   ', 'done', 20260731), '[x] Do this #done=2026-07-31');
	});
});

describe('unstamping', () => {
	it('removes the tag when the item is reopened', () => {
		assert.equal(stamp('[ ] Do this #done=2026-07-31', 'done', null), '[ ] Do this');
	});

	it('leaves no double space behind', () => {
		const opened = stamp('[ ] Do this #done=2026-07-31 #release', 'done', null);
		assert.equal(opened, '[ ] Do this #release');
	});

	it('leaves other tags alone', () => {
		const opened = stamp('[ ] Do this #a #done=2026-07-31 #b', 'done', null);
		assert.deepEqual(
			tagsOn(opened).map((t) => t.name),
			['a', 'b'],
		);
	});

	it('does nothing when there is no tag to remove', () => {
		assert.equal(stamp('[ ] Do this', 'done', null), '[ ] Do this');
	});

	it('removes a tag written in another case', () => {
		assert.equal(stamp('[ ] Do this #Done=2026-07-31', 'done', null), '[ ] Do this');
	});
});
