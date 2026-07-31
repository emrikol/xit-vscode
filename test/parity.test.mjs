/**
 * Elements of the same kind must be handled the same way.
 *
 * Every seam found while building this fork was found by hand, one question at
 * a time: the outline lifted a due date and not a start date, a repeating item
 * kept its old start date, an impossible start date went unreported. All the
 * same shape - a new element added beside an old one, and only some readers
 * taught about it.
 *
 * That shape is detectable. For each pair of sibling elements, rewrite a
 * document from one into the other, project each reader's output down to
 * structure, and compare. A reader that answers differently is either missing
 * the newer sibling or treating it differently on purpose - and the second has
 * to be written down, which is what KNOWN below is for.
 *
 * ## Two designs that did not work, so nobody rebuilds them
 *
 * **Import scanning.** False negatives: `archive` reads statuses through
 * `tree`, so it looks blind and is not. Imports measure wiring, not behaviour.
 *
 * **A generic probe matrix** over all fourteen readers by eleven elements.
 * Almost every cell came back blind, and almost all of it was noise from weak
 * probes: `diagnostics` looked blind to everything because every probe
 * document was valid, and `align` looked blind to priority because only one
 * item in the pair carried one. Making it honest needs a hand-written probe
 * per cell, which is not a check, it is a second implementation.
 *
 * ## What this does not reach
 *
 * Elements with no sibling - nesting, titles, comments, directives, ids,
 * estimates - have nothing to be compared against. #93 was found by hand in
 * exactly that hole, after this check came back clean. A classified cell
 * matrix is the answer there, and it is not this file.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { collect, urgencyOf, isOpen } = require_('../out/collect.js');
const { outline } = require_('../out/outline.js');
const { folds } = require_('../out/folding.js');
const { sortGroup } = require_('../out/sort.js');
const { archive } = require_('../out/archive.js');
const { migrate } = require_('../out/migrate.js');
const { problems } = require_('../out/diagnostics.js');
const { alignments } = require_('../out/align.js');
const { blocked } = require_('../out/link.js');
const { nextOccurrence, postpone, parseInterval } = require_('../out/repeat.js');
const { dueDatesOn } = require_('../out/dueDate.js');

const THRESHOLDS = { today: 20260731, criticalAfterDays: 14, soonWithinDays: 7 };

/**
 * Asymmetries that are correct, with the reason.
 *
 * Same idea as the conformance allowlist: a difference that is deliberate has
 * to be written down, and one that stops happening has to be removed.
 */
const KNOWN = {
	'urgency | due/start':
		'the two arrows mean different things - a passed due date is overdue, an unreached start date is not yet actionable',
	'postpone | due/start':
		'postponing a deadline is not saying you may begin later, so only the due date moves (see #88)',
};

/** Every reader that turns a document into something structured. */
const READERS = {
	outline: (lines) => outline(lines).map((node) => [node.name, node.detail, node.kind]),
	folding: (lines) => folds(lines),
	sortOrder: (lines) => sortGroup(lines, 0).map((text) => (text.match(/\[.\]\s*!*\s*(\w+)/) ?? [])[1] ?? '-'),
	archive: (lines) => archive(lines, 'Archive').moved,
	migrate: (lines) => migrate(lines).changes.length,
	diagnostics: (lines) => problems(lines).map((problem) => problem.code),
	urgency: (lines) => collect(lines).map((item) => urgencyOf(item, THRESHOLDS)),
	outstanding: (lines) => collect(lines).map(isOpen),
	align: (lines) => alignments(lines),
	blocked: (lines) => [...blocked(lines)],
	repeat: (lines) => lines.map((text) => nextOccurrence(text, 'repeat', dueDatesOn(text)[0] ?? null, THRESHOLDS.today) ?? ''),
	postpone: (lines) => lines.map((text) => postpone(text, parseInterval('1w'), THRESHOLDS.today) ?? ''),
};

const OPEN = [' ', '@', '?', '>'];
const openPairs = OPEN.flatMap((a, index) => OPEN.slice(index + 1).map((b) => [a, b]));

/**
 * Sibling pairs.
 *
 * `norm` erases the sibling's own spelling from the output. Without it
 * `extra-due-date` against `extra-start-date` reads as a difference when the
 * behaviour is identical, and the check drowns in its own noise.
 */
const SIBLINGS = [
	{
		name: 'due/start',
		swap: (lines) => lines.map((text) => text.replaceAll('-> ', '<- ')),
		norm: (text) => text.replaceAll('-> ', 'A ').replaceAll('<- ', 'A ').replace(/due-date|start-date/g, 'X'),
		documents: [
			['[ ] Alpha -> 2026-09-30'],
			['[ ] Alpha -> 2026-02-31'],
			['[ ] Alpha -> 2026-01-01 -> 2026-02-02'],
			['[ ] Alpha -> 2026-01-01 #repeat=weekly'],
			['[ ] Alpha -> 2020-01-01', '[ ] Beta -> 2027-01-01'],
		],
	},
	{
		name: 'done/created',
		swap: (lines) => lines.map((text) => text.replaceAll('#done=', '#created=')),
		norm: (text) => text.replaceAll('#done=', '#T=').replaceAll('#created=', '#T='),
		documents: [['[x] Alpha #done=2026-01-01'], ['[x] Alpha #done=notadate']],
	},
	{
		name: 'checked/obsolete',
		swap: (lines) => lines.map((text) => text.replace(/^(\s*)\[x\]/, '$1[~]')),
		norm: (text) => text.replaceAll('[x]', '[F]').replaceAll('[~]', '[F]'),
		documents: [['[x] Alpha'], ['[x] Alpha', '[ ] Beta'], ['[x] Alpha -> 2020-01-01'], ['[ ] Parent', '\t[x] Alpha']],
	},
	...openPairs.map(([a, b]) => ({
		name: `open [${a}]/[${b}]`,
		swap: (lines) => lines.map((text) => text.replace(new RegExp(`^(\\s*)\\[\\${a}\\]`), `$1[${b}]`)),
		// Every open status is outstanding, so the urgency labels that only
		// differ by which flavour of outstanding it is are folded together.
		norm: (text) => text.replaceAll(`[${a}]`, '[O]').replaceAll(`[${b}]`, '[O]')
			.replace(/"waiting"|"none"|"later"|"critical"|"soon"|"notYet"|"blocked"/g, '"OUTSTANDING"'),
		documents: [
			[`[${a}] Alpha`],
			[`[${a}] Alpha -> 2020-01-01`],
			[`[ ] Parent`, `\t[${a}] Alpha`],
			[`[${a}] Alpha`, `[ ] Beta`],
		],
	})),
];

/** A reader's output, with date literals and the sibling's spelling erased. */
function shape(reader, lines, norm) {
	return norm(JSON.stringify(reader(lines)).replace(/\d{4}-\d{2}-\d{2}/g, 'D'));
}

describe('sibling elements are handled alike', () => {
	const asymmetries = new Map();
	let compared = 0;

	for (const { name, swap, norm, documents } of SIBLINGS) {
		for (const document of documents) {
			for (const [reader, project] of Object.entries(READERS)) {
				compared += 1;
				const before = shape(project, document, norm);
				const after = shape(project, swap(document), norm);
				if (before !== after && !asymmetries.has(`${reader} | ${name}`)) {
					asymmetries.set(`${reader} | ${name}`,
						`  ${JSON.stringify(document)}\n    one: ${before}\n    other: ${after}`);
				}
			}
		}
	}

	it('compares enough to be worth running', () => {
		assert.ok(compared > 300, `only ${compared} comparisons`);
	});

	it('has no asymmetry that is not written down', () => {
		const surprises = [...asymmetries].filter(([key]) => !(key in KNOWN));
		assert.deepEqual(surprises.map(([key]) => key), [],
			`a reader treats sibling elements differently, and nobody said why:\n\n${
				surprises.map(([key, detail]) => `${key}\n${detail}`).join('\n\n')}`);
	});

	it('has no stale entry, so a fixed gap cannot stay on the list', () => {
		for (const key of Object.keys(KNOWN)) {
			assert.ok(asymmetries.has(key), `${key} is no longer asymmetric; remove it from KNOWN`);
		}
	});
});
