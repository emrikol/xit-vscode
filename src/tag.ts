/**
 * Tags, and the case rules the specification puts on them.
 *
 * Kept free of the `vscode` module so it can be unit tested, like the rest.
 *
 * Spec §Tag draws a line that is easy to miss and easy to get backwards:
 *
 *   the tag name  "MUST be treated as case-insensitive"
 *   the tag value "MUST be treated as case-sensitive"
 *
 * None of that matters to highlighting, which is why it has never come up. It
 * starts mattering the moment anything groups, filters or counts by tag, so
 * the folding lives here rather than in each caller remembering.
 *
 * As with src/dueDate.ts, the pattern below is a second implementation of a
 * rule the grammar already has, and there is no way to read TextMate tokens
 * from an extension. The duplication is detected rather than avoided:
 * test/tag.test.mjs runs the conformance corpus through both.
 */

import { commentLines } from './comment';
import { directives } from './directive';
import { items } from './tree';

export interface Tag {
	/** Offset of the whole tag on its line, `#` included. */
	start: number;
	end: number;
	/** The tag exactly as written. */
	text: string;
	/** The name as written, without the `#`. */
	name: string;
	/** The name folded for comparison. Two tags are the same tag when these match. */
	key: string;
	/**
	 * The value, with any surrounding quotes removed, or null where there is
	 * none. Case is preserved: the spec says values are case-sensitive.
	 *
	 * An empty value and an absent one are the same thing - "An empty tag
	 * value (e.g. `#tag=` or `#tag=\"\"`) MUST be treated the same as an absent
	 * tag value" - so both give null.
	 */
	value: string | null;
}

/**
 * Mirrors the `tag` rule in syntaxes/xit.tmLanguage.json.
 *
 * Including the lookbehind, which is a deliberate divergence from the spec in
 * its own right - see the grammar's comment and discussion #51.
 */
/**
 * A URL, so its fragment is not read as a tag.
 *
 * The format has no escaping at all, and says so on purpose: the guide's
 * `tags/8`, "Backslashes don't have special meaning, i.e. escaping a quotation
 * is not supported." That is fine until you paste a link:
 *
 *     [ ] Read https://example.com/#top     → `#top` was a tag
 *
 * Most links escape by luck, because `docs#installation` has a letter before
 * the hash and a tag needs a space or punctuation there. A bare fragment after
 * a slash does not.
 *
 * The narrow fix rather than the general one. A backslash escape would be more
 * powerful, would contradict a rule the format states, and would add a
 * character everyone has to think about in every description. This fixes the
 * case that actually happens and asks nobody to learn anything.
 *
 * `scheme://` and then non-space, which is deliberately blunt: the point is to
 * cover the run of text a person would call a link, not to validate one.
 * `#FF8800` in a description is still read as a tag, and that is accepted and
 * documented - it is rare, and it is what the format's own rules say.
 */
const URL = /\b[a-zA-Z][a-zA-Z\d+.-]*:\/\/\S*/g;

/** Half-open offset ranges covered by a URL on `line`. */
function urlRanges(line: string): [number, number][] {
	return [...line.matchAll(URL)].map((match) => [match.index, match.index + match[0].length]);
}

/**
 * An unquoted tag value: everything up to whitespace, minus trailing punctuation.
 *
 * A fork, and a deliberately wide one. Spec §Tag allows only letters, digits,
 * `_` and `-`, which cost two bugs one character at a time - `#repeat=+7d`
 * parsed as `#repeat=` with no value, and `#est=1.5h` as `#est=1`, both in
 * silence. Widening it character by character was the wrong shape of fix.
 *
 * Trailing `.,;:!?)]}` and quotes are trimmed, for exactly the reason the
 * *name* stays narrow: `#tag=value.` ends a sentence, and `(#tag=bar)` is
 * written in prose. The syntax guide pins that behaviour for names in tags/2 -
 * `[ ] This is a #tag.` must give `#tag` - and a value wants the same courtesy.
 *
 * A leading quote is excluded so an unterminated quoted value still falls to
 * the tags/9 rule, "the value is disregarded altogether", rather than being
 * read raw.
 */
const UNQUOTED = String.raw`(?!['"])(?:[^\s]*[^\s.,;:!?)\]}'"])?`;

/**
 * A tag name.
 *
 * Wider than spec §Tag, which allows only letters, digits, `_` and `-`. That
 * set is not merely narrow, it is broken for whole writing systems: `#हिन्दी`
 * gave `#ह`, because Devanagari vowel signs are marks rather than letters.
 * Thai, Arabic diacritics and `#❤️` failed the same way - a variation selector
 * is a mark too. The conformance corpus only exercises Greek, Latin and CJK,
 * none of which use combining marks, which is exactly why it never caught it.
 *
 * So: letters, marks, every numeral, emoji, and the zero-width joiner that
 * holds an emoji sequence like 👨‍👩‍👧 together.
 *
 * `Extended_Pictographic` rather than `\p{S}`, deliberately. `=`, `+`, `<` and
 * `>` are math symbols, and a name that swallowed `=` would end tag values.
 * Punctuation stays out for the reason tags/2 gives: `[ ] This is a #tag.`
 * must end at the tag, or a tag could never end a sentence.
 *
 * A `.` is the one exception, and it is allowed inside a name but never at the
 * end. `#v1.2` used to give `#v1` - silently, which is the shape of bug this
 * whole area keeps producing - and `[ ] This is a #tag.` still ends at the
 * tag. The unquoted value earns the same courtesy the same way.
 */
// The `-` sits last in every class it appears in, or it reads as a range.
const NAME_CHAR = String.raw`\p{L}\p{M}\p{N}\p{Extended_Pictographic}\u200D_`;
const NAME = `[${NAME_CHAR}.-]*[${NAME_CHAR}-]`;

const TAG = new RegExp(
	'(?<=[\\s\\p{P}])'
	+ `#(?<name>${NAME})`
	+ `(?:=(?<value>'[^'\\n]*'|"[^"\\n]*"|${UNQUOTED})?)?`,
	'gu',
);

/**
 * Fold a tag name for comparison.
 *
 * Plain toLowerCase, not the locale-aware form: the spec asks for
 * case-insensitivity, not for the Turkish dotless i, and a locale-dependent
 * answer would make the same file group differently on two machines.
 */
export function foldName(name: string): string {
	return name.toLowerCase();
}

/** Strip a matching pair of quotes, which the spec allows to be `"` or `'`. */
function unquote(value: string): string {
	const first = value[0];
	if ((first === '"' || first === "'") && value.length >= 2 && value.endsWith(first)) {
		return value.slice(1, -1);
	}
	return value;
}

/** Every tag on a line, in order. */
export function tagsOn(line: string): Tag[] {
	const found: Tag[] = [];
	const links = urlRanges(line);

	TAG.lastIndex = 0;
	for (let match = TAG.exec(line); match; match = TAG.exec(line)) {
		// A `#` inside a URL is a fragment, not a tag. See URL above.
		if (links.some(([start, end]) => match!.index >= start && match!.index < end)) continue;

		const name = match.groups!.name;
		const raw = match.groups!.value;
		const value = raw === undefined ? null : unquote(raw);

		found.push({
			start: match.index,
			end: match.index + match[0].length,
			text: match[0],
			name,
			key: foldName(name),
			value: value === '' ? null : value,
		});
	}

	return found;
}

export interface TagAt extends Tag {
	line: number;
	/** Line the item this tag belongs to starts on. */
	item: number;
}

/**
 * Every tag that is inside an item, with the item it belongs to.
 *
 * Tags only mean anything within an item - spec §Description, "The
 * description MAY contain any number of tags" - and the grammar reads them
 * only there. `[ ]#invalid` has no valid checkbox, so it has no description,
 * so the `#invalid` on it is not a tag. Reading a line on its own cannot know
 * that, which is what tagsOn does and why it is not the function to group by.
 */
export function tags(lines: readonly string[]): TagAt[] {
	const found: TagAt[] = [];
	const all = items(lines);

	for (const item of all.values()) {
		for (let line = item.line; line <= item.endLine; line++) {
			// A nested item's tags belong to the nested item, not to this one.
			if (line !== item.line && all.has(line)) continue;
			for (const tag of tagsOn(lines[line])) found.push({ ...tag, line, item: item.line });
		}
	}

	return found.sort((a, b) => a.line - b.line || a.start - b.start);
}

/** Every distinct tag in a document, by folded name, with the values seen for each. */
export interface TagUsage {
	/** How often each spelling of the name was seen, so the common one wins. */
	spellings: Map<string, number>;
	/** Every value the tag was given, unfolded: spec §Tag folds names, not values. */
	values: Set<string>;
}

/**
 * Every tag in a document, by folded name, with its spellings and its values.
 *
 * Richer than `tagIndex` because completion needs two things a set of values
 * cannot give it: which spelling to insert for a name that is written both
 * `#Work` and `#work`, and which values belong to which name.
 */
export function tagUsage(lines: readonly string[]): Map<string, TagUsage> {
	const usage = new Map<string, TagUsage>();
	// Parked work is not work. Completion draws on this, and a `#secret` in a
	// commented-out item was being offered as a tag to use.
	const parked = commentLines(lines);

	// A tag the file declares for itself counts as used. Otherwise the tag on
	// *every* item in a file is the one you cannot autocomplete - and someone
	// who has not read the directive will type it by hand anyway, so they
	// should at least get the spelling the file already uses.
	for (const name of directives(lines).tags) {
		usage.set(name, { spellings: new Map([[name, 1]]), values: new Set<string>() });
	}

	for (const [at, line] of lines.entries()) {
		if (parked.has(at)) continue;
		for (const tag of tagsOn(line)) {
			const found = usage.get(tag.key) ?? { spellings: new Map<string, number>(), values: new Set<string>() };
			found.spellings.set(tag.name, (found.spellings.get(tag.name) ?? 0) + 1);
			if (tag.value !== null) found.values.add(tag.value);
			usage.set(tag.key, found);
		}
	}

	return usage;
}

/**
 * The most common spelling of a folded tag name.
 *
 * Ties are broken by code-unit order, not by `localeCompare`. Two reasons, and
 * the second is the one that matters: an index built from a workspace has no
 * meaningful file order to fall back on, and a locale-aware comparison would
 * make the same workspace suggest a different spelling on another machine.
 * Same reasoning as `foldName` using plain `toLowerCase`.
 */
export function commonSpelling(usage: TagUsage): string {
	return [...usage.spellings.entries()]
		.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][0];
}

/** Every tag in a document, by folded name, with the values it was given. */
export function tagIndex(lines: readonly string[]): Map<string, Set<string>> {
	return new Map([...tagUsage(lines)].map(([key, usage]) => [key, usage.values]));
}
