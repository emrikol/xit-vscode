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
 * Those are ordinary tags, so this costs no divergence at all and every other
 * xit tool still reads the file correctly. That is the whole appeal, and the
 * reason not to be tempted into a dedicated syntax for it.
 */

import { Day } from './dueDate';
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
