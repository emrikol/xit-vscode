/**
 * Time estimates.
 *
 * A tag, not syntax: an estimate is not a date and pairs with no arrow, so it
 * buys nothing back against the cost every syntax element carries.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { parseEstimate, estimateOn, formatEstimate } = require_('../out/estimate.js');
const { collect, totalEstimate } = require_('../out/collect.js');

describe('reading an estimate', () => {
	it('takes minutes, hours, days and weeks', () => {
		assert.equal(parseEstimate('30m'), 30);
		assert.equal(parseEstimate('2h'), 120);
		assert.equal(parseEstimate('1d'), 480, 'a working day is eight hours');
		assert.equal(parseEstimate('1w'), 2400, 'a working week is five days');
	});

	it('takes a decimal', () => {
		assert.equal(parseEstimate('1.5h'), 90);
	});

	it('takes a decimal through a real tag, which is the test that was missing', () => {
		// parseEstimate('1.5h') passed all along. `#est=1.5h` parsed as
		// `#est=1`, because `.` was not a legal unquoted tag value character,
		// so the documented decimal never worked and the unit test could not
		// see it. Exercising the parser is not exercising the feature.
		assert.equal(estimateOn('[ ] Write #est=1.5h', 'est'), 90);
	});

	it('is not case sensitive about the unit', () => {
		assert.equal(parseEstimate('2H'), 120);
	});

	it('refuses anything else rather than guessing', () => {
		// A total built partly from misread values is worse than one that
		// admits it is missing something.
		for (const value of ['2', 'h', '2 h', '2hrs', 'soon', '0h', '-1h', '', null]) {
			assert.equal(parseEstimate(value), null, JSON.stringify(value));
		}
	});

	it('does not share the repeat grammar, where m means months', () => {
		// The reason this has its own parser rather than a drift detector:
		// `2m` is two minutes here and two months there.
		assert.equal(parseEstimate('2m'), 2);
	});

	it('reads the tag off a line', () => {
		assert.equal(estimateOn('[ ] Do this #est=2h', 'est'), 120);
		assert.equal(estimateOn('[ ] Do this', 'est'), null);
		assert.equal(estimateOn('[ ] Do this #est=nonsense', 'est'), null);
	});
});

describe('showing an estimate', () => {
	it('reads at a glance', () => {
		assert.equal(formatEstimate(30), '30m');
		assert.equal(formatEstimate(60), '1h');
		assert.equal(formatEstimate(90), '1h 30m');
		assert.equal(formatEstimate(360), '6h');
	});

	it('only reaches for days above a working week', () => {
		// "3d 2h" is harder to judge than "26h" for anything you might do this
		// week, and easier for anything you would not.
		assert.equal(formatEstimate(2399), '39h 59m');
		assert.equal(formatEstimate(2400), '5d');
		assert.equal(formatEstimate(2400 + 120), '5d 2h');
	});
});

describe('totalling a group', () => {
	const items = (...lines) => collect(lines);

	it('adds up what is estimated', () => {
		assert.deepEqual(totalEstimate(items('[ ] A #est=2h', '[ ] B #est=30m')),
			{ minutes: 150, unestimated: 0 });
	});

	it('counts what is not, rather than dropping it', () => {
		// "6h" for a group that is six hours plus four unknown things is a
		// number that lies. "6h + 4" does not.
		assert.deepEqual(totalEstimate(items('[ ] A #est=2h', '[ ] B', '[ ] C')),
			{ minutes: 120, unestimated: 2 });
	});

	it('is zero for a group with nothing estimated', () => {
		assert.deepEqual(totalEstimate(items('[ ] A', '[ ] B')), { minutes: 0, unestimated: 2 });
	});

	it('is empty for no items at all', () => {
		assert.deepEqual(totalEstimate([]), { minutes: 0, unestimated: 0 });
	});
});
