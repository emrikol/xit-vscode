/**
 * Tests for the conformance corpus itself.
 *
 * The corpus is generated from the [x]it! syntax guide by
 * scripts/fetch-corpus.mjs, and committed. That script checks its own output,
 * but it runs perhaps twice a year. Every other test run reads the committed
 * file and trusts it, so what the file claims is worth holding to a contract
 * here too.
 *
 * The whitespace cases are the point of most of this. The guide deliberately
 * uses a non-breaking space where a checkbox needs a real one, four
 * non-breaking spaces where an indent needs real ones, and a literal tab. They
 * are the examples most worth testing and the ones an extractor most easily
 * destroys, and once destroyed they turn into cases that pass for the wrong
 * reason: `[ ]` normalised to `[ ]` is no longer an invalid checkbox, it
 * is a valid one.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT } from './tokenizer.mjs';

export const CORPUS = JSON.parse(
	readFileSync(resolve(REPO_ROOT, 'test/fixtures/syntax-guide.json'), 'utf8'),
);

/** Every example line, with the aspect it came from. */
export function corpusLines() {
	return CORPUS.sections.flatMap((section) =>
		section.aspects.flatMap((aspect) =>
			aspect.lines.map((line, index) => ({ ...line, section: section.heading, rule: aspect.rule, id: `${aspect.id}:${index}` })),
		),
	);
}

/** Each aspect as one document, because blank lines separate groups. */
export function corpusAspects() {
	return CORPUS.sections.flatMap((section) =>
		section.aspects.map((aspect) => ({ ...aspect, section: section.heading })),
	);
}

const STATUSES = new Set(['open', 'checked', 'ongoing', 'obsolete', 'in-question', 'invalid', 'headline']);
const TOKENS = new Set(['checkbox', 'priority', 'due', 'tag', 'indent']);

describe('conformance corpus', () => {
	it('names its source', () => {
		assert.equal(CORPUS.source, 'https://xit.jotaen.net/syntax-guide');
		assert.match(CORPUS.retrieved, /^\d{4}-\d{2}-\d{2}$/);
	});

	it('covers every section of the guide', () => {
		assert.deepEqual(
			CORPUS.sections.map((section) => section.heading),
			['Status', 'Description', 'Priority', 'Due Date', 'Tags', 'Groups', 'Encoding'],
		);
	});

	it('is big enough to be the whole guide', () => {
		// 46 listings on the page when this was written. A corpus that shrank
		// means the extractor stopped recognising something.
		assert.equal(corpusAspects().length, 46);
		assert.ok(corpusLines().length > 150);
	});

	it('gives every aspect the guide\'s own words', () => {
		// The rule text is what makes an allowlist entry readable. Without it
		// a known divergence is a line of xit and no reason.
		for (const aspect of corpusAspects()) {
			assert.ok(aspect.rule.length > 10, `${aspect.id} has no rule text`);
		}
	});

	it('uses only the statuses and tokens the guide defines', () => {
		for (const line of corpusLines()) {
			if (line.status !== null) assert.ok(STATUSES.has(line.status), `${line.id}: unknown status ${line.status}`);
			for (const span of line.spans) assert.ok(TOKENS.has(span.token), `${line.id}: unknown token ${span.token}`);
		}
	});

	it('has token offsets that land inside their line', () => {
		for (const line of corpusLines()) {
			for (const span of line.spans) {
				assert.ok(span.start >= 0 && span.end <= line.text.length && span.start < span.end,
					`${line.id}: ${span.token} [${span.start}:${span.end}] does not fit ${JSON.stringify(line.text)}`);
			}
		}
	});

	it('keeps the non-breaking spaces the guide uses on purpose', () => {
		const nbsp = corpusLines().filter((line) => line.text.includes(' '));
		assert.deepEqual(nbsp.map((line) => line.text), [
			'[ ] Invalid (non-breaking space)',
			'    invalid (4 non-breaking spaces)',
		]);
	});

	it('keeps the literal tab the guide uses on purpose', () => {
		const tabs = corpusLines().filter((line) => line.text.includes('\t'));
		assert.deepEqual(tabs.map((line) => line.text), ['\tinvalid (tab)']);
	});

	it('keeps blank lines, which are what separate groups', () => {
		const blanks = corpusLines().filter((line) => line.status === null);
		assert.ok(blanks.length > 0);
		// Both kinds: genuinely empty, and whitespace-only. The guide draws
		// the second one with an `indent` span so you can see it.
		assert.ok(blanks.some((line) => line.text === ''));
		assert.ok(blanks.some((line) => line.text.trim() === '' && line.text !== ''));
		for (const line of blanks) assert.equal(line.text.trim(), '', `${line.id} is not blank`);
	});

	it('carries the five checkbox statuses, spelled as the guide spells them', () => {
		const status = CORPUS.sections[0].aspects[0];
		assert.deepEqual(
			status.lines.map((line) => line.text.slice(0, 3)),
			['[ ]', '[x]', '[@]', '[~]', '[?]'],
		);
	});
});
