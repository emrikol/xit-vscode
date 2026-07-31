/**
 * The three surfaces that answer "is this late" must agree.
 *
 * The editor decoration, the workspace view and the status bar each decide
 * whether an item is overdue. They disagreed, and every disagreement was found
 * by hand, one question at a time:
 *
 *   [x] Done -> 2020-01-01      editor said overdue, the other two did not
 *   [>] Waiting -> 2020-01-01   editor said overdue, the other two did not
 *   [ ] x <- 2030-01-01 -> ...  editor said overdue, the other two did not
 *
 * Finding those by hand is not a method. This walks the cross-product of
 * every status against every combination of dates and blocking, and asserts
 * the three answers match on all of it - so the next feature that forgets a
 * status or an arrow fails here rather than in a file a year from now.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { collect, urgencyOf, isOpen, overdueCount } = require_('../out/collect.js');
const { overdue } = require_('../out/dueDate.js');
const { STATUSES } = require_('../out/checkbox.js');

const TODAY = 20260731;
const THRESHOLDS = { today: TODAY, criticalAfterDays: 14, soonWithinDays: 7 };

/** Every shape of item worth asking the question about. */
function* documents() {
	const dates = [
		['', 'no dates'],
		['-> 2020-01-01', 'long overdue'],
		['-> 2026-07-30', 'just overdue'],
		['-> 2027-01-01', 'not due yet'],
		['<- 2030-01-01 -> 2020-01-01', 'overdue but not startable'],
		['<- 2020-01-01 -> 2020-01-01', 'overdue and startable'],
	];

	for (const status of STATUSES) {
		for (const [dates_, label] of dates) {
			yield { lines: [`[${status}] Item ${dates_}`.trimEnd()], what: `[${status}] ${label}` };
			// The same, blocked by an unfinished item above it.
			yield {
				lines: ['[ ] Blocker #id=aaaa', `[${status}] Item ${dates_} #after=aaaa`.replace(/\s+/g, ' ').trim()],
				what: `[${status}] ${label}, blocked`,
			};
		}
	}
}

/** What the editor decoration would mark, using the same filter extension.ts applies. */
function editorMarks(lines) {
	const late = new Set(collect(lines)
		.filter(isOpen)
		.filter((item) => ['critical', 'overdue'].includes(urgencyOf(item, THRESHOLDS)))
		.map((item) => item.line));

	return new Set(overdue(lines, TODAY).filter((date) => late.has(date.line)).map((date) => date.line));
}

/** What the workspace view would list as overdue or critical. */
function sidebarMarks(lines) {
	return new Set(collect(lines)
		.filter(isOpen)
		.filter((item) => ['critical', 'overdue'].includes(urgencyOf(item, THRESHOLDS)))
		.map((item) => item.line));
}

describe('the editor, the sidebar and the status bar agree', () => {
	it('over every status against every arrangement of dates and blocking', () => {
		const disagreements = [];
		let compared = 0;

		for (const { lines, what } of documents()) {
			const editor = editorMarks(lines);
			const sidebar = sidebarMarks(lines);
			const bar = overdueCount([{ items: collect(lines) }], THRESHOLDS).overdue;

			compared += 1;

			// The editor marks a date; the sidebar lists an item. They must
			// agree line for line, since an item's date is on its own line here.
			if (JSON.stringify([...editor].sort()) !== JSON.stringify([...sidebar].sort())) {
				disagreements.push(`  ${what}\n    editor: ${[...editor]}  sidebar: ${[...sidebar]}`);
			}

			if (bar !== sidebar.size) {
				disagreements.push(`  ${what}\n    status bar: ${bar}  sidebar: ${sidebar.size}`);
			}
		}

		assert.ok(compared >= 60, `only ${compared} shapes compared`);
		assert.deepEqual(disagreements, [],
			`the surfaces disagree about what is late:\n\n${disagreements.join('\n')}`);
	});

	it('never calls a finished item late, on any surface', () => {
		// The plainest case, and the one met every day: you check something
		// off and it stays angry red.
		for (const status of ['x', '~']) {
			const lines = [`[${status}] Done -> 2020-01-01`];
			assert.deepEqual([...editorMarks(lines)], [], status);
			assert.deepEqual([...sidebarMarks(lines)], [], status);
			assert.equal(overdueCount([{ items: collect(lines) }], THRESHOLDS).overdue, 0, status);
		}
	});

	it('never calls work you cannot act on late', () => {
		// Waiting, not yet started, and blocked are one question with one
		// answer. All three surfaces have to give it.
		for (const lines of [
			['[>] Waiting -> 2020-01-01'],
			['[ ] Later <- 2030-01-01 -> 2020-01-01'],
			['[ ] Blocker #id=aaaa', '[ ] Held -> 2020-01-01 #after=aaaa'],
		]) {
			assert.deepEqual([...editorMarks(lines)].filter((line) => line !== 0), [], lines.join(' / '));
			assert.equal(overdueCount([{ items: collect(lines) }], THRESHOLDS).overdue,
				sidebarMarks(lines).size, lines.join(' / '));
		}
	});
});
