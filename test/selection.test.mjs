/**
 * Tests for the selection helpers in src/selection.ts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { selectedLines } = createRequire(import.meta.url)('../dist/selection.js');

/** Build the minimal shape the helper reads from a vscode.Selection. */
const sel = (start, end = start) => ({ start: { line: start }, end: { line: end } });

describe('selectedLines', () => {
	it('returns the single line of a collapsed cursor', () => {
		assert.deepEqual(selectedLines([sel(4)]), [4]);
	});

	it('expands a multi-line selection', () => {
		assert.deepEqual(selectedLines([sel(2, 5)]), [2, 3, 4, 5]);
	});

	it('merges several cursors', () => {
		assert.deepEqual(selectedLines([sel(7), sel(1), sel(4)]), [1, 4, 7]);
	});

	it('de-duplicates overlapping selections', () => {
		assert.deepEqual(selectedLines([sel(1, 3), sel(2, 4)]), [1, 2, 3, 4]);
	});

	it('sorts numerically, not lexicographically', () => {
		// Regression: a bare .sort() ordered these as 1, 10, 11, 2, 9.
		assert.deepEqual(selectedLines([sel(9), sel(10), sel(1), sel(11), sel(2)]), [1, 2, 9, 10, 11]);
	});

	it('sorts numerically across a wide selection', () => {
		assert.deepEqual(selectedLines([sel(8, 12)]), [8, 9, 10, 11, 12]);
	});

	it('handles an empty selection list', () => {
		assert.deepEqual(selectedLines([]), []);
	});
});
