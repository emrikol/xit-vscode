/**
 * Diagnostics: the rules a regular expression cannot express.
 *
 * The reason this exists is one specification MUST - "The due date value MUST
 * be representable by the gregorian calendar" - which the grammar cannot
 * check, because counting the days in February is not something regular
 * expressions do.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { problems } = require_('../out/diagnostics.js');
const { items } = require_('../out/tree.js');

/** Problems as "code@line" strings, which read far better than objects. */
const codes = (lines) => problems(lines).map((problem) => `${problem.code}@${problem.line}`);

describe('impossible dates', () => {
	it('reports a day the month does not have', () => {
		assert.deepEqual(codes(['[ ] Do this -> 2026-02-31']), ['impossible-date@0']);
		assert.deepEqual(codes(['[ ] Do this -> 2026-04-31']), ['impossible-date@0']);
		assert.deepEqual(codes(['[ ] Do this -> 2026-06-31']), ['impossible-date@0']);
	});

	it('knows about leap years', () => {
		assert.deepEqual(codes(['[ ] Do this -> 2024-02-29']), [], '2024 is a leap year');
		assert.deepEqual(codes(['[ ] Do this -> 2025-02-29']), ['impossible-date@0'], '2025 is not');
		assert.deepEqual(codes(['[ ] Do this -> 2000-02-29']), [], '2000 is divisible by 400');
		assert.deepEqual(codes(['[ ] Do this -> 2100-02-29']), ['impossible-date@0'], '2100 is not');
	});

	it('leaves real dates alone', () => {
		for (const date of ['2026-01-31', '2026-02-28', '2026-04-30', '2026-12-31']) {
			assert.deepEqual(codes([`[ ] Do this -> ${date}`]), [], date);
		}
	});

	it('says nothing about a month, quarter, week or year', () => {
		// Nothing to be impossible about: the grammar already rejects month 13
		// and quarter 5, which it can, because those are fixed ranges.
		for (const date of ['2026', '2026-01', '2026-Q4', '2026-W53']) {
			assert.deepEqual(codes([`[ ] Do this -> ${date}`]), [], date);
		}
	});

	it('reports the date, not the whole line', () => {
		const [problem] = problems(['[ ] Do this -> 2026-02-31']);
		assert.equal('[ ] Do this -> 2026-02-31'.slice(problem.start, problem.end), '-> 2026-02-31');
	});

	it('is an error, which nothing else here is', () => {
		assert.equal(problems(['[ ] Do this -> 2026-02-31'])[0].severity, 'error');
	});
});

describe('malformed checkboxes', () => {
	it('reports something clearly meant to be one', () => {
		assert.deepEqual(codes(['[] Nothing in it']), ['malformed-checkbox@0']);
		assert.deepEqual(codes(['[  ] Two spaces']), ['malformed-checkbox@0']);
		assert.deepEqual(codes(['[ x ] Padded']), ['malformed-checkbox@0']);
		assert.deepEqual(codes(['[X] Capital']), ['malformed-checkbox@0']);
	});

	it('says nothing about a valid one', () => {
		for (const status of [' ', 'x', '@', '~', '?']) {
			assert.deepEqual(codes([`[${status}] Fine`]), [], status);
		}
	});

	it('leaves brackets in a description alone', () => {
		// The syntax guide's own example. Reporting this would make the
		// feature worse than not having it.
		assert.deepEqual(codes(['[ ] A math formula: f[x]=x']), []);
		assert.deepEqual(codes(['[ ] [ ] Description text [ ]']), []);
	});

	it('does not call a bracketed word a near-miss checkbox', () => {
		// Two brackets round a word is not an attempt at a checkbox, so it
		// gets the general error rather than the specific one. It is still
		// reported: since titles are marked, "[Todos]" is not anything.
		assert.deepEqual(codes(['[Todos]']), ['unrecognised-line@0']);
	});
});

describe('extra due dates', () => {
	it('reports the second one on a line', () => {
		assert.deepEqual(codes(['[ ] Do this -> 2026-01-01 -> 2026-02-02']), ['extra-due-date@0']);
	});

	it('reports one on a continuation line, because the item already had one', () => {
		assert.deepEqual(codes(['[ ] Do this -> 2026-01-01', '    more -> 2026-02-02']), ['extra-due-date@1']);
	});

	it('says nothing about a subtask having its own', () => {
		// A subtask is a different item, so its date is its first.
		assert.deepEqual(codes(['[ ] Parent -> 2026-01-01', '\t[ ] Child -> 2026-02-02']), []);
	});

	it('is a warning, because silence is the problem', () => {
		// It was a hint, on the grounds that nothing is actually wrong. But
		// silent disregard is the worst property a plain-text format can have,
		// because nothing compiles it: you wrote a due date, the file kept it,
		// and nothing uses it. A hint is not visible enough to say that.
		assert.equal(problems(['[ ] x -> 2026-01-01 -> 2026-02-02'])[0].severity, 'warning');
	});
});

describe('unterminated comments', () => {
	it('reports one that runs to the end of the file', () => {
		assert.deepEqual(codes(['[ ] Before', '<!--', 'everything after is commented']), ['unterminated-comment@1']);
	});

	it('says nothing about a closed one', () => {
		assert.deepEqual(codes(['<!--', 'parked', '-->', '[ ] After']), []);
	});

	it('says nothing about one closed on the same line', () => {
		assert.deepEqual(codes(['<!-- on hold -->', '[ ] After']), []);
	});
});

describe('what is inside a comment', () => {
	it('is not reported at all', () => {
		// Parked work is not work. Reporting problems in it would make
		// commenting a block out noisier than leaving it in.
		const lines = ['<!--', '[ ] parked -> 2026-02-31', '[] malformed', '-->'];
		assert.deepEqual(codes(lines), []);
	});
});

describe('an indent that cannot nest', () => {
	it('reports one to three spaces', () => {
		// The realistic case: a file written when "two or more spaces, or one
		// tab" still nested. Nothing is lost, but the nesting is gone, and
		// silently losing structure is what this exists to prevent.
		for (const indent of [' ', '  ', '   ']) {
			assert.deepEqual(codes(['[ ] Parent', `${indent}[ ] Child`]), ['cannot-nest@1'], JSON.stringify(indent));
		}
	});

	it('reports a tab mixed with spaces', () => {
		assert.deepEqual(codes(['[ ] Parent', '\t  [ ] Child']), ['cannot-nest@1']);
		assert.deepEqual(codes(['[ ] Parent', '  \t[ ] Child']), ['cannot-nest@1']);
	});

	it('says nothing about a tab, which is how nesting is written', () => {
		assert.deepEqual(codes(['[ ] Parent', '\t[ ] Child', '\t\t[ ] Deeper']), []);
	});

	it('says nothing about four spaces, which is a description continuation', () => {
		// A continuation may begin with a bracket - the syntax guide has that
		// example, and this grammar agrees with it again now that four spaces
		// no longer nests. Reporting it would half-undo that.
		assert.deepEqual(codes(['[ ] Parent', '    [ ] not a subtask, just description']), []);
		assert.deepEqual(codes(['[ ] Parent', '        [ ] nor is this']), []);
	});

	it('says nothing about a line with no checkbox on it', () => {
		assert.deepEqual(codes(['[ ] Parent', '  just some indented prose']), []);
	});
});

describe('a tag value that is thrown away', () => {
	it('reports a quote that never closes', () => {
		// Spec §Tag, and the guide's tags/9: "If the closing quote is missing
		// (or doesn't match), the value is disregarded altogether." The tag
		// survives and the value vanishes, in silence.
		assert.deepEqual(codes(['[ ] Do this #note="unterminated']), ['dropped-tag-value@0']);
		assert.deepEqual(codes(["[ ] Do this #note='unterminated"]), ['dropped-tag-value@0']);
	});

	it('reports a quote closed by the wrong character', () => {
		assert.deepEqual(codes(['[ ] Do this #note="mismatched\'']), ['dropped-tag-value@0']);
	});

	it('says nothing about a value that closes properly', () => {
		assert.deepEqual(codes(['[ ] Do this #note="all fine" #other=\'also fine\'']), []);
	});

	it('says nothing about an unquoted value', () => {
		assert.deepEqual(codes(['[ ] Do this #note=plain', '[ ] And this #note=']), []);
	});
});

describe('exclamation marks that are not a priority', () => {
	it('reports marks with no space after them', () => {
		// The guide's priority/5: "If the space between priority and
		// description is missing, the exclamation mark is treated as part of
		// the description."
		assert.deepEqual(codes(['[ ] !This has regular priority']), ['not-a-priority@0']);
	});

	it('reports a second run right after the priority', () => {
		// The guide's priority/6: "Any exclamation marks after the priority
		// don't belong to the priority anymore."
		assert.deepEqual(codes(['[ ] ! !!! This is important']), ['not-a-priority@0']);
	});

	it('points at the marks that do nothing, not at the priority that works', () => {
		const [problem] = problems(['[ ] ! !!! This is important']);
		assert.equal(problem.start, 6, 'the second run starts at 6');
		assert.equal(problem.end, 9);
	});

	it('leaves prose alone', () => {
		// "finish this today!" is a sentence. A diagnostic that fires on prose
		// is a diagnostic people turn off, so only marks at the very start of
		// the description count.
		assert.deepEqual(codes(['[ ] ! Finish this today!']), []);
		assert.deepEqual(codes(['[ ] !! This ! is also important']), []);
		assert.deepEqual(codes(['[ ] Do it! Really!']), []);
	});

	it('says nothing about a well-formed priority', () => {
		assert.deepEqual(codes(['[ ] !!! Ship it']), []);
	});
});

describe('a line that is not anything', () => {
	it('reports what used to be silently promoted to a heading', () => {
		// The reason titles are marked. Each of these read as a title before,
		// so the task vanished from every list rather than looking wrong.
		for (const text of ['- [ ] Buy milk', '* [ ] Call Sam', 'My TODO list']) {
			assert.deepEqual(codes([text]), ['unrecognised-line@0'], text);
		}
	});

	it('says nothing about a marked title', () => {
		assert.deepEqual(codes(['# Todos', '[ ] One']), []);
	});

	it('prefers the specific message where there is one', () => {
		// A near-miss checkbox gets the checkbox message rather than the
		// general one. Two errors on one line would be noise, and the
		// specific one is the one that says what to do.
		assert.deepEqual(codes(['[ x] Typo']), ['malformed-checkbox@0']);
	});

	it('says nothing about an indented line, which is a continuation', () => {
		// Column zero only, matching the grammar's invalid rule. The two have
		// to agree about which lines are wrong, or the squiggles and the
		// colours contradict each other.
		assert.deepEqual(codes(['[ ] Item ...', '    ... and more']), []);
	});

	it('says nothing about a blank line or one inside a comment', () => {
		assert.deepEqual(codes(['[ ] One', '', '<!--', 'parked prose', '-->']), []);
	});
});

describe('a clean document', () => {
	it('has nothing to say about it', () => {
		const lines = ['# Todos', '[ ] One -> 2026-02-28', '\t[x] Two', '', '<!-- parked -->'];
		assert.deepEqual(problems(lines), []);
	});
});

describe('a paragraph break inside an item', () => {
	it('holds the item together with a visible marker', () => {
		// An item cannot contain a blank line and that limit stands: an
		// indent-only line is what the guide's groups/2 rejects, and every
		// trailing-whitespace stripper deletes it. A visible character on the
		// continuation needs no change to the format and survives saving.
		const lines = ['[ ] Write it ...', '    First paragraph.', '    .', '    Second paragraph.'];
		assert.deepEqual(codes(lines), []);
	});

	it('really does keep the item whole', () => {
		const lines = ['[ ] Write it ...', '    First.', '    .', '    Second.'];
		assert.equal(items(lines).get(0).endLine, 3);
	});
});

describe('a value one of our own tags cannot read', () => {
	it('reports an interval that means nothing', () => {
		// The flaw these reports exist to remove, built straight into the
		// features that were added after them: this item never repeats, and
		// nothing said so.
		assert.deepEqual(codes(['[ ] Water #repeat=sometimes']), ['unrecognised-value@0']);
		assert.deepEqual(codes(['[ ] Water #repeat=0d']), ['unrecognised-value@0']);
	});

	it('reports an estimate that means nothing', () => {
		// Worse than doing nothing: the item is counted as unestimated and
		// quietly widens the "+ 4" on its group.
		assert.deepEqual(codes(['[ ] Write #est=2hrs']), ['unrecognised-value@0']);
	});

	it('reports a stamped date that is not one', () => {
		assert.deepEqual(codes(['[x] Done #done=notadate']), ['unrecognised-value@0']);
		assert.deepEqual(codes(['[x] Done #done=2026-02-31']), ['unrecognised-value@0'], 'and one the calendar lacks');
	});

	it('says nothing about a value it understands', () => {
		for (const text of ['[ ] x #repeat=weekly', '[ ] x #repeat=+3d', '[ ] x #est=1.5h', '[x] x #done=2026-08-01']) {
			assert.deepEqual(codes([text]), [], text);
		}
	});

	it('says nothing about the tag with no value at all', () => {
		// Spec §Tag: an empty value and an absent one are the same thing, so
		// `#repeat` on its own is a plain tag, not a broken interval.
		assert.deepEqual(codes(['[ ] x #repeat', '[ ] x #est=']), []);
	});

	it('follows the configured tag name', () => {
		const renamed = { repeat: 'every', estimate: 'est', completion: 'done', creation: 'created' };
		assert.deepEqual(
			problems(['[ ] x #every=sometimes'], renamed).map((one) => one.code),
			['unrecognised-value'],
		);
		assert.deepEqual(
			problems(['[ ] x #repeat=sometimes'], renamed).map((one) => one.code),
			[],
			'the old name is just a tag now',
		);
	});

	it('points at the tag, not the line', () => {
		const [problem] = problems(['[ ] Water #repeat=sometimes']);
		assert.equal('[ ] Water #repeat=sometimes'.slice(problem.start, problem.end), '#repeat=sometimes');
	});
});

describe('the start date gets the same checks as the due date', () => {
	it('reports a day the calendar does not have', () => {
		// A start date is the same value behind a different arrow, and this
		// went unreported while `-> 2026-02-31` was caught.
		assert.deepEqual(codes(['[ ] x <- 2026-02-31']), ['impossible-date@0']);
	});

	it('reports a second one, which is disregarded just as a due date is', () => {
		assert.deepEqual(codes(['[ ] x <- 2026-01-01 <- 2026-02-02']), ['extra-start-date@0']);
	});

	it('does not confuse the two arrows', () => {
		assert.deepEqual(codes(['[ ] x <- 2026-01-01 -> 2026-02-02']), []);
	});

	it('reports one on a continuation line, because the item already had one', () => {
		assert.deepEqual(codes(['[ ] x <- 2026-01-01', '    more <- 2026-02-02']), ['extra-start-date@1']);
	});

	it('says nothing about a subtask having its own', () => {
		assert.deepEqual(codes(['[ ] Parent <- 2026-01-01', '\t[ ] Child <- 2026-02-02']), []);
	});
});

describe('a window the calendar cannot satisfy', () => {
	it('reports a start date after its own due date', () => {
		assert.deepEqual(codes(['[ ] Ship it <- 2030-01-01 -> 2026-01-01']), ['starts-after-due@0']);
	});

	it('points at the start date, not the due date', () => {
		// The due date is usually the one that is right; the start is the one
		// that was mistyped.
		const line = '[ ] Ship it <- 2030-01-01 -> 2026-01-01';
		const [problem] = problems([line]);
		assert.equal(line.slice(problem.start, problem.end), '<- 2030-01-01');
	});

	it('says nothing about a coherent window', () => {
		assert.deepEqual(codes(['[ ] Ship it <- 2026-01-01 -> 2026-06-01']), []);
	});

	it('compares whole periods, so the same month is fine', () => {
		// A start date reads from the first day of its period and a due date
		// from the last, so `<- 2026-06 -> 2026-06` is a whole month to work in.
		assert.deepEqual(codes(['[ ] Ship it <- 2026-06 -> 2026-06']), []);
		assert.deepEqual(codes(['[ ] Ship it <- 2026-07 -> 2026-06']), ['starts-after-due@0']);
	});

	it('says nothing when only one arrow is there', () => {
		assert.deepEqual(codes(['[ ] Only due -> 2026-01-01', '[ ] Only start <- 2026-01-01']), []);
	});
});
