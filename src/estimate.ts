/**
 * How long an item is expected to take, as a tag.
 *
 * `#est=2h`. A tag rather than syntax, by the rule in the README: syntax is
 * for what you author and tags are for what the tool records - and an estimate
 * is authored, so that rule alone would allow an arrow. What decides it is
 * cost. Adding one character to the status set touched eleven hand-written
 * patterns across the grammar, the TypeScript and a test; a tag costs nothing,
 * because the tag rule already matches anything you invent. An estimate is not
 * a date and pairs with no existing arrow, so it buys none of that back.
 *
 * Deliberately not `parseInterval` from src/repeat.ts, and they are not
 * duplicates: `m` means months there and minutes here, which is the whole
 * reason an estimate needs its own grammar rather than a drift detector.
 *
 * Kept free of the `vscode` module so it can be unit tested, like the rest.
 */

import { tagsOn } from './tag';

/**
 * Minutes in a working day and a working week.
 *
 * Eight hours and five days, which is a judgement rather than a fact. It only
 * affects how `1d` and `1w` are totalled, and any answer here is a convention;
 * this is the common one, and it is written down rather than buried.
 */
const HOUR = 60;
const DAY = 8 * HOUR;
const WEEK = 5 * DAY;

const UNITS: Record<string, number> = { m: 1, h: HOUR, d: DAY, w: WEEK };

/** `1.5h`, `30m`, `2d`. A number, then one unit letter, and nothing else. */
const ESTIMATE = /^(\d+(?:\.\d+)?)([mhdw])$/i;

/**
 * The estimate a value expresses, in minutes, or null if it is not one.
 *
 * Null rather than a guess, for the same reason an unrecognised repeat
 * interval does nothing: a total built partly from misread values is worse
 * than a total that admits it is missing something.
 */
export function parseEstimate(value: string | null): number | null {
	if (!value) return null;

	const match = ESTIMATE.exec(value);
	if (!match) return null;

	const minutes = Number(match[1]) * UNITS[match[2].toLowerCase()];
	return minutes > 0 ? minutes : null;
}

/** The estimate on a line, if it carries one. */
export function estimateOn(text: string, tagName: string): number | null {
	const key = tagName.toLowerCase();
	const tag = tagsOn(text).find((found) => found.key === key);
	return tag ? parseEstimate(tag.value) : null;
}

/**
 * Minutes as something a person reads at a glance: `6h`, `1h 30m`, `2d 4h`.
 *
 * Days only above a week's worth, because "3d 2h" is harder to judge than
 * "26h" for anything you might do this week, and easier for anything you
 * would not.
 */
export function formatEstimate(minutes: number): string {
	if (minutes < HOUR) return `${Math.round(minutes)}m`;

	if (minutes < WEEK) {
		const hours = Math.floor(minutes / HOUR);
		const rest = Math.round(minutes % HOUR);
		return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
	}

	const days = Math.floor(minutes / DAY);
	const hours = Math.round((minutes % DAY) / HOUR);
	return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}
