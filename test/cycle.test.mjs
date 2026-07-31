/**
 * How long an item took.
 *
 * `#created=` and `#done=` were being written and never read: the data was
 * recorded for a report that did not exist.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { cycleTime, formatCycleTime } = require_('../out/cycle.js');
const { collect } = require_('../out/collect.js');

const took = (line) => cycleTime(line, 'created', 'done');

describe('reading a cycle time', () => {
	it('counts the days between the two stamps', () => {
		assert.equal(took('[x] Paint #created=2026-01-01 #done=2026-01-13'), 12);
	});

	it('counts zero for work finished the day it started', () => {
		// A real answer, not a missing one, so it is returned rather than
		// folded into null.
		assert.equal(took('[x] Quick #created=2026-01-01 #done=2026-01-01'), 0);
	});

	it('needs both stamps', () => {
		assert.equal(took('[x] Only done #done=2026-01-13'), null);
		assert.equal(took('[ ] Only created #created=2026-01-01'), null);
		assert.equal(took('[x] Neither'), null);
	});

	it('ignores a stamp that is not a date', () => {
		assert.equal(took('[x] x #created=whenever #done=2026-01-13'), null);
	});

	it('returns a negative as written rather than tidying it away', () => {
		// The dates disagree with each other. Quietly showing 0 would be the
		// same silent tidying this fork keeps removing.
		assert.equal(took('[x] x #created=2026-02-01 #done=2026-01-01'), -31);
	});

	it('crosses months and years', () => {
		assert.equal(took('[x] x #created=2025-12-25 #done=2026-01-05'), 11);
	});
});

describe('showing a cycle time', () => {
	it('reads at a glance', () => {
		assert.equal(formatCycleTime(0), 'same day');
		assert.equal(formatCycleTime(1), '1 day');
		assert.equal(formatCycleTime(12), '12 days');
	});

	it('says so when the dates disagree', () => {
		assert.equal(formatCycleTime(-31), '-31 days (the dates disagree)');
	});
});

describe('what the workspace view is given', () => {
	it('carries the cycle time on the item', () => {
		const [item] = collect(['[x] Paint #created=2026-01-01 #done=2026-01-13']);
		assert.equal(item.took, 12);
	});

	it('is null where nothing was recorded', () => {
		assert.equal(collect(['[ ] Ordinary'])[0].took, null);
	});

	it('follows the configured tag names', () => {
		const [item] = collect(['[x] x #opened=2026-01-01 #closed=2026-01-03'], 'est',
			{ creation: 'opened', completion: 'closed' });
		assert.equal(item.took, 2);
	});
});
