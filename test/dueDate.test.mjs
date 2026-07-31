/**
 * Due dates: the end of each period, and the drift detector.
 *
 * src/dueDate.ts matches due dates in TypeScript, which the grammar already
 * does in Oniguruma. That duplication is not an oversight and cannot be
 * removed: the decoration has to know where the dates are, and VS Code
 * exposes no API for reading TextMate tokens from an extension. So the two
 * are pinned to each other instead — the last suite in this file runs the
 * whole conformance corpus through both and fails on a single character of
 * disagreement.
 *
 * Same shape as the other two drift detectors in this repo: the manifest
 * literals in src/test/manifest.ts checked against package.json, and the test
 * file list in src/test/index.ts checked against src/test/*.test.ts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { tokenize, scoped } from './tokenizer.mjs';
import { corpusAspects } from './corpus.test.mjs';

const require = createRequire(import.meta.url);
const { dueDatesOn, dueDates, overdue, todayFrom, startDatesOn, startOfPeriod } = require('../out/dueDate.js');

/** The single due date on a line, or null. */
function on(line) {
	const [first] = dueDatesOn(line);
	return first ?? null;
}

describe('finding due dates', () => {
	it('finds a plain one', () => {
		assert.equal(on('[ ] Do this -> 2026-01-31').text, '-> 2026-01-31');
	});

	it('rejects the forms the guide calls unrecognised', () => {
		for (const line of [
			'[ ] ->2026-01-31', '[ ] ->   2026-01-31', '[ ] >2026-01-31',
			'[ ] → 2026-01-31', '[ ] ---> 2026-01-31', '[ ] Due-> 2026-01-31',
			'[ ] -> 2026-01-31T10:00', '[ ] -> 2026-01-31-0', '[ ] -> 2026/01/31/0',
			'[ ] -> 2026-01/31', '[ ] -> 2026-01-31very urgent',
		]) {
			assert.equal(on(line), null, `${line} should not hold a due date`);
		}
	});

	it('accepts every pattern the spec defines', () => {
		for (const text of ['-> 2026', '-> 2026-01', '-> 2026-01-31', '-> 2026-W01', '-> 2026-Q1', '-> 2026/01/31', '-> 2026/W01']) {
			assert.equal(on(`[ ] Task ${text}`)?.text, text);
		}
	});

	it('reports where it found it', () => {
		const found = on('[ ] Task -> 2026-01-31 and more');
		assert.equal(found.start, 9);
		assert.equal('[ ] Task -> 2026-01-31 and more'.slice(found.start, found.end), '-> 2026-01-31');
	});
});

describe('the end of a period', () => {
	// The whole reason this module exists. Only one of the five patterns names
	// a single day, so "overdue" has to mean "the period has ended".
	const end = (text) => on(`[ ] Task ${text}`).endOfPeriod;

	it('a day is itself', () => {
		assert.equal(end('-> 2026-01-31'), 20260131);
	});

	it('a month ends on its last day', () => {
		assert.equal(end('-> 2026-01'), 20260131);
		assert.equal(end('-> 2026-02'), 20260228);
		assert.equal(end('-> 2026-04'), 20260430);
	});

	it('February gains a day in a leap year', () => {
		assert.equal(end('-> 2024-02'), 20240229);
		assert.equal(end('-> 2100-02'), 21000228, '2100 is divisible by 4 but not a leap year');
		assert.equal(end('-> 2000-02'), 20000229, '2000 is divisible by 400 and is a leap year');
	});

	it('a year ends on the last of December', () => {
		assert.equal(end('-> 2026'), 20261231);
	});

	it('a quarter ends with its third month', () => {
		assert.equal(end('-> 2026-Q1'), 20260331);
		assert.equal(end('-> 2026-Q2'), 20260630);
		assert.equal(end('-> 2026-Q3'), 20260930);
		assert.equal(end('-> 2026-Q4'), 20261231);
	});

	it('a week ends on its Sunday, counted the ISO way', () => {
		// ISO 8601: weeks start on Monday, and week 1 is the one containing
		// the first Thursday, equivalently the one containing 4 January. This
		// is the fiddly one, so the cases are years that start on different
		// weekdays.
		assert.equal(end('-> 2022-W01'), 20220109, '2022 week 1 is 3-9 January');
		assert.equal(end('-> 2021-W01'), 20210110, '2021 starts on a Friday, so week 1 begins 4 January');
		assert.equal(end('-> 2024-W01'), 20240107, '2024 starts on a Monday, which is week 1 day 1');
	});

	it('a week can end in the following year', () => {
		assert.equal(end('-> 2022-W52'), 20230101);
	});

	it('clamps a day that its month does not have', () => {
		// The grammar cannot count the days in February, so `-> 2026-02-31`
		// is matched. It names some day at the end of February, and by the
		// first of March it has certainly passed.
		assert.equal(end('-> 2026-02-31'), 20260228);
		assert.equal(end('-> 2026-04-31'), 20260430);
	});
});

describe('one due date per item', () => {
	// Spec §Description: an item may hold "one due date. (Any additional due
	// dates MUST be disregarded.)" Across the whole item, not just its first
	// line, which is why this walks items rather than lines.

	it('takes the first and disregards the rest', () => {
		const found = dueDates(['[ ] Task -> 2026-01-31 -> 2026-02-28']);
		assert.deepEqual(found.map((date) => date.text), ['-> 2026-01-31']);
	});

	it('disregards one on a continuation line', () => {
		const found = dueDates(['[ ] Task -> 2026-01-31', '    more -> 2026-02-28']);
		assert.deepEqual(found.map((date) => date.text), ['-> 2026-01-31']);
	});

	it('finds one that is only on a continuation line', () => {
		const found = dueDates(['[ ] Do something until ...', '    -> 2026-01-31']);
		assert.deepEqual(found.map((date) => ({ line: date.line, text: date.text })), [{ line: 1, text: '-> 2026-01-31' }]);
	});

	it('starts again at the next item', () => {
		const found = dueDates(['[ ] One -> 2026-01-31', '[ ] Two -> 2026-02-28']);
		assert.deepEqual(found.map((date) => date.text), ['-> 2026-01-31', '-> 2026-02-28']);
	});

	it('ignores a date outside any item', () => {
		assert.deepEqual(dueDates(['Just a title -> 2026-01-31']), []);
		assert.deepEqual(dueDates(['[ ] Task', '', 'not indented -> 2026-01-31']), []);
	});

	it('ends an item at a blank line, even an indented one', () => {
		// Spec §Item: "The item MUST NOT contain any blank lines."
		const found = dueDates(['[ ] Task', '    ', '    -> 2026-01-31']);
		assert.deepEqual(found, []);
	});
});

describe('overdue', () => {
	const lines = ['[ ] Yesterday -> 2026-01-31', '[ ] This year -> 2026', '[ ] Next month -> 2026-03'];

	it('is measured against the end of the period, not its start', () => {
		const found = overdue(lines, 20260215).map((date) => date.text);
		assert.deepEqual(found, ['-> 2026-01-31']);
	});

	it('does not fire on the last day of the period', () => {
		assert.deepEqual(overdue(['[ ] Task -> 2026-01-31'], 20260131), []);
		assert.deepEqual(overdue(['[ ] Task -> 2026-01-31'], 20260201).length, 1);
	});

	it('takes today from the caller, so it can be tested at all', () => {
		assert.equal(todayFrom(new Date(2026, 6, 31)), 20260731);
	});
});

describe('start dates', () => {
	// The corpus drift detector below is bounded by what the guide happens to
	// contain - it has no `Q4` example, so a grammar that rejected Q4 would
	// survive it. These cover the shapes it does not reach.
	const start = (line) => startDatesOn(line).map((date) => date.text);

	it('reads all five patterns, with either separator', () => {
		for (const value of ['2026-08-14', '2026-08', '2026', '2026-W33', '2026-Q3', '2026-Q4', '2026/08/14', '2026/W01']) {
			assert.deepEqual(start(`[ ] x <- ${value}`), [`<- ${value}`], value);
		}
	});

	it('keeps the same boundaries as the due date', () => {
		assert.deepEqual(start('[ ] Start<- 2026-08-14'), [], 'a letter before the arrow');
		assert.deepEqual(start('[ ] x <-2026-08-14'), [], 'no space after the arrow');
		assert.deepEqual(start('[ ] x <- 2026-08/14'), [], 'mixed separators');
		assert.deepEqual(start('[ ] x <- 2026-13-01'), [], 'month out of range');
	});

	it('does not confuse the two arrows', () => {
		assert.deepEqual(start('[ ] x -> 2026-08-14'), []);
		assert.deepEqual(dueDatesOn('[ ] x <- 2026-08-14').map((date) => date.text), []);
	});

	it('reads both arrows on one line', () => {
		const line = '[ ] Do it <- 2026-08-14 -> 2026-08-20';
		assert.deepEqual(start(line), ['<- 2026-08-14']);
		assert.deepEqual(dueDatesOn(line).map((date) => date.text), ['-> 2026-08-20']);
	});

	it('gives the first day of whatever period was named', () => {
		const first = (value) => startOfPeriod(startDatesOn(`[ ] x <- ${value}`)[0].parts);
		assert.equal(first('2026-08-14'), 20260814);
		assert.equal(first('2026-08'), 20260801);
		assert.equal(first('2026-Q3'), 20260701);
		assert.equal(first('2026'), 20260101);
		// ISO weeks run Monday to Sunday. Week 33 of 2026 is 10-16 August.
		assert.equal(first('2026-W33'), 20260810);
	});

	it('starts a week on the Monday, including across a year boundary', () => {
		// 2022-W52 ends on 1 January 2023, so it starts on 26 December 2022.
		assert.equal(startOfPeriod(startDatesOn('[ ] x <- 2022-W52')[0].parts), 20221226);
	});
});

describe('the TypeScript matcher and the grammar agree', () => {
	// The drift detector. Neither implementation can be removed, so this is
	// what stops them parting company: every line of the conformance corpus,
	// through both.
	it('finds the same due dates in every example in the syntax guide', async () => {
		// Compared per aspect, not per line, and through dueDates() rather
		// than dueDatesOn(). Both matter, and getting it wrong the first time
		// showed why: a line reading "    -> 2022-01-31" holds a due date only
		// if the line above it started an item, and "-> a -> b" holds one
		// only because the second is disregarded. Neither fact is visible to
		// anything looking at a line on its own, and dueDates() is what the
		// decoration actually calls.
		const disagreements = [];
		let compared = 0;

		for (const aspect of corpusAspects()) {
			const lines = aspect.lines.map((line) => line.text);

			const tokenized = await tokenize(lines.join('\n'));
			const fromGrammar = tokenized.flatMap((line, index) =>
				scoped(line, 'markup.other.task.date').map((text) => ({ line: index, text })));

			const fromCode = dueDates(lines).map((date) => ({ line: date.line, text: date.text }));

			compared += lines.length;
			if (JSON.stringify(fromGrammar) !== JSON.stringify(fromCode)) {
				disagreements.push(
					`  ${aspect.id}: ${aspect.rule}\n` +
					lines.map((text) => `    ${JSON.stringify(text)}`).join('\n') + '\n' +
					`    grammar:    ${JSON.stringify(fromGrammar)}\n` +
					`    TypeScript: ${JSON.stringify(fromCode)}`,
				);
			}
		}

		assert.ok(compared > 150, `only ${compared} lines compared`);
		assert.deepEqual(disagreements, [],
			`src/dueDate.ts has drifted from the grammar:\n\n${disagreements.join('\n\n')}`);
	});

	it('finds the same start dates, on the same corpus with the arrow swapped', async () => {
		// The start date is the due date's value behind a different arrow, and
		// src/dueDate.ts builds both from one shared string. The grammar has to
		// repeat itself, so this runs every due-date example in the corpus
		// through both with `->` rewritten to `<-`.
		//
		// That is the whole point of reusing the value: a corpus written for
		// one arrow tests the other for free, including the parts nobody would
		// think to write by hand, like a mixed `-` and `/` separator.
		const disagreements = [];
		let compared = 0;

		for (const aspect of corpusAspects()) {
			const lines = aspect.lines.map((line) => line.text.replaceAll('-> ', '<- '));
			if (!lines.some((text) => text.includes('<- '))) continue;

			const tokenized = await tokenize(lines.join('\n'));
			const fromGrammar = tokenized.flatMap((line, index) =>
				scoped(line, 'markup.other.task.start').map((text) => ({ line: index, text })));

			const fromCode = lines.flatMap((text, index) =>
				startDatesOn(text).map((date) => ({ line: index, text: date.text })));

			compared += lines.length;
			if (JSON.stringify(fromGrammar) !== JSON.stringify(fromCode)) {
				disagreements.push(
					`  ${aspect.id}: ${aspect.rule}\n` +
					lines.map((text) => `    ${JSON.stringify(text)}`).join('\n') + '\n' +
					`    grammar:    ${JSON.stringify(fromGrammar)}\n` +
					`    TypeScript: ${JSON.stringify(fromCode)}`,
				);
			}
		}

		assert.ok(compared > 20, `only ${compared} lines compared`);
		assert.deepEqual(disagreements, [],
			`the start date has drifted from the grammar:\n\n${disagreements.join('\n\n')}`);
	});
});
