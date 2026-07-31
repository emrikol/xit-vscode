/**
 * What the commands that move text must never do.
 *
 * Sort, archive, migrate, postpone and repeat all rewrite lines, and they are
 * the only things here that can lose your work rather than mis-colour it.
 * Each has hand-written tests; none had a property held over a generated
 * corpus, which is what this is.
 *
 * The documents below are built from every combination of status, dates, tags,
 * nesting, comments and ids that fits on a line, so the properties are checked
 * against a hundred-odd shapes rather than the dozen anyone thinks to write.
 *
 * Each property was confirmed to fail by breaking the code on purpose. One of
 * those attempts is worth recording: removing sort's carry of loose lines did
 * *not* fail here, because its own line-count guard caught the loss and
 * returned the document untouched. Only removing both showed it. That is
 * defence in depth working, and it means a green run here does not prove the
 * guard is unnecessary - it proves the two together are enough.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { sortGroup } = require_('../out/sort.js');
const { archive } = require_('../out/archive.js');
const { migrate } = require_('../out/migrate.js');
const { identities, dependencies, foldId } = require_('../out/link.js');
const { items } = require_('../out/tree.js');
const { commentLines } = require_('../out/comment.js');

const THRESHOLDS = { today: 20260731, criticalAfterDays: 14, soonWithinDays: 7 };

/** Every document the properties are checked against. */
function* documents() {
	const heads = [[], ['# Todos'], ['<!-- xit: tags=work -->']];
	const bodies = [
		['[ ] Plain'],
		['[x] Done', '[ ] Open'],
		['[ ] !!! Urgent -> 2020-01-01', '[ ] Low -> 2027-01-01'],
		['[ ] A <- 2030-01-01 -> 2026-01-01', '[ ] B -> 2026-02-01'],
		['[>] Waiting', '[ ] Plain', '[~] Abandoned'],
		['[ ] Parent', '\t[x] Child', '\t[ ] Other child'],
		['[x] Parent', '\t[x] Child'],
		['[ ] Item ...', '    ... continued', '\t[ ] Subtask'],
		['[ ] Blocker #id=aaaa', '[ ] Held #after=aaaa'],
		['[x] Done #id=bbbb', '[ ] Waits #after=bbbb'],
		['[ ] With #est=2h #done=2026-01-01', '[ ] Without'],
		['[ ] Low', '<!-- a note -->', '[ ] !!! Urgent'],
		['[ ] Low', '<!--', '[ ] Parked', '-->', '[ ] !!! Urgent'],
		['Unmarked title', '[ ] ..! Old priority', '  [ ] Old nesting'],
	];
	const tails = [[], [''], ['', '# Later', '[ ] Another']];

	for (const head of heads) {
		for (const body of bodies) {
			for (const tail of tails) yield [...head, ...body, ...tail];
		}
	}
}

/** The commands, each reduced to lines in, lines out. */
const COMMANDS = {
	sort: (lines) => sortGroup(lines, lines.findIndex((text) => /^\s*\[/.test(text)) ?? 0, THRESHOLDS),
	archive: (lines) => archive(lines, 'Archive').lines,
	migrate: (lines) => migrate(lines).lines,
};

/** Non-blank lines, ignoring order, so a reordering is not read as a loss. */
const contents = (lines) => [...lines].filter((text) => text.trim() !== '').sort();

describe('the commands that move text', () => {
	const all = [...documents()];

	it('is checked against enough shapes to be worth something', () => {
		assert.ok(all.length >= 100, `only ${all.length} documents`);
	});

	it('never loses a line', () => {
		// The one failure that would be unforgivable. Every line that went in
		// must come out, however it was reordered.
		//
		// Archive may add one - the title it files things under - so this is a
		// subset rather than an equality, and the next test is what stops that
		// being a licence to invent anything.
		const lost = [];
		for (const document of all) {
			for (const [name, run] of Object.entries(COMMANDS)) {
				if (name === 'migrate') continue; // migration rewrites lines on purpose
				const after = contents(run(document));
				for (const text of contents(document)) {
					const at = after.indexOf(text);
					if (at === -1) lost.push(`  ${name} lost ${JSON.stringify(text)}: ${JSON.stringify(document)}`);
					else after.splice(at, 1);
				}
			}
		}
		assert.deepEqual(lost, [], `a command lost a line:\n${lost.join('\n')}`);
	});

	it('invents nothing beyond the archive title', () => {
		const invented = [];
		for (const document of all) {
			for (const [name, run] of Object.entries(COMMANDS)) {
				if (name === 'migrate') continue;
				const before = contents(document);
				for (const text of contents(run(document))) {
					const at = before.indexOf(text);
					if (at === -1) {
						if (name === 'archive' && text === '# Archive') continue;
						invented.push(`  ${name} invented ${JSON.stringify(text)}: ${JSON.stringify(document)}`);
					} else before.splice(at, 1);
				}
			}
		}
		assert.deepEqual(invented, [], `a command invented a line:\n${invented.join('\n')}`);
	});

	it('never loses a line to migration either, only rewrites them', () => {
		const lost = [];
		for (const document of all) {
			const after = migrate(document).lines;
			if (after.length !== document.length) {
				lost.push(`  ${JSON.stringify(document)}\n    -> ${JSON.stringify(after)}`);
			}
		}
		assert.deepEqual(lost, [], `migration changed the line count:\n${lost.join('\n')}`);
	});

	it('does nothing the second time', () => {
		const unstable = [];
		for (const document of all) {
			for (const [name, run] of Object.entries(COMMANDS)) {
				const once = run(document);
				const twice = run(once);
				if (JSON.stringify(once) !== JSON.stringify(twice)) {
					unstable.push(
						`  ${name}: ${JSON.stringify(document)}\n    once:  ${JSON.stringify(once)}\n    twice: ${JSON.stringify(twice)}`,
					);
				}
			}
		}
		assert.deepEqual(unstable, [], `a command is not idempotent:\n${unstable.join('\n')}`);
	});

	it('keeps every reference resolving', () => {
		// Ids are generated rather than positional precisely so a re-sort and
		// an archive cannot break them. Nothing proved it until now.
		const broken = [];
		for (const document of all) {
			const before = new Set(identities(document).map((each) => foldId(each.id)));
			if (before.size === 0) continue;

			for (const [name, run] of Object.entries(COMMANDS)) {
				const after = run(document);
				const ids = new Set(identities(after).map((each) => foldId(each.id)));
				const wanted = dependencies(after)
					.filter((each) => each.on.file === null)
					.map((each) => foldId(each.on.id));

				for (const id of before) {
					if (!ids.has(id)) broken.push(`  ${name} lost the id ${id}: ${JSON.stringify(document)}`);
				}
				for (const id of wanted) {
					if (!ids.has(id)) broken.push(`  ${name} left #after=${id} dangling: ${JSON.stringify(document)}`);
				}
			}
		}
		assert.deepEqual(broken, [], `a command broke a reference:\n${broken.join('\n')}`);
	});

	it('leaves parked work byte-identical', () => {
		const touched = [];
		for (const document of all) {
			const parked = [...commentLines(document)].map((at) => document[at]);
			if (parked.length === 0) continue;

			for (const [name, run] of Object.entries(COMMANDS)) {
				const after = run(document);
				for (const text of parked) {
					if (!after.includes(text))
						touched.push(`  ${name} altered a parked line ${JSON.stringify(text)}: ${JSON.stringify(document)}`);
				}
			}
		}
		assert.deepEqual(touched, [], `a command rewrote parked work:\n${touched.join('\n')}`);
	});

	it('keeps a subtask under the same parent', () => {
		const reparented = [];
		for (const document of all) {
			const before = items(document);
			const nested = [...before.values()].filter((item) => item.parent !== null);
			if (nested.length === 0) continue;

			for (const [name, run] of Object.entries(COMMANDS)) {
				if (name === 'migrate') continue; // migration changes indentation on purpose
				const after = items(run(document));
				const pairs = (tree) =>
					[...tree.values()]
						.filter((item) => item.parent !== null)
						.map((item) => `${tree.get(item.line).indent}|${tree.get(item.parent).indent}`)
						.sort();

				if (JSON.stringify(pairs(after)) !== JSON.stringify(pairs(before))) {
					reparented.push(`  ${name}: ${JSON.stringify(document)}\n    -> ${JSON.stringify(run(document))}`);
				}
			}
		}
		assert.deepEqual(reparented, [], `a command changed the nesting:\n${reparented.join('\n')}`);
	});
});
