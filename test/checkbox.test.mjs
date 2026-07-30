/**
 * Tests for the checkbox command logic in src/checkbox.ts.
 *
 * These run against the compiled output in dist/, so `npm test` builds first.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { readStatus, writeStatus, toggle, shuffle, STATUSES } = createRequire(import.meta.url)('../dist/checkbox.js');

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

	it('rejects an indented checkbox', () => {
		assert.equal(readStatus(' [x] Invalid'), null);
		assert.equal(readStatus('    [x] Invalid'), null);
	});
});

describe('writeStatus', () => {
	it('replaces the status and keeps the description', () => {
		assert.equal(writeStatus('[ ] Do this', 'x'), '[x] Do this');
		assert.equal(writeStatus('[@] Do this -> 2022-01-31', '~'), '[~] Do this -> 2022-01-31');
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
