/**
 * Item identity, and one item waiting on another.
 *
 * The only thing the format genuinely could not express. Tags rather than new
 * syntax, and generated ids rather than anything positional - sorting a group
 * and archiving both rewrite lines, and either would break a reference derived
 * from where a line happens to sit.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { identities, dependencies, linkProblems, blocked, freshId, foldId, parseReference } = require_('../out/link.js');
const { collect, urgencyOf } = require_('../out/collect.js');

const THRESHOLDS = { today: 20260731, criticalAfterDays: 14, soonWithinDays: 7 };
const kinds = (lines) => linkProblems(lines).map((problem) => `${problem.kind}@${problem.line}`);

describe('reading identity', () => {
	it('finds an item that names itself', () => {
		assert.deepEqual(
			identities(['[ ] Draft #id=k3f9']).map((each) => [each.line, each.id]),
			[[0, 'k3f9']],
		);
	});

	it('finds an item that waits on another', () => {
		assert.deepEqual(
			dependencies(['[ ] Send #after=k3f9']).map((each) => [each.line, each.on]),
			[[0, { file: null, id: 'k3f9' }]],
		);
	});

	it('ignores anything inside a comment', () => {
		assert.deepEqual(identities(['<!--', '[ ] Parked #id=k3f9', '-->']), []);
	});

	it('ignores a tag on a line that is not an item', () => {
		assert.deepEqual(identities(['# A title #id=k3f9']), []);
	});

	it('matches ids case-insensitively', () => {
		assert.deepEqual([...blocked(['[ ] A #id=K3F9', '[ ] B #after=k3f9'])], [1]);
	});
});

describe('generating an id', () => {
	it('avoids one already in the document', () => {
		const taken = ['[ ] A #id=bbbb'];
		let calls = 0;
		// First four draws spell "bbbb", the next four spell "cccc".
		const random = () => (calls++ < 4 ? 0 : 1 / 28);
		assert.equal(freshId(taken, random), 'cccc');
	});

	it('uses no vowels, so it cannot spell anything', () => {
		const id = freshId([]);
		assert.equal(id.length, 4);
		assert.ok(!/[aeiou]/.test(id), id);
	});

	it('avoids the characters that look alike', () => {
		// 0/O and 1/l, so an id can be read aloud and typed back.
		for (let attempt = 0; attempt < 200; attempt++) {
			assert.ok(!/[01lo]/i.test(freshId([])), 'ambiguous character in a generated id');
		}
	});
});

describe('what is wrong with a link', () => {
	it('reports a reference to an id nothing has', () => {
		assert.deepEqual(kinds(['[ ] A #id=aaaa', '[ ] B #after=zzzz']), ['unknown-id@1']);
	});

	it('reports an id used twice, on both of them', () => {
		// With a duplicate there is no original, and pointing at one would
		// imply the other is fine.
		assert.deepEqual(kinds(['[ ] A #id=aaaa', '[ ] B #id=aaaa']), ['duplicate-id@0', 'duplicate-id@1']);
	});

	it('reports a cycle, on every item in it', () => {
		assert.deepEqual(kinds(['[ ] A #id=aaaa #after=bbbb', '[ ] B #id=bbbb #after=aaaa']), ['cycle@0', 'cycle@1']);
	});

	it('reports a longer cycle too', () => {
		assert.deepEqual(
			kinds(['[ ] A #id=aaaa #after=cccc', '[ ] B #id=bbbb #after=aaaa', '[ ] C #id=cccc #after=bbbb']),
			['cycle@0', 'cycle@1', 'cycle@2'],
		);
	});

	it('reports waiting on something already finished', () => {
		assert.deepEqual(kinds(['[x] A #id=aaaa', '[ ] B #after=aaaa']), ['already-finished@1']);
	});

	it('says nothing about a link that is fine', () => {
		assert.deepEqual(kinds(['[ ] A #id=aaaa', '[ ] B #after=aaaa']), []);
	});
});

describe('being blocked', () => {
	it('blocks an item waiting on something outstanding', () => {
		assert.deepEqual([...blocked(['[ ] A #id=aaaa', '[ ] B #after=aaaa'])], [1]);
	});

	it('unblocks it once that item is finished', () => {
		assert.deepEqual([...blocked(['[x] A #id=aaaa', '[ ] B #after=aaaa'])], []);
		assert.deepEqual([...blocked(['[~] A #id=aaaa', '[ ] B #after=aaaa'])], []);
	});

	it('does not block on an id that does not exist', () => {
		// It is reported as a problem instead. Blocking would hide the item
		// behind a typo.
		assert.deepEqual([...blocked(['[ ] B #after=zzzz'])], []);
	});

	it('sorts a blocked item into its own group, not by its due date', () => {
		// The same answer as waiting and not-yet-started: work you cannot act
		// on, below everything you can, and never hidden.
		const [, item] = collect(['[ ] A #id=aaaa', '[ ] B #after=aaaa -> 2020-01-01']);
		assert.equal(item.blocked, true);
		assert.equal(urgencyOf(item, THRESHOLDS), 'blocked');
	});

	it('lets it through once it is unblocked', () => {
		const [, item] = collect(['[x] A #id=aaaa', '[ ] B #after=aaaa -> 2020-01-01']);
		assert.equal(item.blocked, false);
		assert.equal(urgencyOf(item, THRESHOLDS), 'critical');
	});
});

describe('referring across files', () => {
	// The file first, then the id. Quoted, because `.` and `#` are not legal
	// in an unquoted tag value and a quoted one takes anything - so this needs
	// no new syntax at all.
	it('splits a file from an id', () => {
		assert.deepEqual(parseReference('work-todo.xit#k3f9'), { file: 'work-todo.xit', id: 'k3f9' });
	});

	it('reads a bare id as this file', () => {
		assert.deepEqual(parseReference('k3f9'), { file: null, id: 'k3f9' });
	});

	it('splits at the last hash, so a filename may hold one', () => {
		assert.deepEqual(parseReference('odd#name.xit#k3f9'), { file: 'odd#name.xit', id: 'k3f9' });
	});

	it('reads one off a quoted tag value', () => {
		const [each] = dependencies(['[ ] Send #after="work-todo.xit#k3f9"']);
		assert.deepEqual(each.on, { file: 'work-todo.xit', id: 'k3f9' });
	});

	it('does not block on a cross-file reference, which only the index can judge', () => {
		// A pure function over one document does not know what other files
		// exist. WorkspaceIndex follows these and sets blocked again.
		assert.deepEqual([...blocked(['[ ] Send #after="other.xit#k3f9"'])], []);
	});

	it('does not report one as an unknown id either, for the same reason', () => {
		assert.deepEqual(kinds(['[ ] Send #after="other.xit#k3f9"']), []);
	});

	it('still reports a bare id that nothing here has', () => {
		assert.deepEqual(kinds(['[ ] Send #after=zzzz']), ['unknown-id@0']);
	});
});

describe('folding an id', () => {
	it('is case-insensitive', () => {
		assert.equal(foldId('K3F9'), foldId('k3f9'));
	});
});
