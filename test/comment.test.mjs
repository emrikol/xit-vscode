/**
 * Where comments begin and end.
 *
 * This module exists because the outline and the folding disagreed about
 * `<!-- on hold -->`: one read it as a title heading a group, the other as a
 * comment. Two readers answering the same question two ways is exactly what it
 * was extracted to stop, so it is worth testing on its own rather than only
 * through the six things that call it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { commentLines, commentBlocks } = createRequire(import.meta.url)('../out/comment.js');
const lines = (...text) => [...commentLines(text)].sort((a, b) => a - b);

describe('finding a comment', () => {
	it('takes one opened and closed on the same line', () => {
		assert.deepEqual(lines('[ ] Before', '<!-- on hold -->', '[ ] After'), [1]);
	});

	it('takes a block, markers included', () => {
		assert.deepEqual(lines('[ ] Before', '<!--', 'parked', '-->', '[ ] After'), [1, 2, 3]);
	});

	it('runs to the end of the file when never closed', () => {
		// The fork's rule, and the reason an unterminated comment is worth a
		// warning: everything below it silently stops being work.
		assert.deepEqual(lines('[ ] Before', '<!--', 'and', 'everything', 'after'), [1, 2, 3, 4]);
	});

	it('needs the opener at the start of a line', () => {
		assert.deepEqual(lines('[ ] Not <!-- a comment -->'), []);
		assert.deepEqual(lines('  <!-- indented -->'), []);
	});

	it('closes only where `-->` is followed by blanks', () => {
		assert.deepEqual(lines('<!--', '--> and more text', 'still parked'), [0, 1, 2]);
		assert.deepEqual(lines('<!--', 'parked', '-->   ', '[ ] After'), [0, 1, 2]);
	});

	it('finds nothing in a document with no comment', () => {
		assert.deepEqual(lines('# Todos', '[ ] One', '[x] Two'), []);
	});
});

describe('comment blocks', () => {
	it('reports the span of each', () => {
		assert.deepEqual(
			commentBlocks(['[ ] A', '<!--', 'x', '-->', '[ ] B', '<!-- one line -->']),
			[{ start: 1, end: 3 }, { start: 5, end: 5 }],
		);
	});

	it('agrees with commentLines about which lines are parked', () => {
		// The two are one truth read two ways, and the six callers use both.
		const document = ['[ ] A', '<!--', 'x', '-->', '<!-- y -->', '[ ] B'];
		const fromBlocks = new Set();
		for (const { start, end } of commentBlocks(document)) {
			for (let at = start; at <= end; at++) fromBlocks.add(at);
		}
		assert.deepEqual([...fromBlocks].sort((a, b) => a - b), lines(...document));
	});
});
