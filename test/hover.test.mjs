/**
 * The checkbox hover.
 *
 * Two things are being tested and they fail differently. The prose is what a
 * person reads, so it is asserted on loosely - the numbers and the words that
 * carry meaning. The status links are a machine contract with VS Code: a
 * malformed `command:` URI does not throw, it silently does nothing when
 * clicked, so those are asserted on exactly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { STATUS_LABEL, describeUrgency, escapeMarkdown, hoverMarkdown, statusRow, withoutTags } =
	require_('../out/hover.js');
const { collect, urgencyOf } = require_('../out/collect.js');
const { STATUSES } = require_('../out/checkbox.js');

const TODAY = { today: 20260731, criticalAfterDays: 14, soonWithinDays: 7 };
const EXPLAINED = ['est', 'id', 'after', 'created', 'done'];
const TARGET = { uri: 'file:///todo.xit', line: 0 };

/** The hover for the first item of a document, with the defaults the extension passes. */
function hoverFor(lines, { blockers = [], id = null, at = 0 } = {}) {
	const item = collect(lines).find((each) => each.line === at);
	assert.ok(item, `no item on line ${at}`);
	return hoverMarkdown({
		item,
		urgency: urgencyOf(item, TODAY),
		today: TODAY.today,
		blockers,
		target: { ...TARGET, line: at },
		explained: EXPLAINED,
		id,
	});
}

describe('what the hover says about an item', () => {
	it('names the status in words, not just as a checkbox', () => {
		assert.match(hoverFor(['[@] Write the notes']), /\*\*Ongoing\*\*/);
	});

	it('says how late an overdue item is, not merely that it is', () => {
		// "Overdue" and "Overdue by 3 months" are different problems, and the
		// sidebar could never say which because it groups rather than counts.
		assert.match(hoverFor(['[ ] Rent -> 2026-07-20']), /Overdue by 11 days/);
	});

	it('counts a single day in the singular', () => {
		assert.match(hoverFor(['[ ] Rent -> 2026-07-30']), /Overdue by 1 day\b/);
	});

	it('says how long until something due', () => {
		assert.match(hoverFor(['[ ] Rent -> 2026-08-05']), /Due soon, in 5 days/);
	});

	it('says when a period ends today rather than counting zero days', () => {
		assert.match(hoverFor(['[ ] Rent -> 2026-07-31']), /the period ends today/);
	});

	it('says how much longer an item cannot be started', () => {
		assert.match(hoverFor(['[ ] Book it <- 2026-08-10']), /Not started yet, for another 10 days/);
	});

	it('shows the dates as written, so they match the file', () => {
		// Reformatted dates would be a second vocabulary for the same fact,
		// and you could not search the file for what the hover showed you.
		const hover = hoverFor(['[ ] Ship it <- 2026-08-01 -> 2026-W40']);
		assert.match(hover, /Not before `2026-08-01`/);
		assert.match(hover, /Due `2026-W40`/);
	});

	it('shows the estimate and the cycle time', () => {
		assert.match(hoverFor(['[ ] Draft #est=90m']), /Estimated 1h 30m/);
		assert.match(hoverFor(['[x] Draft #created=2026-07-01 #done=2026-07-08']), /Took 7 days/);
	});

	it('shows the id, which is the one machine tag worth reading', () => {
		assert.match(hoverFor(['[ ] Blocker #id=aaaa'], { id: 'aaaa' }), /Id `aaaa`/);
	});
});

describe('what it does not repeat', () => {
	it('cuts the tags it restates in words', () => {
		// `#est=30m` in the description and `Estimated 30m` two lines below is
		// the same fact twice in one popup. src/outline.ts lifts the date
		// arrows for the same reason.
		const hover = hoverFor(['[ ] Draft #est=30m']);
		assert.match(hover, /Estimated 30m/);
		assert.doesNotMatch(hover, /#est=/);
	});

	it('keeps a tag you chose yourself', () => {
		// The line is drawn at tags with a rendered meaning. `#garden` is a
		// label, and cutting it would hide something the item actually says.
		assert.match(hoverFor(['[ ] Water the plants #garden #est=30m']), /#garden/);
	});

	it('leaves nothing behind when the description was only tags', () => {
		const hover = hoverFor(['[ ] #est=30m']);
		assert.match(hover, /\*\*Open\*\*/);
		assert.doesNotMatch(hover, /#est/);
	});

	it('cuts a tag that opens the description', () => {
		// The tag pattern needs whitespace or punctuation before the hash, and
		// a description is a line with its checkbox already cut off - which
		// takes that whitespace with it. `[ ] #est=30m` kept its tag while
		// `[ ] Draft #est=30m` lost it.
		assert.equal(withoutTags('#est=30m', EXPLAINED), '');
		assert.equal(withoutTags('#est=30m and more', EXPLAINED), 'and more');
	});

	it('cuts back to front, so two tags do not mangle each other', () => {
		assert.equal(withoutTags('One #est=1h two #after=aaaa three', EXPLAINED), 'One two three');
	});

	it('folds spelling, so #EST is cut like #est', () => {
		assert.equal(withoutTags('Draft #EST=1h', EXPLAINED), 'Draft');
	});
});

describe('prose that is not markup', () => {
	it('does not let a description italicise half the hover', () => {
		assert.match(hoverFor(['[ ] Buy *milk*']), /Buy \\\*milk\\\*/);
	});

	it('escapes the characters that would otherwise render', () => {
		assert.equal(escapeMarkdown('a*b_c[d]e`f'), 'a\\*b\\_c\\[d\\]e\\`f');
	});

	it('escapes a blocker name too, since it comes from another line', () => {
		const hover = hoverFor(['[ ] Held #after=aaaa'], {
			blockers: [{ label: 'Sign the *contract*', target: null, open: true }],
		});
		assert.match(hover, /Sign the \\\*contract\\\*/);
	});
});

describe('what is holding the item up', () => {
	it('names the blocker and links to it', () => {
		const hover = hoverFor(['[ ] Held #after=aaaa'], {
			blockers: [{ label: 'Sign the contract', target: { uri: 'file:///work.xit', line: 13 }, open: true }],
		});
		assert.match(hover, /Waiting on \[Sign the contract\]\(file:\/\/\/work\.xit#L14\)/);
	});

	it('says so when the blocker is already done', () => {
		// Leaving it out would read as a parsing failure: the `#after=` is
		// still written on the line, so its absence here needs explaining.
		const hover = hoverFor(['[ ] Held #after=aaaa'], {
			blockers: [{ label: 'Sign it', target: null, open: false }],
		});
		assert.match(hover, /Was waiting on Sign it, which is done/);
	});

	it('shows the id it could not resolve, rather than staying silent', () => {
		const hover = hoverFor(['[ ] Held #after=zzzz'], {
			blockers: [{ label: 'zzzz', target: null, open: true }],
		});
		assert.match(hover, /Waiting on zzzz/);
	});
});

describe('the status row', () => {
	const [item] = collect(['[@] Ongoing item']);

	it('offers every status', () => {
		const row = statusRow(item, TARGET);
		for (const status of STATUSES) {
			assert.ok(row.includes(STATUS_LABEL[status]), `${STATUS_LABEL[status]} is not offered`);
		}
	});

	it('names every status, with no blanks', () => {
		// STATUS_LABEL is Record<Status, string>, so a missing entry is a
		// compile error rather than an empty label. This is the runtime half:
		// a label that exists but is empty would still read as a gap.
		for (const status of STATUSES) {
			assert.ok(STATUS_LABEL[status]?.length > 0, `[${status}] has no label`);
		}
	});

	it('shows the current status without linking it', () => {
		// "Set this to what it already is" is not an offer, and leaving it in
		// place keeps the row the same width whichever status you look at.
		const row = statusRow(item, TARGET);
		assert.match(row, /`\[@\]` \*\*Ongoing\*\*/);
		assert.doesNotMatch(row, /\[`\[@\]` Ongoing\]\(command:/);
	});

	it('builds a command URI VS Code can actually parse', () => {
		// A malformed one does not throw. It silently does nothing when
		// clicked, which is the worst way for this to fail.
		const row = statusRow(item, TARGET);
		const [, encoded] = /command:xit\.setStatus\?([^\s")]+)/.exec(row) ?? [];
		assert.ok(encoded, 'no command link found');

		const [payload] = JSON.parse(decodeURIComponent(encoded));
		assert.deepEqual(Object.keys(payload).sort(), ['line', 'status', 'uri']);
		assert.equal(payload.uri, TARGET.uri);
		assert.equal(payload.line, TARGET.line);
		assert.ok(STATUSES.includes(payload.status));
	});

	it('carries the line it was built for, not the line the cursor is on', () => {
		// The hover fires where the mouse is, and the cursor is somewhere else
		// entirely. A payload that trusted the selection would rewrite the
		// wrong line.
		const row = statusRow(item, { uri: TARGET.uri, line: 42 });
		const [, encoded] = /command:xit\.setStatus\?([^\s")]+)/.exec(row) ?? [];
		assert.equal(JSON.parse(decodeURIComponent(encoded))[0].line, 42);
	});

	it('encodes a status that would otherwise break the URI', () => {
		// `?` and a space are both statuses and both have meaning in a URI.
		const row = statusRow(item, TARGET);
		const statuses = [...row.matchAll(/command:xit\.setStatus\?([^\s")]+)/g)].map(
			([, encoded]) => JSON.parse(decodeURIComponent(encoded))[0].status,
		);
		assert.ok(statuses.includes('?'), 'the in-question status did not survive encoding');
		assert.ok(statuses.includes(' '), 'the open status did not survive encoding');
	});
});

describe('the parts fit together', () => {
	it('separates the reading from the doing', () => {
		// The rule below the facts is what stops the status row reading as one
		// more fact about the item.
		const hover = hoverFor(['[ ] Draft -> 2026-08-05']);
		const [above, below] = hover.split('\n\n---\n\n');
		assert.match(above, /Due `2026-08-05`/);
		assert.match(below, /command:xit\.setStatus/);
	});

	it('says something for an item with nothing on it at all', () => {
		const hover = hoverFor(['[ ]']);
		assert.match(hover, /\*\*Open\*\* — No due date/);
		assert.match(hover, /command:xit\.setStatus/);
	});

	it('describes every status without throwing', () => {
		for (const status of STATUSES) {
			const hover = hoverFor([`[${status}] An item -> 2026-08-05`]);
			assert.ok(hover.length > 0, `[${status}] produced nothing`);
		}
	});
});

describe('urgency in words', () => {
	it('agrees with the sidebar about which group the item is in', () => {
		// The words come from URGENCY_LABEL, which the sidebar also uses, so
		// the two cannot describe the same item differently.
		const cases = [
			['[ ] A -> 2020-01-01', /Critically overdue/],
			['[ ] A -> 2026-07-28', /Overdue/],
			['[ ] A -> 2026-08-03', /Due soon/],
			['[ ] A -> 2027-01-01', /Later/],
			['[ ] A', /No due date/],
			['[>] A', /Waiting on someone else/],
			['[ ] A <- 2030-01-01', /Not started yet/],
		];
		for (const [line, expected] of cases) {
			assert.match(hoverFor([line]), expected, line);
		}
	});

	it('says which item is blocking rather than only that one is', () => {
		const lines = ['[ ] Blocker #id=aaaa', '[ ] Held #after=aaaa'];
		const item = collect(lines).find((each) => each.line === 1);
		assert.equal(describeUrgency(item, urgencyOf(item, TODAY), TODAY.today), 'Blocked by another item');
	});
});
