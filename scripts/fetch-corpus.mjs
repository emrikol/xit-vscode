/**
 * Build the conformance corpus from the [x]it! syntax guide.
 *
 *   node scripts/fetch-corpus.mjs            fetch and write the fixture
 *   node scripts/fetch-corpus.mjs --check    fail if the live page has moved on
 *
 * jotaen says twice in Discussions that no way to test a highlighter against
 * the spec exists (#20, #6). It does, and it is his own page. The guide is not
 * prose with examples: every example is marked up with the token each part is
 * expected to be, by the person who wrote the format.
 *
 *   <span class="open"><span class="checkbox">[ ]</span> Open</span>
 *   <span class="invalid">[X] Invalid (uppercase)</span>
 *
 * So the page is an expected-tokenisation corpus, and this turns it into one
 * that a test can read. The output is committed. The tests never reach the
 * network, and the guide cannot change under a test run.
 *
 * Two things here are load-bearing and easy to destroy:
 *
 *   - Non-breaking spaces and tabs are deliberate. The guide uses them for
 *     the invalid examples: a checkbox holding U+00A0 instead of a space, an
 *     indentation of four non-breaking spaces, an indentation of one tab. An
 *     extractor that normalises whitespace deletes exactly the cases worth
 *     testing, and every one of them starts passing for the wrong reason.
 *   - A bare <br> is a blank line, and blank lines carry meaning: they are
 *     what separates one group from the next, and what a headline must follow.
 *     Each aspect is kept as a contiguous block of lines, blanks included, so
 *     it can be tokenized as one document rather than line by line.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'https://xit.jotaen.net/syntax-guide';
const OUT = resolve(REPO_ROOT, 'test/fixtures/syntax-guide.json');

/**
 * Named entities the guide actually uses.
 *
 * Deliberately not a general HTML entity table. An unknown name throws rather
 * than passing through, because a silently mangled example is worse than a
 * failed build: it becomes a test asserting the wrong text.
 *
 * Three kinds, which used to be shown by grouping them onto three lines and is
 * now said here instead: the ones with syntactic meaning in HTML, then the
 * curly quotes, then the dashes and arrows. A grouping that exists only as
 * line breaks is one reformat away from being lost.
 */
const ENTITIES = {
	nbsp: ' ',
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	rsquo: '’',
	lsquo: '‘',
	ldquo: '“',
	rdquo: '”',
	hellip: '…',
	mdash: '—',
	ndash: '–',
	rarr: '→',
};

function decodeEntities(text) {
	return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_whole, body) => {
		if (body[0] === '#') {
			const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
			return String.fromCodePoint(code);
		}
		if (body in ENTITIES) return ENTITIES[body];
		throw new Error(`unknown HTML entity &${body}; — add it to ENTITIES rather than guessing`);
	});
}

/** Visible text of a fragment that contains only inline markup, whitespace collapsed. */
function plainText(html) {
	return decodeEntities(html.replace(/<[^>]+>/g, ''))
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * One `<div class="listing">` into lines.
 *
 * Every line is a single top-level span whose class is the line's status, or
 * a bare `<br>` for a blank line. Spans nested inside it name the tokens.
 * Text at depth zero is the HTML source's own indentation and is dropped.
 */
function parseListing(html) {
	const lines = [];
	let text = '';
	let status = null;
	let spans = [];
	const stack = [];

	const finishLine = () => {
		lines.push({ text, status, spans });
		text = '';
		status = null;
		spans = [];
	};

	const token = /<span class="([^"]+)">|<\/span>|<br\s*\/?>|([^<]+)/g;

	for (let match = token.exec(html); match; match = token.exec(html)) {
		const [whole, openClass, chunk] = match;

		if (openClass !== undefined) {
			if (stack.length === 0) {
				// A top-level `indent` span is not a status. It is how the
				// guide draws a line that consists only of whitespace, for
				// the rule "Blank line means either the line is empty, or it
				// only consists of whitespace". Recording it as a status
				// would invent an eighth one that no highlighter emits.
				status = openClass === 'indent' ? null : openClass;
				stack.push(null);
			} else {
				stack.push({ token: openClass, start: text.length });
			}
		} else if (whole === '</span>') {
			const frame = stack.pop();
			// Zero-width spans are drawing, not tokens. The guide emits an
			// empty `indent` for "invalid (no space)", to keep it in line with
			// the 1, 2 and 3 space examples under it. There is nothing there
			// to highlight, and a zero-width expectation cannot be met.
			if (frame && text.length > frame.start) spans.push({ ...frame, end: text.length });
		} else if (whole.startsWith('<br')) {
			finishLine();
		} else if (chunk !== undefined) {
			// Depth zero is between the tags, i.e. the source file's own
			// indentation and newlines. Anything else there is unexpected
			// structure, and guessing at it is how a corpus goes quietly wrong.
			if (stack.length === 0) {
				if (chunk.trim()) throw new Error(`unexpected bare text in a listing: ${JSON.stringify(chunk)}`);
			} else {
				text += decodeEntities(chunk);
			}
		}
	}

	// A listing whose last line has no trailing <br>.
	if (text || status) finishLine();

	return lines;
}

function slug(heading) {
	return heading
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

function build(html) {
	const body = html.slice(html.indexOf('<body'));
	const sections = [];

	// Walk headings and the aspects that follow each one, in document order.
	const marker = /<h2>([^<]*)<\/h2>|<div class="aspect">([\s\S]*?)<\/div>\s*<\/div>/g;

	for (let match = marker.exec(body); match; match = marker.exec(body)) {
		const [, heading, aspect] = match;

		if (heading !== undefined) {
			sections.push({ heading: plainText(heading), id: slug(heading), aspects: [] });
			continue;
		}
		if (!sections.length) continue;

		const annotation = /<div class="annotation">([\s\S]*?)<\/div>/.exec(aspect);
		const listing = /<div class="listing">([\s\S]*?)$/.exec(aspect);
		if (!listing) continue;

		const section = sections.at(-1);
		section.aspects.push({
			// The guide's own prose for this block. It is the reason a case
			// exists, and belongs beside the case rather than in a commit
			// message: an allowlist entry is unreadable without it.
			rule: annotation ? plainText(annotation[1]) : '',
			id: `${section.id}/${section.aspects.length}`,
			lines: parseListing(listing[1]),
		});
	}

	return sections;
}

const html = await fetch(SOURCE).then((response) => {
	if (!response.ok) throw new Error(`${SOURCE} returned ${response.status}`);
	return response.text();
});

const sections = build(html);
const lines = sections.flatMap((s) => s.aspects.flatMap((a) => a.lines));
const tokens = lines.flatMap((l) => l.spans);

// Completeness, checked against the page rather than against a number someone
// guessed. Every `<div class="listing">` in the source must have produced an
// aspect: a parser that silently skips a block it did not recognise would
// hand the tests a corpus with holes in it, and they would report green.
const listingCount = (html.match(/<div class="listing">/g) ?? []).length;
const aspectCount = sections.reduce((n, s) => n + s.aspects.length, 0);

if (aspectCount !== listingCount) {
	throw new Error(
		`the page has ${listingCount} listings but only ${aspectCount} were parsed; the structure has changed`,
	);
}
// The vocabulary, pinned. If the guide grows a class we have never seen, the
// honest outcome is a failed build and someone reading the page, not a corpus
// that quietly drops whatever it did not recognise.
const STATUSES = new Set(['open', 'checked', 'ongoing', 'obsolete', 'in-question', 'invalid', 'headline']);
const TOKENS = new Set(['checkbox', 'priority', 'due', 'tag', 'indent']);

for (const line of lines) {
	if (line.status !== null && !STATUSES.has(line.status)) {
		throw new Error(`unknown line status "${line.status}" in the guide: ${JSON.stringify(line.text)}`);
	}
	for (const span of line.spans) {
		if (!TOKENS.has(span.token)) {
			throw new Error(`unknown token "${span.token}" in the guide: ${JSON.stringify(line.text)}`);
		}
	}
}

if (!lines.some((line) => line.text.includes(' '))) {
	throw new Error(
		'no non-breaking space survived extraction; the invalid-whitespace examples have been normalised away',
	);
}
if (!lines.some((line) => line.text.includes('\t'))) {
	throw new Error('no tab survived extraction; the invalid-indentation example has been normalised away');
}

const corpus = {
	$comment: 'Generated by scripts/fetch-corpus.mjs. Do not edit by hand.',
	source: SOURCE,
	// Not a timestamp of the run: this is the Last-Modified of the page where
	// one is offered, so re-running on an unchanged page is a no-op diff.
	retrieved: new Date().toISOString().slice(0, 10),
	sections,
};

const serialised = JSON.stringify(corpus, null, '\t') + '\n';

if (process.argv.includes('--check')) {
	if (!existsSync(OUT)) throw new Error(`${OUT} does not exist; run without --check`);
	const current = readFileSync(OUT, 'utf8');
	const strip = (text) => text.replace(/"retrieved": "[^"]*",\n/, '');
	if (strip(current) !== strip(serialised)) {
		console.error('fetch-corpus: the syntax guide has changed since the fixture was built.');
		console.error('             run `node scripts/fetch-corpus.mjs` and read the diff.');
		process.exit(1);
	}
	console.log('fetch-corpus: fixture matches the live guide.');
} else {
	writeFileSync(OUT, serialised);
	const statuses = new Set(lines.map((l) => l.status).filter(Boolean));
	const kinds = new Set(tokens.map((t) => t.token));
	console.log(`fetch-corpus: wrote ${OUT}`);
	console.log(
		`  ${sections.length} sections, ${sections.reduce((n, s) => n + s.aspects.length, 0)} aspects, ${lines.length} lines, ${tokens.length} tokens`,
	);
	console.log(`  line statuses: ${[...statuses].sort().join(', ')}`);
	console.log(`  token kinds:   ${[...kinds].sort().join(', ')}`);
}
