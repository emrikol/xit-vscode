/**
 * A document reduced to listable items, and how urgent each one is.
 *
 * The data behind the workspace view. Everything here is plain data, so it is
 * tested in plain Node; only the file reading needs VS Code.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { collect, urgencyOf, isOpen, overdueCount } = require_('../out/collect.js');

const THRESHOLDS = { today: 20260731, criticalAfterDays: 14, soonWithinDays: 7 };
const urgency = (line) => urgencyOf(collect([line])[0], THRESHOLDS);

describe('collecting items', () => {
	it('finds every item, with its depth', () => {
		const found = collect(['[ ] One', '\t[ ] Two', '\t\t[ ] Three', '[ ] Four']);
		assert.deepEqual(found.map((item) => [item.line, item.depth]), [[0, 0], [1, 1], [2, 2], [3, 0]]);
	});

	it('separates the description from the due date', () => {
		const [item] = collect(['[ ] Ship it -> 2026-08-14 #release']);
		assert.equal(item.description, 'Ship it #release');
		assert.equal(item.due.text, '-> 2026-08-14');
	});

	it('separates the description from both arrows, in either order', () => {
		// Cut back to front, because removing the earlier one first would move
		// the later one and take the wrong characters out.
		for (const line of [
			'[ ] Ship it <- 2026-08-01 -> 2026-08-14 #release',
			'[ ] Ship it -> 2026-08-14 <- 2026-08-01 #release',
		]) {
			const [item] = collect([line]);
			assert.equal(item.description, 'Ship it #release', line);
			assert.equal(item.due.text, '-> 2026-08-14');
			assert.equal(item.start.text, '<- 2026-08-01');
			assert.equal(item.start.startOfPeriod, 20260801);
		}
	});

	it('has no start date when none is written', () => {
		assert.equal(collect(['[ ] Ship it -> 2026-08-14'])[0].start, null);
	});

	it('folds tag case, so #Work and #work are one tag', () => {
		// Spec §Tag: names are case-insensitive. This is the first thing that
		// groups by tag, so it is the first place it matters.
		const [item] = collect(['[ ] Do this #Work #WORK #work']);
		assert.deepEqual(item.tags, ['work']);
	});

	it('attributes a tag on a continuation line to its item', () => {
		const [item] = collect(['[ ] Do this ...', '    ... with a #tag']);
		assert.deepEqual(item.tags, ['tag']);
	});

	it('leaves out anything inside a comment', () => {
		// Parked work is not outstanding work.
		const found = collect(['[ ] Real', '<!--', '[ ] Parked', '-->', '[ ] Also real']);
		assert.deepEqual(found.map((item) => item.description), ['Real', 'Also real']);
	});

	it('keeps the nesting', () => {
		const [parent, child] = collect(['[ ] Parent', '\t[ ] Child']);
		assert.equal(parent.parent, null);
		assert.deepEqual(parent.children, [1]);
		assert.equal(child.parent, 0);
	});
});

describe('urgency', () => {
	it('calls a period that ended long ago critical', () => {
		assert.equal(urgency('[ ] x -> 2020-01-01'), 'critical');
	});

	it('calls one that ended recently overdue', () => {
		assert.equal(urgency('[ ] x -> 2026-07-30'), 'overdue');
	});

	it('splits the two at the configured threshold', () => {
		// The same threshold the editor decorations use, so the sidebar and
		// the editor cannot disagree about what is late.
		const at = (date, days) => urgencyOf(collect([`[ ] x -> ${date}`])[0], { ...THRESHOLDS, criticalAfterDays: days });
		assert.equal(at('2026-07-17', 14), 'critical', 'exactly 14 days late');
		assert.equal(at('2026-07-18', 14), 'overdue', '13 days late');
		assert.equal(at('2020-01-01', 0), 'overdue', 'zero disables the tier');
	});

	it('is not overdue on the last day of the period', () => {
		assert.equal(urgency('[ ] x -> 2026-07-31'), 'soon');
		assert.equal(urgency('[ ] x -> 2026-07'), 'soon', 'the month ends on the 31st');
	});

	it('calls the next week soon and anything further later', () => {
		assert.equal(urgency('[ ] x -> 2026-08-07'), 'soon');
		assert.equal(urgency('[ ] x -> 2026-08-08'), 'later');
		assert.equal(urgency('[ ] x -> 2027'), 'later');
	});

	it('has nothing to say about an item with no date', () => {
		assert.equal(urgency('[ ] x'), 'none');
	});
});

describe('what you cannot act on yet', () => {
	// One answer for three questions. A not-yet-started item, a waiting one
	// and (once it exists) a blocked one are the same decision, and if they
	// answered it separately the sidebar would contradict itself.
	it('sorts a waiting item into its own group, not by its due date', () => {
		assert.equal(urgency('[>] x -> 2020-01-01'), 'waiting', 'even if long overdue');
		assert.equal(urgency('[>] x'), 'waiting');
	});

	it('sorts an item whose start date has not arrived into its own group', () => {
		assert.equal(urgency('[ ] x <- 2026-09-01'), 'notYet');
		assert.equal(urgency('[ ] x <- 2026-09-01 -> 2020-01-01'), 'notYet', 'even if long overdue');
	});

	it('lets an item through once its start date arrives', () => {
		// THRESHOLDS.today is 31 July 2026.
		assert.equal(urgency('[ ] x <- 2026-07-31 -> 2020-01-01'), 'critical', 'starts today');
		assert.equal(urgency('[ ] x <- 2026-07-30'), 'none');
	});

	it('reads a start date written as a period from its first day', () => {
		assert.equal(urgency('[ ] x <- 2026-07'), 'none', 'July began before today');
		assert.equal(urgency('[ ] x <- 2026-08'), 'notYet', 'August has not begun');
	});

	it('still counts both as outstanding, so neither is lost', () => {
		assert.equal(isOpen(collect(['[ ] x <- 2026-09-01'])[0]), true);
		assert.equal(isOpen(collect(['[>] x'])[0]), true);
	});
});

describe('what counts as outstanding', () => {
	it('counts open, ongoing, in-question and waiting', () => {
		// Waiting is this fork's own status. You cannot act on it, but it is
		// not finished, so it is still outstanding work and still listed.
		for (const status of [' ', '@', '?', '>']) {
			assert.equal(isOpen(collect([`[${status}] x`])[0]), true, status);
		}
	});

	it('does not count checked or obsolete', () => {
		// Finished, for opposite reasons: one was done, the other never will
		// be. Neither is outstanding.
		for (const status of ['x', '~']) {
			assert.equal(isOpen(collect([`[${status}] x`])[0]), false, status);
		}
	});
});

describe('the status bar count', () => {
	const files = (...lines) => [{ items: collect(lines) }];

	it('counts overdue items, and how many of those are critical', () => {
		const { overdue, critical } = overdueCount(files(
			'[ ] Long gone -> 2020-01-01',
			'[ ] Just late -> 2026-07-30',
			'[ ] Fine -> 2027-01-01',
		), THRESHOLDS);

		assert.equal(overdue, 2);
		assert.equal(critical, 1);
	});

	it('leaves out anything finished', () => {
		assert.deepEqual(overdueCount(files('[x] Done -> 2020-01-01', '[~] Abandoned -> 2020-01-01'), THRESHOLDS),
			{ overdue: 0, critical: 0 });
	});

	it('leaves out what you cannot act on, matching the sidebar', () => {
		// A waiting item and one whose start date has not arrived sort into
		// their own groups rather than by their due date, so counting them as
		// overdue would make the status bar disagree with the panel it opens.
		assert.deepEqual(overdueCount(files('[>] Waiting -> 2020-01-01'), THRESHOLDS), { overdue: 0, critical: 0 });
		assert.deepEqual(overdueCount(files('[ ] Later <- 2026-09-01 -> 2020-01-01'), THRESHOLDS), { overdue: 0, critical: 0 });
	});

	it('is zero for an empty workspace', () => {
		assert.deepEqual(overdueCount([], THRESHOLDS), { overdue: 0, critical: 0 });
	});
});
