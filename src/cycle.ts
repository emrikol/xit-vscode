/**
 * How long an item took, from the tags that record it.
 *
 * `#created=` and `#done=` were being written and never read: the data was
 * recorded for a report that did not exist. This is the report.
 *
 * Both tags are this fork's own, and both are off by default, so most items
 * have neither and this answers null - which is the common case and must stay
 * cheap and silent.
 *
 * Kept free of the `vscode` module so it can be unit tested, like the rest.
 */

import { type Day, daysBetween } from './dueDate';
import { foldName, tagsOn } from './tag';

/** A date as `stamp` writes one, or null. */
function dayOf(text: string, name: string): Day | null {
	const tag = tagsOn(text).find((each) => each.key === foldName(name));
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tag?.value ?? '');
	return match ? Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]) : null;
}

/**
 * Whole days from when an item was created to when it was finished.
 *
 * Null unless both tags are there and readable. Zero is a real answer - work
 * created and finished the same day - so it is returned rather than folded
 * into null.
 *
 * A negative result is returned as written rather than clamped or hidden. It
 * means the dates disagree with each other, and quietly showing `0` for that
 * would be the same silent tidying this fork keeps removing.
 */
export function cycleTime(text: string, creationTag: string, completionTag: string): number | null {
	const from = dayOf(text, creationTag);
	const to = dayOf(text, completionTag);
	return from === null || to === null ? null : daysBetween(from, to);
}

/** Days as something a person reads at a glance. */
export function formatCycleTime(days: number): string {
	if (days < 0) return `${days} days (the dates disagree)`;
	if (days === 0) return 'same day';
	return days === 1 ? '1 day' : `${days} days`;
}
