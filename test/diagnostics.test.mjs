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

const { problems } = createRequire(import.meta.url)('../out/diagnostics.js');

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

	it('leaves a title starting with a bracket alone', () => {
		// "[Todos]" is not a title per spec §Title, and it is not an attempt
		// at a checkbox either. Two brackets round a word is not a near miss.
		assert.deepEqual(codes(['[Todos]']), []);
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

	it('is only a hint, because nothing is actually wrong', () => {
		assert.equal(problems(['[ ] x -> 2026-01-01 -> 2026-02-02'])[0].severity, 'hint');
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

describe('a clean document', () => {
	it('has nothing to say about it', () => {
		const lines = ['Todos', '[ ] One -> 2026-02-28', '\t[x] Two', '', '<!-- parked -->'];
		assert.deepEqual(problems(lines), []);
	});
});
