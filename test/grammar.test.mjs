/**
 * Conformance tests for the [x]it! TextMate grammar.
 *
 * Each test cites the rule it enforces from the [x]it! Specification v1.1
 * (https://github.com/jotaen/xit/blob/main/Specification.md). Where the
 * specification is ambiguous, the reference implementation
 * (https://github.com/jotaen/xit-sublime) breaks the tie.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { tokenize, tokenizeLine, scoped, onlyScoped, fixture } from './tokenizer.mjs';

const CHECKBOX = 'task.checkbox';
const OPEN = 'task.checkbox.open';
const CHECKED = 'task.checkbox.checked';
const ONGOING = 'task.checkbox.ongoing';
const OBSOLETE = 'task.checkbox.obsolete';
const IN_QUESTION = 'task.checkbox.in-question';
const WAITING = 'task.checkbox.waiting';
const PRIORITY = 'task.priority';
const DATE = 'task.date';
const TAG = 'task.tag';
const TAG_VALUE = 'task.tag.value';
const TITLE = 'task.title';
const COMMENT = 'markup.other.comment';
const STRIKETHROUGH = 'markup.strikethrough';

/** Assert that `line` carries exactly one token run scoped `fragment`, equal to `expected`. */
async function assertScope(line, fragment, expected) {
	const tokens = await tokenizeLine(line);
	assert.equal(onlyScoped(tokens, fragment), expected, `${JSON.stringify(line)} → ${fragment}`);
}

/** Assert that `line` carries no token scoped `fragment`. */
async function assertNoScope(line, fragment) {
	const tokens = await tokenizeLine(line);
	assert.deepEqual(scoped(tokens, fragment), [], `${JSON.stringify(line)} → ${fragment}`);
}

describe('checkbox (spec §Checkbox)', () => {
	it('recognises the five statuses of the specification', async () => {
		await assertScope('[ ] Open', OPEN, '[ ]');
		await assertScope('[x] Checked', CHECKED, '[x]');
		await assertScope('[@] Ongoing', ONGOING, '[@]');
		await assertScope('[~] Obsolete', OBSOLETE, '[~]');
		await assertScope('[?] In question', IN_QUESTION, '[?]');
	});

	it('recognises waiting, which is this fork\'s own', async () => {
		await assertScope('[>] Waiting', WAITING, '[>]');
	});

	it('gives every status a scope no other status carries', async () => {
		// Regression: the v1.1 commit copy-pasted the ongoing scope onto [?].
		// Now checked for all six rather than that one pair, because the same
		// slip is one careless paste away every time a status is added.
		const scopes = [OPEN, CHECKED, ONGOING, OBSOLETE, IN_QUESTION, WAITING];
		const lines = ['[ ] x', '[x] x', '[@] x', '[~] x', '[?] x', '[>] x'];

		for (const [index, line] of lines.entries()) {
			for (const [other, scope] of scopes.entries()) {
				if (other === index) await assertScope(line, scope, line.slice(0, 3));
				else await assertNoScope(line, scope);
			}
		}
	});

	it('requires exactly three characters', async () => {
		// Spec: "It MUST be a sequence of 3 characters".
		for (const line of ['[] Invalid', '[  ] Invalid', '[ x ] Invalid', '[@@] Invalid']) {
			await assertNoScope(line, CHECKBOX);
		}
	});

	it('rejects unknown status characters', async () => {
		for (const line of ['[*] Invalid', '[o] Invalid', '[X] Invalid']) {
			await assertNoScope(line, CHECKBOX);
		}
	});

	it('must start at the beginning of the line', async () => {
		// Spec §Item: "It MUST start at the beginning of a line with a checkbox."
		await assertNoScope(' [x] Invalid', CHECKBOX);
		await assertNoScope('    [x] Invalid', CHECKBOX);
	});

	it('must be followed by a space or the end of the line', async () => {
		await assertNoScope('[ ]Invalid', CHECKBOX);
		await assertScope('[ ]', OPEN, '[ ]');
		await assertScope('[ ] ', OPEN, '[ ]');
	});
});

describe('priority (spec §Priority)', () => {
	it('is recognised after every checkbox status', async () => {
		await assertScope('[ ] ! Open', PRIORITY, '!');
		await assertScope('[x] ! Checked', PRIORITY, '!');
		await assertScope('[@] ! Ongoing', PRIORITY, '!');
		await assertScope('[~] ! Obsolete', PRIORITY, '!');
		// Regression: the priority lookbehind omitted `?`.
		await assertScope('[?] ! In question', PRIORITY, '!');
	});

	it('accepts any number of exclamation marks', async () => {
		await assertScope('[ ] !!! Very important', PRIORITY, '!!!');
		await assertScope('[ ] !!!!!!!!!! Super important', PRIORITY, '!!!!!!!!!!');
	});

	it('accepts dot padding on one side', async () => {
		// Spec: "The dots MUST appear either before or after the exclamation mark(s)."
		await assertScope('[ ] ..! Important', PRIORITY, '..!');
		await assertScope('[ ] !!. More important', PRIORITY, '!!.');
	});

	it('rejects dots on both sides', async () => {
		await assertNoScope('[ ] .!. Invalid', PRIORITY);
		await assertNoScope('[ ] !.! Invalid', PRIORITY);
	});

	it('accepts dots on their own', async () => {
		// Spec: "It MUST contain any number of exclamation marks (`!`) and
		// dots (`.`)." Any number includes none, so dots with no exclamation
		// mark are a priority of zero importance rather than not a priority.
		// The syntax guide shows "[ ] ... This is not important" with the dots
		// marked as one, and jotaen's own Sublime rule is `((!*)(\.*)|(\.*)(!*))`,
		// which matches them too. This test used to assert the opposite.
		await assertScope('[ ] ... Not important', PRIORITY, '...');
		await assertScope('[ ] . Not important', PRIORITY, '.');
	});

	it('allows additional spaces before it', async () => {
		// Spec §Item: "(Additional space characters MAY appear.)"
		await assertScope('[ ]    ! Do something', PRIORITY, '!');
		await assertScope('[ ]   !!. Do something', PRIORITY, '!!.');
	});

	it('must be a separate token', async () => {
		await assertNoScope('[ ] !This has regular priority', PRIORITY);
	});

	it('is only recognised at the start of the description', async () => {
		const [, second] = await tokenize('[ ] The next line is ...\n    !!! not important');
		assert.deepEqual(scoped(second, PRIORITY), []);
	});

	it('does not treat later exclamation marks as priority', async () => {
		await assertScope('[ ] ! !!! This is important!', PRIORITY, '!');
	});
});

describe('due date (spec §Due Date)', () => {
	it('accepts all five date patterns with a hyphen separator', async () => {
		await assertScope('[ ] -> 2022-01-31', DATE, '-> 2022-01-31');
		await assertScope('[ ] -> 2022-01', DATE, '-> 2022-01');
		await assertScope('[ ] -> 2022', DATE, '-> 2022');
		await assertScope('[ ] -> 2022-W01', DATE, '-> 2022-W01');
		await assertScope('[ ] -> 2022-Q1', DATE, '-> 2022-Q1');
	});

	it('accepts all five date patterns with a slash separator', async () => {
		await assertScope('[ ] -> 2022/01/31', DATE, '-> 2022/01/31');
		await assertScope('[ ] -> 2022/01', DATE, '-> 2022/01');
		await assertScope('[ ] -> 2022/W01', DATE, '-> 2022/W01');
		await assertScope('[ ] -> 2022/Q1', DATE, '-> 2022/Q1');
	});

	it('requires a consistent separator', async () => {
		await assertNoScope('[ ] -> 2022-01/31', DATE);
	});

	it('requires the exact "-> " prefix', async () => {
		await assertNoScope('[ ] ->2022-01-31', DATE);
		await assertNoScope('[ ] ->   2022-01-31', DATE);
		await assertNoScope('[ ] > 2022-01-31', DATE);
		await assertNoScope('[ ] Do until ->', DATE);
	});

	it('rejects trailing junk', async () => {
		await assertNoScope('[ ] -> 2022-01-31very urgent', DATE);
		await assertNoScope('[ ] -> 2022-01-31-0', DATE);
		await assertNoScope('[ ] -> 2022/01/31/0', DATE);
		await assertNoScope('[ ] -> 2022-01-31T10:00', DATE);
	});

	it('rejects out-of-range months, weeks and quarters', async () => {
		await assertNoScope('[ ] -> 2022-13-01', DATE);
		await assertNoScope('[ ] -> 2022-W54', DATE);
		await assertNoScope('[ ] -> 2022-Q5', DATE);
		await assertNoScope('[ ] -> 2022-01-32', DATE);
	});

	it('may be surrounded by punctuation', async () => {
		await assertScope('[ ] Do this soon -> 2022-01-31!!!', DATE, '-> 2022-01-31');
		await assertScope('[ ] Do this (-> 2022-01-31)', DATE, '-> 2022-01-31');
	});

	it('is recognised on a continuation line', async () => {
		const [, second] = await tokenize('[ ] Do something until ...\n    -> 2022-01-31');
		assert.equal(onlyScoped(second, DATE), '-> 2022-01-31');
	});

	it('only counts the first occurrence on a line', async () => {
		// Spec: "(Any additional due dates MUST be disregarded.)"
		const line = await tokenizeLine('[ ] -> 2022-01-31 -> 2022-02-28');
		assert.deepEqual(scoped(line, DATE), ['-> 2022-01-31']);
	});

	it('still recognises tags after the first due date', async () => {
		const line = await tokenizeLine('[ ] -> 2022-01-31 #tag and #two');
		assert.deepEqual(scoped(line, TAG), ['#tag', '#two']);
	});

	it('only counts the first occurrence across continuation lines', async () => {
		const [, second] = await tokenize('[ ] -> 2022-01-31 first\n    -> 2022-02-28 second');
		assert.deepEqual(scoped(second, DATE), []);
	});

	it('only counts the first occurrence when it is on a continuation line', async () => {
		const lines = await tokenize('[ ] Do something ...\n    until -> 2022-01-31\n    not -> 2022-02-28');
		assert.deepEqual(scoped(lines[1], DATE), ['-> 2022-01-31']);
		assert.deepEqual(scoped(lines[2], DATE), []);
	});

	it('starts counting again at the next item', async () => {
		const lines = await tokenize('[ ] First -> 2022-01-31\n[ ] Second -> 2022-02-28');
		assert.deepEqual(scoped(lines[0], DATE), ['-> 2022-01-31']);
		assert.deepEqual(scoped(lines[1], DATE), ['-> 2022-02-28']);
	});

	it('starts counting again after a blank line', async () => {
		const lines = await tokenize('[ ] First -> 2022-01-31\n\n[ ] Second -> 2022-02-28');
		assert.deepEqual(scoped(lines[0], DATE), ['-> 2022-01-31']);
		assert.deepEqual(scoped(lines[2], DATE), ['-> 2022-02-28']);
	});
});

describe('tag (spec §Tag)', () => {
	it('accepts letters, digits, underscore and hyphen', async () => {
		await assertScope('[ ] #tag', TAG, '#tag');
		await assertScope('[ ] #T-A-G', TAG, '#T-A-G');
		await assertScope('[ ] #--tag--', TAG, '#--tag--');
		await assertScope('[ ] #__tag__', TAG, '#__tag__');
		await assertScope('[ ] #123', TAG, '#123');
		await assertScope('[ ] #1t2a3g', TAG, '#1t2a3g');
	});

	it('accepts Unicode letters', async () => {
		// Spec glossary: "Letter: a character from the Unicode Letter category (L)".
		await assertScope('[ ] #täg', TAG, '#täg');
		await assertScope('[ ] #今日は', TAG, '#今日は');
		await assertScope('[ ] #გამარჯობა', TAG, '#გამარჯობა');
	});

	it('must follow a space or punctuation, which the spec does not require', async () => {
		// A deliberate divergence. Read Discussion #51 before changing it.
		//
		// Asked directly whether "[ ] This item has a#tag" contains a tag,
		// jotaen answered "Currently, yes", and listed the consequences as
		// downsides he accepts: "[ ] Change my master password to be
		// bN144#y6Q!Jc" recognises "#y6Q" as a tag, and a URL fragment such as
		// ".../foo/#some-anchor" is a tag too. The spec is silent on what may
		// come before a "#", so read literally it agrees with him.
		//
		// We keep the lookbehind anyway, because his own xit-sublime rule has
		// it - character for character, `(?<=[\s\p{P}])\#[\p{L}\d_-]+` - so
		// the reference implementation contradicts the answer. By his stated
		// rule his plugin should colour "#y6Q" in that password, and it does
		// not. Following the prose over the implementation would make
		// highlighting worse in exactly the case he calls a downside.
		//
		// The URL case still matches, because "/" is punctuation. That one is
		// unavoidable without teaching the grammar about URLs.
		await assertNoScope('[ ] Change my master password to be bN144#y6Q!Jc', TAG);
		await assertNoScope('[ ] This item has a#tag', TAG);
		await assertScope('[ ] This item has a #tag', TAG, '#tag');
	});

	it('stops at punctuation', async () => {
		await assertScope('[ ] This is a #tag.', TAG, '#tag');
		await assertScope('[ ] #t-a-g!', TAG, '#t-a-g');
		await assertScope('[ ] #--tag--?', TAG, '#--tag--');
		await assertScope('[ ] #--tag--:text', TAG, '#--tag--');
		await assertScope('[ ] (#tag)', TAG, '#tag');
		await assertScope('[ ] #Actually, it is', TAG, '#Actually');
	});

	it('stops at characters that are not letters', async () => {
		await assertScope('[ ] #tag🥳', TAG, '#tag');
	});

	it('separates adjacent tags', async () => {
		const line = await tokenizeLine('[ ] Tags: #tag1/#tag2');
		assert.deepEqual(scoped(line, TAG), ['#tag1', '#tag2']);
	});

	it('finds several tags on one line', async () => {
		const line = await tokenizeLine('[ ] #tag1 #tag2 and #tag3');
		assert.deepEqual(scoped(line, TAG), ['#tag1', '#tag2', '#tag3']);
	});

	it('requires a name', async () => {
		await assertNoScope('[ ] Not a tag: #', TAG);
		await assertNoScope('[ ] Not a tag: #=value', TAG);
		await assertNoScope('[ ] Not a tag: #="value"', TAG);
	});

	it('accepts unquoted values', async () => {
		await assertScope('[ ] #tag=value', TAG, '#tag=value');
		await assertScope('[ ] #t-a-g=v-a-l-u-e', TAG, '#t-a-g=v-a-l-u-e');
		await assertScope('[ ] #国=日本', TAG, '#国=日本');
	});

	it('accepts quoted values', async () => {
		await assertScope('[ ] #tag="v a l u e"', TAG, '#tag="v a l u e"');
		await assertScope("[ ] #tag='v!a.l?u+e'", TAG, "#tag='v!a.l?u+e'");
		await assertScope('[ ] (#tag="bar")', TAG, '#tag="bar"');
	});

	it('treats a bare "=" as an absent value, but keeps it in the tag', async () => {
		// Spec: "An empty tag value (e.g. #tag= or #tag="") MUST be treated
		// the same as an absent tag value (e.g. #tag)."
		//
		// Absent in meaning, not absent from the tag. The "=" was left with no
		// scope at all, which drew an uncoloured character in the middle of a
		// coloured tag - the same defect the square brackets had. The syntax
		// guide marks the whole of "#tag=" as the tag. There is still no value
		// scope, because there is still no value.
		await assertScope('[ ] #tag=', TAG, '#tag=');
		await assertNoScope('[ ] #tag=', TAG_VALUE);
	});

	it('accepts explicitly empty quoted values', async () => {
		await assertScope('[ ] #tag=""', TAG, '#tag=""');
		await assertScope("[ ] #tag=''", TAG, "#tag=''");
	});

	it('treats an unterminated quoted value as absent', async () => {
		// Spec: "In case no matching closing quote appears on the same line,
		// the tag value MUST be treated as absent." The opening quote and
		// everything after it fall back to description, which is what the
		// syntax guide shows.
		await assertScope('[ ] #tag="v a l u e', TAG, '#tag=');
		await assertNoScope('[ ] #tag="v a l u e', TAG_VALUE);
		await assertScope('[ ] #tag="v a l u e\'', TAG, '#tag=');
	});

	it('does not span lines', async () => {
		const [first, second] = await tokenize('[ ] #tag="hello\n    World!"');
		assert.equal(onlyScoped(first, TAG), '#tag=');
		assert.deepEqual(scoped(second, TAG), []);
	});

	it('is recognised on a continuation line', async () => {
		const [, second] = await tokenize('[ ] #Actually it #has a #LOT\n    Even on the #next-line!');
		assert.equal(onlyScoped(second, TAG), '#next-line');
	});
});

describe('description (spec §Description)', () => {
	it('continues on lines indented by four spaces', async () => {
		const lines = await tokenize('[ ] And this one ...\n    is even ...\n    longer');
		assert.equal(onlyScoped(lines[0], OPEN), '[ ]');
		for (const line of lines.slice(1)) assert.deepEqual(scoped(line, CHECKBOX), []);
	});

	it('does not continue on lines indented by fewer than four spaces', async () => {
		for (const indent of ['', ' ', '  ', '   ']) {
			const [, second] = await tokenize(`[ ] The next line is ...\n${indent}invalid`);
			assert.deepEqual(scoped(second, TAG), [], `indent of ${indent.length}`);
		}
	});

	it('does not mistake bracketed text for a checkbox', async () => {
		// Mid-line brackets are description, always.
		await assertScope('[ ] A math formula: f[x]=x', CHECKBOX, '[ ]');
		await assertScope('[ ] [ ] Description text [ ]', CHECKBOX, '[ ]');
	});
});

describe('subtasks (fork, discussion #2)', () => {
	// Not in the specification. The syntax guide is explicit that an indented
	// checkbox is description text - "Square brackets in the description (even
	// at the beginning of subsequent lines) are not recognised as checkboxes" -
	// and this fork overrules that. See KNOWN in test/conformance.test.mjs.

	it('recognises an item indented from its parent', async () => {
		const lines = await tokenize('[ ] Parent\n  [ ] Child');
		assert.deepEqual(scoped(lines[1], OPEN), ['[ ]']);
	});

	it('nests every status, not only the ones the specification has', async () => {
		// A subtask is an item. Whatever status one can hold, the other must.
		// The structural half of this is asserted in test/checkbox.test.mjs by
		// comparing the grammar's rules against STATUSES; this is the half
		// that checks it actually tokenizes.
		for (const [status, scope] of [[' ', OPEN], ['x', CHECKED], ['@', ONGOING], ['~', OBSOLETE], ['?', IN_QUESTION], ['>', WAITING]]) {
			const lines = await tokenize(`[ ] Parent\n\t[${status}] Child`);
			assert.deepEqual(scoped(lines[1], scope), [`[${status}]`], `nested [${status}]`);
		}
	});

	it('takes two spaces, or a tab', async () => {
		for (const indent of ['  ', '   ', '        ', '\t', '\t\t']) {
			const lines = await tokenize(`[ ] Parent\n${indent}[x] Child`);
			assert.deepEqual(scoped(lines[1], CHECKED), ['[x]'], `indent ${JSON.stringify(indent)}`);
		}
	});

	it('does not take one space', async () => {
		// Spec §Checkbox still holds below two: the guide's "The checkbox
		// cannot be preceded by whitespace" is only relaxed for real nesting.
		const lines = await tokenize('[ ] Parent\n [x] Not a child');
		assert.deepEqual(scoped(lines[1], CHECKBOX), []);
	});

	it('needs a parent, so an orphan stays invalid', async () => {
		const lines = await tokenize('A title\n\n  [ ] Indented with nothing above it');
		assert.deepEqual(scoped(lines[2], CHECKBOX), []);
	});

	it('nests to any depth', async () => {
		const lines = await tokenize('[ ] One\n  [ ] Two\n    [ ] Three\n      [ ] Four\n        [ ] Five');
		for (const line of lines) assert.deepEqual(scoped(line, OPEN), ['[ ]']);
	});

	it('tells a subtask from a description continuation', async () => {
		const lines = await tokenize('[ ] Parent ...\n    ... continued\n    [ ] but this is a subtask');
		assert.deepEqual(scoped(lines[1], CHECKBOX), []);
		assert.deepEqual(scoped(lines[2], OPEN), ['[ ]']);
	});

	it('gives a subtask its own due date', async () => {
		// The parent already has one, and "any additional due dates MUST be
		// disregarded" applies within an item - a subtask is a different item.
		const lines = await tokenize('[ ] Parent -> 2026-01-01\n  [ ] Child -> 2026-02-02');
		assert.deepEqual(scoped(lines[0], DATE), ['-> 2026-01-01']);
		assert.deepEqual(scoped(lines[1], DATE), ['-> 2026-02-02']);
	});

	it('still disregards a second date within one subtask', async () => {
		const lines = await tokenize('[ ] Parent\n  [ ] Child -> 2026-02-02 -> 2026-03-03');
		assert.deepEqual(scoped(lines[1], DATE), ['-> 2026-02-02']);
	});

	it('ends the whole nest at a blank line', async () => {
		// Spec §Item: "The item MUST NOT contain any blank lines."
		const lines = await tokenize('[ ] Parent\n  [ ] Child\n\n  [ ] Orphan');
		assert.deepEqual(scoped(lines[1], OPEN), ['[ ]']);
		assert.deepEqual(scoped(lines[3], CHECKBOX), []);
	});

	it('continues a description with a tab, which the spec does not allow', async () => {
		// Spec §Description asks for exactly four spaces, and the syntax guide
		// lists "\tinvalid (tab)" as invalid. Forked so the Tab key works
		// everywhere in the file: without it, tabs would nest subtasks but
		// break continuations, and you would need both in one document.
		const lines = await tokenize('[ ] Item ...\n\t-> 2026-01-31');
		assert.deepEqual(scoped(lines[1], DATE), ['-> 2026-01-31']);
	});

	it('continues a subtask with a deeper tab', async () => {
		const lines = await tokenize('[ ] Parent\n\t[ ] Child ...\n\t\t-> 2026-01-31');
		assert.deepEqual(scoped(lines[1], OPEN), ['[ ]']);
		assert.deepEqual(scoped(lines[2], DATE), ['-> 2026-01-31']);
	});

	it('carries the closed styling into a subtask', async () => {
		const lines = await tokenize('[ ] Parent\n  [x] Done child');
		assert.deepEqual(scoped(lines[1], CHECKED), ['[x]']);
	});

	it('does not strike through an open subtask of a closed parent', async () => {
		// A closed item's description is struck through. A subtask is not part
		// of that description, and an open one under a checked parent is not
		// done. This was wrong at first: the strikethrough was a contentName
		// on the whole item, which paints everything between begin and end,
		// and TextMate scopes are additive so the subtask could not undo it.
		const lines = await tokenize('[x] Closed parent\n  [ ] Still open');
		assert.deepEqual(scoped(lines[1], STRIKETHROUGH), []);
	});

	it('strikes through a subtask that is closed in its own right', async () => {
		const lines = await tokenize('[x] Closed parent\n  [x] Also done\n    its continuation');
		assert.ok(scoped(lines[1], STRIKETHROUGH).length > 0);
		assert.ok(scoped(lines[2], STRIKETHROUGH).length > 0);
	});

	it('resumes the parent description after a subtask', async () => {
		// Four spaces, not two. Two is a legal subtask indent but not a legal
		// continuation - the spec asks for exactly four spaces, and this fork
		// adds a tab, nothing else.
		const lines = await tokenize('[x] Closed ...\n    [ ] open subtask\n    ... and more description');
		assert.deepEqual(scoped(lines[1], STRIKETHROUGH), []);
		assert.ok(scoped(lines[2], STRIKETHROUGH).length > 0, 'the description should be struck again');
	});

	it('does not continue a description at a subtask indent', async () => {
		// Two spaces nests an item; it does not continue a description.
		const lines = await tokenize('[ ] Item ...\n  ... two spaces is not a continuation -> 2026-01-31');
		assert.deepEqual(scoped(lines[1], DATE), []);
	});
});

describe('title (spec §Title)', () => {
	it('matches a line that does not start with a blank or a bracket', async () => {
		await assertScope('My TODO list', TITLE, 'My TODO list');
		await assertScope('今日は', TITLE, '今日は');
	});

	it('does not match a line starting with a blank character', async () => {
		await assertNoScope(' Todos', TITLE);
		await assertNoScope('    Todos', TITLE);
	});

	it('does not match a line starting with an opening bracket', async () => {
		// Spec: a title "MUST NOT start with a blank character or the
		// opening square bracket character `[`".
		await assertNoScope('[Todos]', TITLE);
	});
});

describe('comment (fork spec v1.2 §Comment)', () => {
	it('matches a comment that opens and closes on one line', async () => {
		await assertScope('<!-- on hold -->', COMMENT, '<!-- on hold -->');
	});

	it('matches a comment that spans lines', async () => {
		const lines = await tokenize('<!--\n[ ] Commented out\n-->\n[ ] Active');
		assert.equal(onlyScoped(lines[0], COMMENT), '<!--');
		assert.equal(onlyScoped(lines[1], COMMENT), '[ ] Commented out');
		assert.equal(onlyScoped(lines[2], COMMENT), '-->');
		assert.deepEqual(scoped(lines[3], COMMENT), []);
	});

	it('hides items inside a comment', async () => {
		const [, second] = await tokenize('<!--\n[ ] Commented out -> 2022-01-31 #tag\n-->');
		assert.deepEqual(scoped(second, CHECKBOX), []);
		assert.deepEqual(scoped(second, DATE), []);
		assert.deepEqual(scoped(second, TAG), []);
	});

	it('resumes normal highlighting after the comment closes', async () => {
		const lines = await tokenize('<!--\nhidden\n-->\n[ ] ! Active -> 2022-01-31 #tag');
		assert.equal(onlyScoped(lines[3], OPEN), '[ ]');
		assert.equal(onlyScoped(lines[3], PRIORITY), '!');
		assert.equal(onlyScoped(lines[3], DATE), '-> 2022-01-31');
		assert.equal(onlyScoped(lines[3], TAG), '#tag');
	});

	it('is not mistaken for a title', async () => {
		await assertNoScope('<!-- on hold -->', TITLE);
	});

	it('keeps blank lines inside the comment', async () => {
		const lines = await tokenize('<!--\n\n-->\nTitle');
		assert.deepEqual(scoped(lines[3], COMMENT), []);
		assert.equal(onlyScoped(lines[3], TITLE), 'Title');
	});

	it('runs to the end of the file when never closed', async () => {
		const lines = await tokenize('<!--\n[ ] Never comes back\nTitle');
		assert.deepEqual(scoped(lines[1], CHECKBOX), []);
		assert.deepEqual(scoped(lines[2], TITLE), []);
	});

	it('does not open when `<!--` is indented', async () => {
		// Spec: `<!--` MUST appear at the beginning of a line.
		const [, second] = await tokenize('Title\n  <!-- not a comment -->');
		assert.deepEqual(scoped(second, COMMENT), []);
	});

	it('does not close when `-->` has trailing text', async () => {
		// Spec: `-->` MUST be followed by nothing other than blank characters.
		const lines = await tokenize('<!--\n--> trailing text\n[ ] Still hidden');
		assert.deepEqual(scoped(lines[2], CHECKBOX), []);
	});

	it('closes when `-->` is followed only by blanks', async () => {
		const lines = await tokenize('<!--\n-->   \n[ ] Active');
		assert.equal(onlyScoped(lines[2], OPEN), '[ ]');
	});

	it('is transparent to grouping', async () => {
		// A comment neither commences nor terminates a group, so the items
		// on either side are still tokenized as ordinary items.
		const lines = await tokenize('[ ] Item 1\n<!-- note -->\n[ ] Item 2');
		assert.equal(onlyScoped(lines[0], OPEN), '[ ]');
		assert.equal(onlyScoped(lines[1], COMMENT), '<!-- note -->');
		assert.equal(onlyScoped(lines[2], OPEN), '[ ]');
	});

	it('ends an item, because a comment may not appear within one', async () => {
		const lines = await tokenize('[ ] Description ...\n<!-- note -->\n    orphaned');
		assert.equal(onlyScoped(lines[1], COMMENT), '<!-- note -->');
		assert.deepEqual(scoped(lines[2], COMMENT), []);
	});
});

describe('scope hygiene', () => {
	it('never emits a scope containing a comma', async () => {
		// TextMate `name` fields are space separated. A comma ends up inside
		// the scope string and breaks theme selectors that target it.
		const lines = await tokenize(await fixture());
		const offenders = new Set();

		for (const line of lines) {
			for (const token of line.tokens) {
				for (const scope of token.scopes) {
					if (scope.includes(',')) offenders.add(scope);
				}
			}
		}

		assert.deepEqual([...offenders], []);
	});

	it('tokenizes the whole reference fixture without collapsing', async () => {
		const lines = await tokenize(await fixture());
		assert.ok(lines.length > 200, 'fixture should be fully tokenized');
		for (const line of lines) {
			if (line.text !== '') assert.ok(line.tokens.length > 0, `no tokens for ${JSON.stringify(line.text)}`);
		}
	});
});

describe('title after a closed item', () => {
	it('is not swallowed as struck-through description', async () => {
		// Regression. The strikethrough rule ended only at a checkbox line, so
		// after a closed item it ran past the blank line and painted the next
		// title as description. TextMate only tests the end of the innermost
		// rule on the stack, so relying on the item to pop it was not enough.
		const lines = await tokenize('[x] Done\n\nA new title\n[ ] Next');
		assert.deepEqual(scoped(lines[2], TITLE), ['A new title']);
		assert.deepEqual(scoped(lines[2], STRIKETHROUGH), []);
		assert.deepEqual(scoped(lines[1], STRIKETHROUGH), [], 'the blank line is not part of the item');
	});

	it('still strikes a real continuation of a closed item', async () => {
		const lines = await tokenize('[x] Done ...\n    ... and struck');
		assert.ok(scoped(lines[1], STRIKETHROUGH).length > 0);
	});
});
