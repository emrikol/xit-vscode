/**
 * Tests for the checkbox command logic in src/checkbox.ts.
 *
 * These run against the compiled output in out/, so `npm test` builds first.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const { readCheckbox, readStatus, writeStatus, toggle, shuffle, STATUSES, STATUS_CLASS } = createRequire(import.meta.url)('../out/checkbox.js');

const GRAMMAR = JSON.parse(readFileSync(new URL('../syntaxes/xit.tmLanguage.json', import.meta.url), 'utf8'));

describe('readStatus', () => {
	it('reads every valid status', () => {
		assert.equal(readStatus('[ ] Open'), ' ');
		assert.equal(readStatus('[x] Checked'), 'x');
		assert.equal(readStatus('[@] Ongoing'), '@');
		assert.equal(readStatus('[~] Obsolete'), '~');
		assert.equal(readStatus('[?] In question'), '?');
	});

	it('reads a checkbox with no description', () => {
		assert.equal(readStatus('[ ]'), ' ');
		assert.equal(readStatus('[x] '), 'x');
	});

	it('rejects checkboxes that are not exactly three characters', () => {
		// Regression: the old pattern /^\[([^\]])*\]/ accepted these and then
		// handed an undefined status to the replacer.
		for (const line of ['[] Invalid', '[  ] Invalid', '[ x ] Invalid', '[@@] Invalid']) {
			assert.equal(readStatus(line), null, line);
		}
	});

	it('rejects unknown status characters', () => {
		for (const line of ['[*] Invalid', '[o] Invalid', '[X] Invalid']) {
			assert.equal(readStatus(line), null, line);
		}
	});

	it('requires a space or the end of the line after the checkbox', () => {
		assert.equal(readStatus('[ ]Invalid'), null);
		assert.equal(readStatus('[x]Invalid'), null);
	});

	it('accepts an indented checkbox, which the grammar may not', () => {
		// Subtasks, this fork's addition (discussion #2). Deliberately more
		// permissive than the grammar, which wants two spaces or a tab and an
		// item above to nest under: highlighting describes the format and has
		// to be strict, a command does not. Toggling a checkbox the grammar
		// declined to colour is harmless; refusing to would be baffling.
		assert.equal(readStatus('  [x] A subtask'), 'x');
		assert.equal(readStatus('\t[@] A subtask'), '@');
		assert.equal(readStatus(' [x] Not nested enough to be coloured'), 'x');
	});

	it('reports the column the checkbox sits at', () => {
		// editSelectedCheckboxes replaces a three-character range, and it has
		// to move with the indentation or a subtask loses its indent.
		assert.deepEqual(readCheckbox('[ ] Top level'), { column: 0, status: ' ' });
		assert.deepEqual(readCheckbox('    [x] Indented'), { column: 4, status: 'x' });
		assert.deepEqual(readCheckbox('\t[~] Tabbed'), { column: 1, status: '~' });
		assert.equal(readCheckbox('Not an item'), null);
	});
});

describe('writeStatus', () => {
	it('replaces the status and keeps the description', () => {
		assert.equal(writeStatus('[ ] Do this', 'x'), '[x] Do this');
		assert.equal(writeStatus('[@] Do this -> 2022-01-31', '~'), '[~] Do this -> 2022-01-31');
	});

	it('keeps the indentation that makes a subtask one', () => {
		assert.equal(writeStatus('    [ ] A subtask', 'x'), '    [x] A subtask');
		assert.equal(writeStatus('\t\t[ ] Deeper', '@'), '\t\t[@] Deeper');
	});

	it('keeps a bare checkbox bare', () => {
		assert.equal(writeStatus('[ ]', '@'), '[@]');
	});

	it('leaves lines without a checkbox alone', () => {
		assert.equal(writeStatus('Just a title', 'x'), 'Just a title');
		assert.equal(writeStatus('[] Invalid', 'x'), '[] Invalid');
	});
});

describe('toggle', () => {
	it('checks open and in-question items', () => {
		assert.equal(toggle(' '), 'x');
		assert.equal(toggle('?'), 'x');
	});

	it('opens every other status', () => {
		assert.equal(toggle('x'), ' ');
		assert.equal(toggle('@'), ' ');
		assert.equal(toggle('~'), ' ');
	});
});

describe('shuffle', () => {
	it('steps through the full cycle and returns to the start', () => {
		let status = ' ';
		const seen = [status];
		for (let i = 0; i < STATUSES.length; i++) {
			status = shuffle(status);
			seen.push(status);
		}
		assert.deepEqual(seen, [' ', '@', '~', '?', 'x', ' ']);
	});

	it('reaches every status', () => {
		const reached = new Set();
		let status = ' ';
		for (let i = 0; i < STATUSES.length; i++) {
			status = shuffle(status);
			reached.add(status);
		}
		assert.deepEqual([...reached].sort(), [...STATUSES].sort());
	});
});

describe('the grammar and STATUSES agree', () => {
	// The drift detector. The TypeScript now builds every status pattern from
	// STATUSES, but the grammar is static JSON and cannot import it, so seven
	// copies of the set live there as literals. This is what stops them
	// parting company. Same house pattern as the due-date and tag detectors:
	// the duplication cannot be removed, so it is detected instead.
	//
	// It reads begin/end/match only. The `comment` fields are prose and
	// discuss the syntax, so scanning them would match documentation.
	//
	// Gathered per repository rule rather than over the whole file, because
	// the union across every rule hides the likeliest mistake: giving a new
	// status a scope in open-item and forgetting open-subitem, which leaves
	// it unhighlighted at every depth but the first while the totals still
	// add up.
	function patternsOf(node, into = []) {
		if (!node || typeof node !== 'object') return into;
		for (const [key, value] of Object.entries(node)) {
			if (typeof value === 'string') {
				if (key === 'begin' || key === 'end' || key === 'match') into.push(value);
			} else patternsOf(value, into);
		}
		return into;
	}

	// `\[[ x@~?]\]` — a checkbox matching any status.
	const CLASS = /\\\[\[([^\]]*)\]\\\]/g;
	// `\[x\]` — a checkbox matching exactly one, which is how the grammar
	// splits open from closed to give each its own scope.
	const SINGLE = /\\\[(\\?.)\\\]/g;

	const classes = [];
	const singlesByRule = new Map();

	for (const [name, rule] of Object.entries(GRAMMAR.repository)) {
		const singles = new Set();
		for (const pattern of patternsOf(rule)) {
			for (const [, body] of pattern.matchAll(CLASS)) classes.push({ name, body });
			// Character classes first, so their brackets cannot be read as a
			// single-status checkbox.
			for (const [, char] of pattern.replace(CLASS, '').matchAll(SINGLE)) {
				singles.add(char.startsWith('\\') ? char.slice(1) : char);
			}
		}
		if (singles.size > 0) singlesByRule.set(name, [...singles].sort().join(''));
	}

	it('spells the same set in every character class', () => {
		assert.ok(classes.length >= 7, `only ${classes.length} status classes found in the grammar`);

		const expected = [...STATUSES].sort().join('');
		for (const { name, body } of classes) {
			// Unescaped for comparison: the grammar may escape a character
			// this does not, and vice versa. The set is what must match.
			const found = [...body.replace(/\\(.)/g, '$1')].sort().join('');
			assert.equal(found, expected,
				`${name} has a checkbox class of [${body}]; STATUSES is [${STATUS_CLASS}]`);
		}
	});

	it('gives every status a scope of its own', () => {
		// Catches the other half of the failure: a status added to the classes
		// but never given a begin alternative highlights as nothing.
		const everywhere = [...new Set([...singlesByRule.values()].join(''))].sort();
		assert.deepEqual(everywhere, [...STATUSES].sort());
	});

	it('scopes the same statuses at the top level and nested', () => {
		// A subtask is an item. Any status one can hold, the other must.
		assert.equal(singlesByRule.get('open-item'), singlesByRule.get('open-subitem'));
		assert.equal(singlesByRule.get('closed-item'), singlesByRule.get('closed-subitem'));
	});

	it('puts each status on exactly one side of the open/closed split', () => {
		const open = new Set(singlesByRule.get('open-item'));
		const closed = new Set(singlesByRule.get('closed-item'));
		const both = [...open].filter((status) => closed.has(status));
		assert.deepEqual(both, [], 'a status cannot be both open and closed');
		assert.equal(open.size + closed.size, STATUSES.length);
	});
});
