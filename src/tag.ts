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
const TAG = new RegExp(
	'(?<=[\\s\\p{P}])'
	+ '#(?<name>[\\p{L}\\d_-]+)'
	+ '(?:=(?<value>\'[^\'\\n]*\'|"[^"\\n]*"|[\\p{L}\\d_-]+)?)?',
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

	TAG.lastIndex = 0;
	for (let match = TAG.exec(line); match; match = TAG.exec(line)) {
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
export function tagIndex(lines: readonly string[]): Map<string, Set<string>> {
	const index = new Map<string, Set<string>>();

	for (const line of lines) {
		for (const tag of tagsOn(line)) {
			const values = index.get(tag.key) ?? new Set<string>();
			if (tag.value !== null) values.add(tag.value);
			index.set(tag.key, values);
		}
	}

	return index;
}
