/**
 * The grammar, checked against the [x]it! syntax guide.
 *
 * test/fixtures/syntax-guide.json is the format author's own page, turned
 * into expected tokenisations by scripts/fetch-corpus.mjs. This runs our
 * grammar over it and compares.
 *
 * Two things decide whether this suite is worth anything:
 *
 *   1. The mapping below. The guide's class names are its renderer's, not
 *      ours. Map `due` to a scope we never emit and every due-date case
 *      reports the same failure; map it to something too broad and every case
 *      passes. It is one table, on purpose, so it can be read in one go.
 *
 *   2. Each aspect is tokenized as one document, not line by line. Blank
 *      lines separate groups, and a description continuation only means
 *      anything after the line it continues.
 *
 * Divergences are listed in KNOWN below, one entry per case with a reason.
 * jotaen, #63: "it's probably impossible to get all of the rules correct, due
 * to various limitations in the highlighting engines... a highlighter should
 * be considered to be a visual aid, rather than an authoritative
 * verification." An allowlist is the honest way to say that. Skipping the
 * cases quietly is not.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { tokenize } from './tokenizer.mjs';
import { corpusAspects } from './corpus.test.mjs';

/**
 * The guide's token classes, in our scope names.
 *
 * `indent` is deliberately absent. The guide draws indentation with a span so
 * that you can see the spaces on a web page; it is not a token, and we emit
 * no scope for it.
 */
const TOKEN_SCOPE = {
	checkbox: 'markup.other.task.checkbox',
	priority: 'markup.other.task.priority',
	due: 'markup.other.task.date',
	tag: 'markup.other.task.tag',
};

/** The guide's line statuses, for the checkbox scope they imply. */
const STATUS_SCOPE = {
	open: 'markup.other.task.checkbox.open',
	checked: 'markup.other.task.checkbox.checked',
	ongoing: 'markup.other.task.checkbox.ongoing',
	obsolete: 'markup.other.task.checkbox.obsolete',
	'in-question': 'markup.other.task.checkbox.in-question',
	headline: 'markup.other.task.title',
};

/**
 * Cases where we knowingly differ from the guide.
 *
 * Key is `<aspect>:<line>#<token>@<start>`, which the failure output prints
 * verbatim so an entry can be copied straight in. Every entry needs a reason,
 * and `npm test` fails if an entry stops diverging, so this cannot rot into a
 * list of things that were fixed years ago.
 */
const KNOWN = {
	// The guide and the specification disagree, and we follow the
	// specification. Spec §Item, on the checkbox, priority and description:
	//
	//   "MUST be separated by one space character (` `) from each other.
	//    (Additional space characters MAY appear.)"
	//
	// The guide says the opposite - "There cannot be additional spaces to the
	// left" - and marks the line invalid. jotaen's own Sublime syntax agrees
	// with the guide by accident of how it is written: it consumes ` ?` after
	// the checkbox, exactly one space, so the priority pattern then matches
	// the empty string. Three artefacts, two answers. The normative one wins.
	//
	// Worth raising on Discussion #63, which asks for exactly this: "If you'd
	// like something to be added (or corrected), please post it into this
	// issue here as comment."
	'priority/3:0#extra-priority@7': 'spec §Item allows additional spaces; the guide says it does not',
	'priority/3:1#extra-priority@7': 'spec §Item allows additional spaces; the guide says it does not',

	// The guide drops the checkbox highlighting from a line whose priority is
	// malformed, marking the whole line invalid. Nothing in the spec says a
	// bad priority invalidates the checkbox: `.!.` simply is not a priority,
	// so it is description text, and `[ ]` is still a checkbox. jotaen's
	// Sublime syntax agrees with us here rather than with his page - its
	// checkbox rule `^\[ \](?= |$)` matches, and the priority rule then does
	// not. The guide's HTML is hand-written, and this looks like emphasis for
	// the reader rather than a rule.
	//
	// Following it would also mean a line losing all its colour while you are
	// still typing the priority, which is the opposite of useful.
	'priority/4:0#extra-checkbox@0': 'a malformed priority does not invalidate the checkbox',
	'priority/4:1#extra-checkbox@0': 'a malformed priority does not invalidate the checkbox',
};

/** Character offsets on a line that carry `scope`. */
function offsetsWithScope(line, scope) {
	const covered = new Set();
	let at = 0;

	for (const token of line.tokens) {
		const length = token.text.length;
		if (token.scopes.some((name) => name.startsWith(scope))) {
			for (let i = at; i < at + length; i++) covered.add(i);
		}
		at += length;
	}

	return covered;
}

/** Compare one expected span against what the grammar produced. */
function verdict(line, scope, start, end) {
	const covered = offsetsWithScope(line, scope);
	let inside = 0;

	for (let i = start; i < end; i++) if (covered.has(i)) inside++;

	if (inside === 0) return 'missing';
	if (inside < end - start) return 'partial';

	// The scope must stop where the guide says it stops: a due date that
	// swallows the rest of the description is not a pass. Measured on the
	// contiguous run around this span, not on every offset carrying the scope
	// anywhere on the line - "[ ] This #text contains #tags" has two separate
	// runs, and neither is evidence about the other.
	let from = start;
	let to = end;
	while (covered.has(from - 1)) from--;
	while (covered.has(to)) to++;

	return from === start && to === end ? 'ok' : 'bleeds';
}

/** Run the whole corpus and return every divergence. */
async function survey() {
	const findings = [];

	for (const aspect of corpusAspects()) {
		const document = aspect.lines.map((line) => line.text).join('\n');
		const tokenized = await tokenize(document);

		for (const [index, expected] of aspect.lines.entries()) {
			const actual = tokenized[index];

			for (const span of expected.spans) {
				if (!(span.token in TOKEN_SCOPE)) continue;
				const result = verdict(actual, TOKEN_SCOPE[span.token], span.start, span.end);
				if (result !== 'ok') {
					findings.push({
						key: `${aspect.id}:${index}#${span.token}@${span.start}`,
						kind: result,
						text: expected.text,
						want: expected.text.slice(span.start, span.end),
						rule: aspect.rule,
					});
				}
			}

			// The other direction: everything we highlight, the guide must
			// have marked. Without this the suite is half blind - it would
			// never notice a grammar that highlights a due date the guide
			// says is not one, because there is no expected span to compare
			// against. Most of the guide's "not recognised" rules live here.
			for (const [token, scope] of Object.entries(TOKEN_SCOPE)) {
				const allowed = new Set();
				for (const span of expected.spans) {
					if (span.token !== token) continue;
					for (let i = span.start; i < span.end; i++) allowed.add(i);
				}

				const surplus = [...offsetsWithScope(actual, scope)].filter((i) => !allowed.has(i));
				if (surplus.length) {
					const from = Math.min(...surplus);
					findings.push({
						key: `${aspect.id}:${index}#extra-${token}@${from}`,
						kind: 'not-in-the-guide',
						text: expected.text,
						want: `no ${token} at ${JSON.stringify(expected.text.slice(from, Math.max(...surplus) + 1))}`,
						rule: aspect.rule,
					});
				}
			}

			// The checkbox status itself, not just that something is a checkbox.
			const checkbox = expected.spans.find((span) => span.token === 'checkbox');
			if (checkbox && expected.status in STATUS_SCOPE) {
				const scope = STATUS_SCOPE[expected.status];
				if (!offsetsWithScope(actual, scope).size) {
					findings.push({
						key: `${aspect.id}:${index}#status`,
						kind: 'wrong-status',
						text: expected.text,
						want: expected.status,
						rule: aspect.rule,
					});
				}
			}
		}
	}

	return findings;
}

const findings = await survey();

describe('conformance with the syntax guide', () => {
	it('has no divergence that is not written down', () => {
		const undocumented = findings.filter((finding) => !(finding.key in KNOWN));
		if (!undocumented.length) return;

		const report = undocumented.map((finding) =>
			`  ${finding.key}\n` +
			`    ${finding.kind}: expected ${JSON.stringify(finding.want)}\n` +
			`    line: ${JSON.stringify(finding.text)}\n` +
			`    rule: ${finding.rule}`,
		).join('\n\n');

		assert.fail(
			`${undocumented.length} divergence(s) from the syntax guide:\n\n${report}\n\n` +
			'Fix the grammar, or add the key to KNOWN in this file with a reason.',
		);
	});

	it('has no stale entry in the allowlist', () => {
		// An allowlist that outlives the problem it describes is worse than
		// none: it reads as a list of known limits while quietly hiding
		// nothing at all.
		const diverging = new Set(findings.map((finding) => finding.key));
		for (const key of Object.keys(KNOWN)) {
			assert.ok(diverging.has(key), `${key} no longer diverges; remove it from KNOWN`);
		}
	});

	it('actually checked the corpus', () => {
		// A mapping typo, or a corpus that failed to load, would leave this
		// suite passing with nothing compared.
		const aspects = corpusAspects();
		const spans = aspects.flatMap((aspect) => aspect.lines.flatMap((line) => line.spans))
			.filter((span) => span.token in TOKEN_SCOPE);
		assert.ok(aspects.length >= 46);
		assert.ok(spans.length > 150, `only ${spans.length} comparable tokens`);
	});
});
