/**
 * Archiving finished items.
 *
 * The specific reason a plain-text todo file rots: the completed work never
 * leaves, and the three things you have to do end up somewhere in the middle.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { archive } = createRequire(import.meta.url)('../out/archive.js');

const TITLE = 'Archive';
const run = (lines) => archive(lines, TITLE);

describe('what gets archived', () => {
	it('moves a checked item to a group at the end', () => {
		assert.deepEqual(run(['[ ] Open', '[x] Done']).lines,
			['[ ] Open', '', '# Archive', '[x] Done']);
	});

	it('moves an obsolete item too, for the opposite reason', () => {
		// Finished either way: one was done, the other never will be.
		assert.deepEqual(run(['[ ] Open', '[~] Abandoned']).lines,
			['[ ] Open', '', '# Archive', '[~] Abandoned']);
	});

	it('leaves everything still outstanding', () => {
		for (const status of [' ', '@', '?', '>']) {
			const lines = [`[${status}] Outstanding`];
			assert.deepEqual(run(lines).lines, lines, status);
		}
	});

	it('says how many items it moved', () => {
		assert.equal(run(['[x] One', '[x] Two', '[ ] Three']).moved, 2);
		assert.equal(run(['[ ] Nothing finished']).moved, 0);
	});
});

describe('what moves with an item', () => {
	it('takes its subtasks and continuations', () => {
		assert.deepEqual(
			run(['[x] Done ...', '    ... continued', '\t[x] Child', '[ ] Open']).lines,
			['[ ] Open', '', '# Archive', '[x] Done ...', '    ... continued', '\t[x] Child'],
		);
	});

	it('refuses a checked parent that still has an open subtask', () => {
		// Whatever the parent's own checkbox says, filing it away would hide
		// work. The auto-check exists to stop this state arising; this does
		// not trust that it always did.
		const lines = ['[x] Parent', '\t[ ] Still open'];
		assert.deepEqual(run(lines).lines, lines);
	});

	it('leaves a finished subtask of an unfinished parent where it is', () => {
		// It is part of work still in progress.
		const lines = ['[ ] Parent', '\t[x] Done child'];
		assert.deepEqual(run(lines).lines, lines);
	});
});

describe('running it more than once', () => {
	it('changes nothing the second time', () => {
		const once = run(['[ ] Open', '[x] Done']).lines;
		const twice = run(once);
		assert.deepEqual(twice.lines, once);
		assert.equal(twice.moved, 0);
	});

	it('adds to the archive that is already there, newest first', () => {
		const first = run(['[ ] Open', '[x] Older']).lines;
		const second = archive([...first.slice(0, 1), '[x] Newer', ...first.slice(1)], TITLE).lines;

		assert.deepEqual(second, ['[ ] Open', '', '# Archive', '[x] Newer', '[x] Older']);
	});

	it('does not archive what is already in the archive', () => {
		const lines = ['[ ] Open', '', '# Archive', '[x] Done'];
		assert.deepEqual(run(lines).lines, lines);
	});
});

describe('what it will not touch', () => {
	it('leaves anything inside a comment alone', () => {
		// Parked work was set aside deliberately.
		const lines = ['<!--', '[x] Parked and done', '-->'];
		assert.deepEqual(run(lines).lines, lines);
	});

	it('leaves titles and prose where they are', () => {
		assert.deepEqual(
			run(['# Todos', '[ ] Open', '[x] Done']).lines,
			['# Todos', '[ ] Open', '', '# Archive', '[x] Done'],
		);
	});
});

describe('never losing a line', () => {
	it('keeps every line it was given', () => {
		const lines = ['# Todos', '[ ] Open ...', '    ... more', '[x] Done ...', '    ... also more', '\t[x] Child'];
		const { lines: after } = run(lines);

		for (const text of lines) {
			assert.ok(after.includes(text), `lost ${JSON.stringify(text)}`);
		}
	});
});
