/**
 * Sorting a group.
 *
 * The whole difficulty is that an item is not a line: a subtask moves with its
 * parent, and so does every description continuation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { sortGroup, groupAround } = createRequire(import.meta.url)('../out/sort.js');

describe('finding the group', () => {
	it('runs to the blank lines on either side', () => {
		const lines = ['[ ] A', '', '[ ] B', '[ ] C', '', '[ ] D'];
		assert.deepEqual(groupAround(lines, 3), { start: 2, end: 3 });
	});

	it('includes a title heading the group', () => {
		assert.deepEqual(groupAround(['# Todos', '[ ] A', '[ ] B'], 1), { start: 0, end: 2 });
	});

	it('is nothing for a blank line', () => {
		assert.equal(groupAround(['[ ] A', '', '[ ] B'], 1), null);
	});
});

describe('sorting by priority and due date', () => {
	it('puts the higher priority first', () => {
		assert.deepEqual(
			sortGroup(['[ ] Low', '[ ] !!! High', '[ ] ! Middle'], 0),
			['[ ] !!! High', '[ ] ! Middle', '[ ] Low'],
		);
	});

	it('breaks a priority tie by due date, earliest first', () => {
		assert.deepEqual(
			sortGroup(['[ ] Later -> 2026-12-01', '[ ] Sooner -> 2026-01-01'], 0),
			['[ ] Sooner -> 2026-01-01', '[ ] Later -> 2026-12-01'],
		);
	});

	it('sorts an item with no due date last, not first', () => {
		// No date is not the most urgent thing in the group, it is the least
		// scheduled.
		assert.deepEqual(
			sortGroup(['[ ] Undated', '[ ] Dated -> 2026-01-01'], 0),
			['[ ] Dated -> 2026-01-01', '[ ] Undated'],
		);
	});

	it('is stable, so equal items keep the order they were written in', () => {
		const lines = ['[ ] One', '[ ] Two', '[ ] Three'];
		assert.deepEqual(sortGroup(lines, 0), lines);
	});

	it('changes nothing the second time', () => {
		const once = sortGroup(['[ ] Low', '[ ] !!! High', '[ ] ! Middle'], 0);
		assert.deepEqual(sortGroup(once, 0), once);
	});
});

describe('what moves with an item', () => {
	it('takes its subtasks with it', () => {
		assert.deepEqual(
			sortGroup(['[ ] Low', '\t[ ] Low child', '[ ] !!! High', '\t[ ] High child'], 0),
			['[ ] !!! High', '\t[ ] High child', '[ ] Low', '\t[ ] Low child'],
		);
	});

	it('takes its description continuations with it', () => {
		assert.deepEqual(
			sortGroup(['[ ] Low ...', '    ... more about low', '[ ] !!! High'], 0),
			['[ ] !!! High', '[ ] Low ...', '    ... more about low'],
		);
	});

	it('sorts subtasks among themselves, inside their parent', () => {
		assert.deepEqual(
			sortGroup(['[ ] Parent', '\t[ ] Low', '\t[ ] !! High'], 0),
			['[ ] Parent', '\t[ ] !! High', '\t[ ] Low'],
		);
	});

	it('sorts every level at once', () => {
		assert.deepEqual(
			sortGroup(['[ ] B', '\t[ ] b2', '\t[ ] ! b1', '[ ] ! A', '\t[ ] a2', '\t[ ] ! a1'], 0),
			['[ ] ! A', '\t[ ] ! a1', '\t[ ] a2', '[ ] B', '\t[ ] ! b1', '\t[ ] b2'],
		);
	});
});

describe('what it leaves alone', () => {
	it('leaves the title where it is', () => {
		assert.deepEqual(
			sortGroup(['# Todos', '[ ] Low', '[ ] !!! High'], 1),
			['# Todos', '[ ] !!! High', '[ ] Low'],
		);
	});

	it('touches only the group the line is in', () => {
		const lines = ['[ ] Low', '[ ] !!! High', '', '[ ] Also low', '[ ] !!! Also high'];
		assert.deepEqual(sortGroup(lines, 0), ['[ ] !!! High', '[ ] Low', '', '[ ] Also low', '[ ] !!! Also high']);
	});

	it('leaves a group inside a comment alone', () => {
		// Parked work was set aside deliberately. Rewriting it would be the
		// one edit nobody asked for.
		const lines = ['<!--', '[ ] Low', '[ ] !!! High', '-->'];
		assert.deepEqual(sortGroup(lines, 1), lines);
	});

	it('does nothing for a group with one item, or none', () => {
		assert.deepEqual(sortGroup(['[ ] Alone'], 0), ['[ ] Alone']);
		assert.deepEqual(sortGroup(['# Just a title'], 0), ['# Just a title']);
	});

	it('does nothing for a blank line', () => {
		const lines = ['[ ] A', '', '[ ] B'];
		assert.deepEqual(sortGroup(lines, 1), lines);
	});
});

describe('never losing a line', () => {
	it('returns exactly as many lines as it was given', () => {
		const lines = [
			'# Todos',
			'[ ] Low ...',
			'    ... continued',
			'\t[ ] child ...',
			'\t    ... also continued',
			'[ ] !!! High',
			'',
			'# Another group',
			'[ ] Untouched',
		];

		const sorted = sortGroup(lines, 1);
		assert.equal(sorted.length, lines.length);
		assert.deepEqual([...sorted].sort(), [...lines].sort(), 'the same lines, reordered');
	});
});

describe('a group with a comment in it', () => {
	it('sorts, instead of silently refusing', () => {
		// Loose lines used to be dropped from the rebuilt group, which made it
		// shorter, which tripped the line-count guard, which abandoned the
		// sort. The command then reported the group was already in order - the
		// guard doing its job while the outcome was a lie.
		assert.deepEqual(
			sortGroup(['# Todos', '[ ] Low', '<!-- parked -->', '[ ] !!! Urgent'], 1),
			['# Todos', '<!-- parked -->', '[ ] !!! Urgent', '[ ] Low'],
		);
	});

	it('carries a comment with the item it sits above', () => {
		// A note written above an item is a note about that item.
		assert.deepEqual(
			sortGroup(['[ ] Low', '<!-- about the urgent one -->', '[ ] !!! Urgent'], 0),
			['<!-- about the urgent one -->', '[ ] !!! Urgent', '[ ] Low'],
		);
	});

	it('carries a whole comment block', () => {
		assert.deepEqual(
			sortGroup(['[ ] Low', '<!--', '[ ] Parked', '-->', '[ ] !!! Urgent'], 0),
			['<!--', '[ ] Parked', '-->', '[ ] !!! Urgent', '[ ] Low'],
		);
	});

	it('leaves a trailing comment at the end', () => {
		assert.deepEqual(
			sortGroup(['# Todos', '[ ] Low', '[ ] !!! Urgent', '<!-- trailing -->'], 1),
			['# Todos', '[ ] !!! Urgent', '[ ] Low', '<!-- trailing -->'],
		);
	});

	it('still loses nothing', () => {
		const lines = ['# Todos', '[ ] Low ...', '    ... more', '<!-- note -->', '[ ] !!! Urgent', '<!-- end -->'];
		const sorted = sortGroup(lines, 1);
		assert.equal(sorted.length, lines.length);
		assert.deepEqual([...sorted].sort(), [...lines].sort());
	});
});

describe('sorting agrees with the sidebar about what you can act on', () => {
	const TODAY = { today: 20260731, criticalAfterDays: 14, soonWithinDays: 7 };

	it('sinks an item that cannot be started yet', () => {
		// Ranking on priority and due date alone put an item unstartable
		// until 2030 above one you could do today - the same disagreement the
		// editor decoration had with the sidebar, in a different place.
		assert.deepEqual(
			sortGroup(['[ ] A <- 2030-01-01 -> 2026-01-01', '[ ] B -> 2026-02-01'], 0, TODAY),
			['[ ] B -> 2026-02-01', '[ ] A <- 2030-01-01 -> 2026-01-01'],
		);
	});

	it('sinks a waiting item and a blocked one, however overdue', () => {
		assert.deepEqual(
			sortGroup(['[>] Waiting -> 2020-01-01', '[ ] Blocker #id=aaaa',
				'[ ] Held -> 2020-01-01 #after=aaaa', '[ ] Plain -> 2027-01-01'], 0, TODAY),
			['[ ] Plain -> 2027-01-01', '[ ] Blocker #id=aaaa',
				'[>] Waiting -> 2020-01-01', '[ ] Held -> 2020-01-01 #after=aaaa'],
		);
	});

	it('still ranks by priority, then due date, inside a band', () => {
		assert.deepEqual(
			sortGroup(['[ ] Low -> 2026-08-05', '[ ] !!! High -> 2026-08-05'], 0, TODAY),
			['[ ] !!! High -> 2026-08-05', '[ ] Low -> 2026-08-05'],
		);
	});

	it('is still idempotent with the urgency ranking in play', () => {
		const lines = ['[>] Waiting', '[ ] !!! Urgent -> 2020-01-01', '[ ] Later <- 2030-01-01'];
		const once = sortGroup(lines, 0, TODAY);
		assert.deepEqual(sortGroup(once, 0, TODAY), once);
	});
});
