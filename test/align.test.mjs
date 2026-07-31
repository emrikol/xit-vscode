/**
 * Lining priorities up in a column without putting spaces in the file.
 *
 * The specification pads with dots; this fork drew the column instead, because
 * alignment is a rendering job and dots in the document are not.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { alignments } = createRequire(import.meta.url)('../out/align.js');

/** The document as it would render, which is far easier to read than offsets. */
function drawn(lines) {
	const pads = alignments(lines);
	return lines.map((text, line) => {
		const pad = pads.find((each) => each.line === line);
		return pad ? text.slice(0, pad.column) + '·'.repeat(pad.pad) + text.slice(pad.column) : text;
	});
}

describe('aligning a group', () => {
	it('right-aligns the marks to the widest in the group', () => {
		assert.deepEqual(
			drawn(['[ ] ! Low', '[ ] !!! Urgent', '[ ] !! Middle']),
			['[ ] ··! Low', '[ ] !!! Urgent', '[ ] ·!! Middle'],
		);
	});

	it('leaves the widest item alone', () => {
		assert.deepEqual(alignments(['[ ] !!! A', '[ ] ! B']).map((each) => each.line), [1]);
	});

	it('leaves an item with no priority alone', () => {
		// Padding a line with nothing to align would indent the description of
		// every ordinary item, which is a lot of movement for a few marks.
		assert.deepEqual(
			drawn(['[ ] !!! Urgent', '[ ] Ordinary', '[ ] ! Low']),
			['[ ] !!! Urgent', '[ ] Ordinary', '[ ] ··! Low'],
		);
	});

	it('aligns each group on its own', () => {
		// Aligning across the file would let one urgent item indent everything
		// below it.
		assert.deepEqual(
			drawn(['[ ] !!! A', '[ ] ! B', '', '[ ] ! C']),
			['[ ] !!! A', '[ ] ··! B', '', '[ ] ! C'],
		);
	});

	it('counts from where the priority starts, not from the checkbox', () => {
		// Spec §Item allows additional spaces before a priority.
		const [pad] = alignments(['[ ] !!! A', '[ ]    ! B']);
		assert.equal(pad.column, 7, 'after the three spaces');
	});

	it('follows a subtask indent', () => {
		const [pad] = alignments(['[ ] Parent', '\t[ ] !!! A', '\t[ ] ! B']);
		assert.equal(pad.line, 2);
		assert.equal(pad.column, 5, 'a tab, a checkbox, a space');
	});

	it('leaves a comment alone', () => {
		assert.deepEqual(alignments(['<!--', '[ ] !!! A', '[ ] ! B', '-->']), []);
	});

	it('has nothing to say about a document with no priorities', () => {
		assert.deepEqual(alignments(['[ ] A', '[ ] B']), []);
	});
});
