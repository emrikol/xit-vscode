/**
 * Recording when an item was completed, as a tag.
 *
 * Kept free of the `vscode` module so it can be unit tested.
 *
 * Three separate discussions asked for completion dates - #3, #4 and #59 -
 * and jotaen's answer each time was that the format already allows it by
 * convention rather than by new syntax:
 *
 *   [ ] Paint the room #created=2023-02-01 #completed=2023-03-04
 *
 * Those are ordinary tags. That used to be justified as compatibility - every
 * other xit tool still reads the file - and that reason is gone, because this
 * fork has since changed the format in four other places on purpose.
 *
 * The reason that survives is better. Arrows for what you author, tags for
 * what the tool records: `-> ` due and `<- ` start are what you type to plan,
 * and a completion date is what the editor writes down for you. A tag
 * describes; syntax is for what you author. See the README.
 *
 * The second reason is cost. Adding one character to the status set touched
 * eleven hand-written patterns across the grammar, the TypeScript and a test.
 * Syntax is permanent cost in places that must not drift. A tag is free.
 */

import type { Day } from './dueDate';
import { foldName, tagsOn } from './tag';

/** Spec §Tag: a name is letters, digits, `_` or `-`. */
export function isTagName(name: string): boolean {
	return /^[\p{L}\d_-]+$/u.test(name);
}

/** A calendar day as the spec writes one. */
export function formatDay(day: Day): string {
	const year = Math.floor(day / 10000);
	const month = Math.floor(day / 100) % 100;
	const date = day % 100;
	return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}

/**
 * `text` with the completion tag set to `day`, or removed when `day` is null.
 *
 * Removing is not something anyone asked for, and it is what makes the pair
 * coherent: a completion date on an item that is open again is simply false,
 * the same reasoning that makes the parent cascade run in both directions.
 *
 * Idempotent. Stamping an already-stamped item rewrites the value rather than
 * adding a second tag, which matters because shuffle can pass through checked
 * more than once.
 */
export function stamp(text: string, name: string, day: Day | null): string {
	if (!isTagName(name)) return text;

	const key = foldName(name);
	const existing = tagsOn(text).find((tag) => tag.key === key);

	if (day === null) {
		if (!existing) return text;
		// Take the space in front of the tag with it, or removing one from
		// the middle of a description leaves a double space behind.
		const before = text.slice(0, existing.start).replace(/[^\S\n]+$/, '');
		const after = text.slice(existing.end);
		return (before + (after.startsWith(' ') || after === '' ? '' : ' ') + after).trimEnd();
	}

	const written = `#${name}=${formatDay(day)}`;

	if (existing) return text.slice(0, existing.start) + written + text.slice(existing.end);

	// Appended at the end of the item's first line, after any existing tags.
	// A due date ends at whitespace or punctuation, so a space in front of
	// this is enough to leave one intact.
	return `${text.trimEnd()} ${written}`;
}
