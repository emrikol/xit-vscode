/**
 * The preview's model: the document reduced to blocks.
 *
 * The markup is tested in a real browser (test/browser/preview.mjs). This is
 * the half that decides *what* is drawn - grouping, counts, what collapses and
 * what is shown as written - and it is testable in plain Node because
 * src/preview.ts imports no `vscode`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { escapeHtml, isSafeLink, linkify, preview } = require_('../out/preview.js');
const { STATUSES } = require_('../out/checkbox.js');
const { commentLines } = require_('../out/comment.js');

const THRESHOLDS = { today: 20260731, criticalAfterDays: 14, soonWithinDays: 7 };

const blocks = (lines) => preview(lines, { thresholds: THRESHOLDS });
const groups = (lines) => blocks(lines).filter((block) => block.kind === 'group');

describe('no line is ever lost', () => {
	/**
	 * Every line index the blocks account for.
	 *
	 * The rule this whole module is built on. The specification defined a title
	 * by what it is *not*, so `- [ ] Buy milk` was silently promoted to a
	 * heading and the task vanished from every list. A preview that quietly
	 * dropped what it could not parse would reintroduce that one layer up.
	 */
	function accountedFor(lines) {
		const seen = new Set();
		const walk = (rows) => {
			for (const row of rows) {
				seen.add(row.line);
				for (const each of row.continuation) seen.add(each.line);
				walk(row.children);
			}
		};

		for (const block of blocks(lines)) {
			if (block.kind === 'group') {
				if (block.line !== null) seen.add(block.line);
				walk(block.rows);
			} else {
				seen.add(block.line);
			}
		}

		// Blank lines and comments are the two things a view may drop: one
		// carries no content, and the other is work deliberately set aside.
		// Everything else must be somewhere.
		const parked = commentLines(lines);

		return lines
			.map((text, line) => ({ text, line }))
			.filter(({ text }) => text.trim() !== '')
			.filter(({ line }) => !parked.has(line))
			.filter(({ line }) => !seen.has(line))
			.map(({ line, text }) => `${line}: ${JSON.stringify(text)}`);
	}

	it('accounts for every line of an ordinary document', () => {
		assert.deepEqual(accountedFor(['# Todos', '[ ] One', '\t[x] Two', '    continued', '', '# Next', '[@] Three']), []);
	});

	it('carries a description continuation, rather than showing only the first line', () => {
		// Found by the invariant above: continuations were dropped entirely, so
		// a multi-line description lost everything after its first line.
		const [group] = blocks(['[ ] Parent ...', '    ... and the rest']);
		assert.deepEqual(group.rows[0].continuation, [{ line: 1, text: '... and the rest' }]);
	});

	it('shows a Markdown task list rather than swallowing it', () => {
		// The exact line the marked-titles fork exists for.
		const [, raw] = blocks(['[ ] Real', '- [ ] Markdown habit']);
		assert.equal(raw.kind, 'raw');
		assert.equal(raw.text, '- [ ] Markdown habit');
	});

	it('accounts for every line of a document full of things it cannot parse', () => {
		assert.deepEqual(
			accountedFor(['- [ ] One', '* [ ] Two', 'x] Slip', '[ x] Malformed', 'bare prose', '  [ ] Cannot nest']),
			[],
		);
	});

	it('does not show a comment at all', () => {
		// Not collapsed, not marked: absent. Parked work is not outstanding
		// work, and every other view already drops it. A marker offering to
		// expand one put rows of furniture at the top of a file for content
		// nobody asked to see; Raw is where you read a comment.
		const found = blocks(['[ ] Real', '<!--', '[ ] Parked', 'notes', '-->']);
		assert.deepEqual(
			found.map((block) => block.kind),
			['group'],
		);
		assert.equal(JSON.stringify(found).includes('Parked'), false);
	});

	it('still ends the group above a comment, because one cannot sit inside an item', () => {
		const found = blocks(['[ ] Before', '<!-- note -->', '[ ] After']);
		assert.deepEqual(
			found.map((block) => block.rows.length),
			[1, 1],
		);
	});

	it('accounts for every line even when a comment never closes', () => {
		assert.deepEqual(accountedFor(['[ ] Real', '<!--', '[ ] Parked for ever']), []);
	});
});

describe('grouping', () => {
	it('puts items under the title above them', () => {
		const [one, two] = groups(['# Groceries', '[ ] Milk', '', '# Work', '[ ] Report']);
		assert.equal(one.title, 'Groceries');
		assert.equal(two.title, 'Work');
		assert.deepEqual(
			one.rows.map((row) => row.description),
			['Milk'],
		);
	});

	it('gives items before any title a group of their own', () => {
		// Spec §Group: a title MAY precede a group, not must.
		const [loose] = groups(['[ ] Loose', '# A title', '[ ] Owned']);
		assert.equal(loose.title, null);
		assert.deepEqual(
			loose.rows.map((row) => row.description),
			['Loose'],
		);
	});

	it('ends a group at a blank line', () => {
		assert.equal(groups(['[ ] One', '', '[ ] Two']).length, 2);
	});

	it('nests subtasks inside their parent rather than beside them', () => {
		const [group] = groups(['[ ] Parent', '\t[ ] Child', '\t\t[ ] Grandchild']);
		assert.equal(group.rows.length, 1);
		assert.equal(group.rows[0].children.length, 1);
		assert.equal(group.rows[0].children[0].children[0].description, 'Grandchild');
	});

	it('is empty for an empty document', () => {
		assert.deepEqual(blocks([]), []);
		assert.deepEqual(blocks(['', '   ']), []);
	});
});

describe('what a group counts', () => {
	it('counts every level of nesting, not just the top', () => {
		const [group] = groups(['[ ] Parent', '\t[x] Done child', '\t[ ] Open child']);
		assert.deepEqual({ done: group.done, total: group.total }, { done: 1, total: 3 });
	});

	it('counts obsolete as finished, like the sidebar does', () => {
		// Checked and obsolete are both closed, for opposite reasons.
		const [group] = groups(['[x] Done', '[~] Abandoned', '[ ] Open']);
		assert.deepEqual({ done: group.done, total: group.total }, { done: 2, total: 3 });
	});

	it('totals estimates and says how many had none', () => {
		// A total that quietly leaves things out reads as "this group is 2h"
		// when it is 2h plus however long two other things take.
		const [group] = groups(['[ ] A #est=90m', '[ ] B #est=30m', '[ ] C', '[ ] D']);
		assert.deepEqual({ minutes: group.minutes, unestimated: group.unestimated }, { minutes: 120, unestimated: 2 });
	});
});

describe('what a row carries', () => {
	it('lifts priority and tags out of the description, since both are drawn', () => {
		const [group] = groups(['[ ] !! Milk -> 2026-07-20 #est=30m #shop']);
		const [row] = group.rows;
		assert.equal(row.description, 'Milk');
		assert.equal(row.priority, 2);
		assert.deepEqual(row.tags, ['shop'], 'a machine tag drawn elsewhere should not also be a pill');
		assert.equal(row.estimate, '30m');
		assert.equal(row.due, '2026-07-20');
	});

	it('shows dates as written, so they match the file', () => {
		const [group] = groups(['[ ] Ship it <- 2026-08-01 -> 2026-W40']);
		assert.deepEqual({ start: group.rows[0].start, due: group.rows[0].due }, { start: '2026-08-01', due: '2026-W40' });
	});

	it('carries the urgency the sidebar would give it', () => {
		assert.equal(groups(['[ ] A -> 2020-01-01'])[0].rows[0].urgency, 'critical');
		assert.equal(groups(['[>] A'])[0].rows[0].urgency, 'waiting');
		assert.equal(groups(['[ ] A <- 2030-01-01'])[0].rows[0].urgency, 'notYet');
	});

	it('names every status, for the button label', () => {
		for (const status of STATUSES) {
			const [group] = groups([`[${status}] An item`]);
			assert.ok(group.rows[0].statusLabel.length > 0, `[${status}] has no label`);
		}
	});

	it('shows a tag the file declared about itself, like any other', () => {
		// `<!-- xit: tags=client-acme -->` tags every item in the file, and the
		// preview draws it as a pill on each one. The directive line itself is
		// a comment, so it collapses.
		const [group] = groups(['<!-- xit: tags=client-acme -->', '[ ] Draft the contract']);
		assert.deepEqual(group.rows[0].tags, ['client-acme']);
	});

	it('marks a blocked item, so it can be drawn as blocked', () => {
		const [group] = groups(['[ ] Blocker #id=aaaa', '[ ] Held #after=aaaa']);
		assert.deepEqual(
			group.rows.map((row) => row.blocked),
			[false, true],
		);
	});
});

describe('links', () => {
	it('makes a markdown-style link clickable, showing its label', () => {
		assert.equal(
			linkify('[Kickoff, Jul 14](quill://meeting/9e0ef127)'),
			'<a href="quill://meeting/9e0ef127">Kickoff, Jul 14</a>',
		);
	});

	it('makes a bare URL clickable without swallowing the words around it', () => {
		assert.equal(
			linkify('See https://example.com now'),
			'See <a href="https://example.com">https://example.com</a> now',
		);
	});

	it('allows any scheme, because quill:// is a real one someone uses', () => {
		// An allow-list would be wrong: the schemes people's tools invent are
		// not knowable here. Only the ones that execute are refused.
		assert.match(linkify('[x](weird-app://thing)'), /href="weird-app:\/\/thing"/);
	});

	it('refuses a scheme that executes, and shows it as text instead', () => {
		// Still visible - nothing is hidden - just not live.
		assert.equal(linkify('[Evil](javascript:alert(1))'), '[Evil](javascript:alert(1))');
		assert.equal(linkify('[Evil](DATA:text/html,x)'), '[Evil](DATA:text/html,x)');
	});

	it('escapes a target that tries to close the attribute', () => {
		assert.match(linkify('[q](https://x/"onmouseover="alert(1))'), /&quot;onmouseover=&quot;/);
	});

	it('keeps a target that contains balanced parentheses', () => {
		// Cut at the first `)` before. Ordinary in a meeting or wiki URL.
		assert.equal(linkify('[Doc](https://x.com/a_(b)_c)'), '<a href="https://x.com/a_(b)_c">Doc</a>');
	});

	it('does not swallow a parenthesis that closes the sentence', () => {
		// The other half of the same problem, and the two look identical to a
		// regex. The difference is whether the parentheses balance.
		assert.equal(linkify('(see https://example.com)'), '(see <a href="https://example.com">https://example.com</a>)');
	});

	it('keeps a bracketed aside inside a label', () => {
		assert.equal(linkify('[a [b] c](https://x)'), '<a href="https://x">a [b] c</a>');
	});

	it('shows the target when the label is empty, rather than an invisible anchor', () => {
		assert.equal(linkify('[](https://x.com)'), '<a href="https://x.com">https://x.com</a>');
	});

	it('does not run a URL into the punctuation after it', () => {
		assert.equal(
			linkify('Ends at https://example.com.'),
			'Ends at <a href="https://example.com">https://example.com</a>.',
		);
	});

	it('refuses the same schemes at the point of opening, not only of drawing', () => {
		// Two checks, because they guard different things: one decides what the
		// page shows, the other what the extension asks the operating system to
		// launch. Only the second can do damage.
		assert.equal(isSafeLink('https://example.com'), true);
		assert.equal(isSafeLink('quill://meeting/1'), true);
		assert.equal(isSafeLink('javascript:alert(1)'), false);
		assert.equal(isSafeLink('  JavaScript:alert(1)'), false);
		assert.equal(isSafeLink('data:text/html,x'), false);
		assert.equal(isSafeLink(''), false);
		assert.equal(isSafeLink('   '), false);
	});

	it('leaves text with no link alone', () => {
		assert.equal(linkify('Plain <text> & more'), 'Plain &lt;text&gt; &amp; more');
	});
});

describe('escaping', () => {
	it('neutralises every character that could become markup', () => {
		assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
	});

	it('escapes the ampersand first, so an escape cannot be double-escaped', () => {
		// `&lt;` must not come back as `&amp;lt;`.
		assert.equal(escapeHtml('<'), '&lt;');
		assert.equal(escapeHtml('&lt;'), '&amp;lt;');
	});
});
