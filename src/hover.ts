/**
 * What the editor says about an item when you point at its checkbox.
 *
 * Kept free of the `vscode` module so it can be unit tested, like the rest of
 * src/. This builds the Markdown; extension.ts wraps it in a MarkdownString
 * and marks it trusted, which is what makes the `command:` links live.
 *
 * Two things at once, and the second is the reason the first is worth having.
 *
 * A hover that only offered a status menu would be a popup firing whenever the
 * mouse crossed the left margin of a todo file, which is most of a todo file.
 * This one answers "why is this item where it is": the sidebar has always
 * known an item's urgency, its estimate, how long it took and what is holding
 * it up, and the editor - where you actually do the work - showed none of it.
 *
 * The status row rides along. VS Code gives an extension no click handler for
 * editor text, so pointing at a checkbox and choosing is as close to "click
 * the box" as the API allows; a DocumentLink would need Cmd+click and would
 * underline every checkbox in the file.
 */

import { type Status, STATUSES } from './checkbox';
import { type Collected, type Urgency, URGENCY_LABEL } from './collect';
import { formatCycleTime } from './cycle';
import { type Day, daysBetween } from './dueDate';
import { formatEstimate } from './estimate';
import { foldName, tagsOn } from './tag';

/**
 * What each status is called.
 *
 * `Record<Status, string>` rather than a plain object, so adding a status to
 * checkbox.ts fails to compile here rather than showing a blank label. That is
 * the cheapest drift detector available - the compiler - and it is only
 * possible because Status is a union rather than a string.
 */
export const STATUS_LABEL: Record<Status, string> = {
	' ': 'Open',
	'@': 'Ongoing',
	'>': 'Waiting',
	'~': 'Obsolete',
	'?': 'In question',
	x: 'Checked',
};

/** Something this item waits on, already resolved by the caller. */
export interface Blocker {
	/** The blocking item's description, or its id where there is nothing else to show. */
	label: string;
	/** Where it lives, for a link. Null when the reference does not resolve. */
	target: { uri: string; line: number } | null;
	/** Whether it is still outstanding. A finished blocker is worth naming and not worth worrying about. */
	open: boolean;
}

export interface HoverInput {
	item: Collected;
	urgency: Urgency;
	today: Day;
	blockers: readonly Blocker[];
	/** This item's own position, which the status links have to carry. */
	target: { uri: string; line: number };
	/**
	 * Tag names the hover restates in words, cut from the description.
	 *
	 * Otherwise the panel says `#est=30m` in the description and `Estimated
	 * 30m` two lines below it, which is the same fact twice in one popup.
	 * src/outline.ts made the same call for the two date arrows and for the
	 * same reason; these are the tags with a rendered meaning rather than a
	 * label you chose.
	 *
	 * Names rather than a fixed list, because every one of them is a setting.
	 */
	explained: readonly string[];
	/** This item's own id, where it has one. */
	id: string | null;
}

/**
 * Text that will not be read as Markdown.
 *
 * A description is prose someone typed, and `[ ] Buy *milk*` should say what
 * it says rather than turning half of it italic.
 */
export function escapeMarkdown(text: string): string {
	return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}

/** A count of days, said the way a person would. */
function days(count: number): string {
	return count === 1 ? '1 day' : `${count} days`;
}

/**
 * Why the item sits where it does in the sidebar, in a few words.
 *
 * The urgency label alone answers "which group", and the interesting part is
 * usually "by how much" - `Overdue` and `Overdue by 3 months` are different
 * problems.
 */
export function describeUrgency(item: Collected, urgency: Urgency, today: Day): string {
	const label = URGENCY_LABEL[urgency];

	if (urgency === 'notYet' && item.start) {
		const until = -daysBetween(item.start.startOfPeriod, today);
		return until > 0 ? `${label}, for another ${days(until)}` : label;
	}

	if (!item.due) return label;

	// Positive means the period ended that many days ago, which is the same
	// sense urgencyOf uses.
	const late = daysBetween(item.due.endOfPeriod, today);

	if (urgency === 'critical' || urgency === 'overdue') return `${label} by ${days(late)}`;
	if (urgency === 'soon' || urgency === 'later') {
		return late === 0 ? `${label}, the period ends today` : `${label}, in ${days(-late)}`;
	}

	return label;
}

/** The `command:` URI that sets this item to a status. */
function setStatusLink(target: { uri: string; line: number }, status: Status): string {
	const argument = encodeURIComponent(JSON.stringify([{ ...target, status }]));
	return `command:xit.setStatus?${argument}`;
}

/**
 * The row of statuses, with the current one shown but not linked.
 *
 * Not linking it is the point: "set this to what it already is" is not an
 * offer, and leaving it in place keeps the row the same width whichever status
 * you are looking at, so the one you want does not move between hovers.
 */
export function statusRow(item: Collected, target: { uri: string; line: number }): string {
	return STATUSES.map((status) => {
		const shown = `\`[${status === ' ' ? ' ' : status}]\``;
		const label = STATUS_LABEL[status];
		if (status === item.status) return `${shown} **${label}**`;
		return `[${shown} ${label}](${setStatusLink(target, status)} "Set to ${label}")`;
	}).join(' ');
}

/**
 * A description with the named tags cut out of it.
 *
 * Cut by offset and back to front, because removing an earlier tag would move
 * every later one. The same technique src/outline.ts and src/collect.ts use to
 * lift the date arrows out.
 */
export function withoutTags(description: string, names: readonly string[]): string {
	const unwanted = new Set(names.map(foldName));

	// Padded, and every offset moved back by one to compensate. The tag
	// pattern requires whitespace or punctuation before the hash - `tags/1`,
	// so that `a#b` is not a tag - and a description is a line with its
	// checkbox already cut off, which takes that whitespace with it. Without
	// the pad, `[ ] #est=30m` kept its tag while `[ ] Draft #est=30m` lost it.
	const cuts = tagsOn(` ${description}`)
		.filter((tag) => unwanted.has(tag.key))
		.map((tag) => ({ start: tag.start - 1, end: tag.end - 1 }))
		.sort((a, b) => b.start - a.start);

	let body = description;
	for (const cut of cuts) body = body.slice(0, cut.start) + body.slice(cut.end);

	return body.replace(/\s+/g, ' ').trim();
}

/** The whole hover, as Markdown. */
export function hoverMarkdown(input: HoverInput): string {
	const { item, urgency, today, blockers, target, explained, id } = input;
	const parts: string[] = [];

	parts.push(`**${STATUS_LABEL[item.status]}** — ${escapeMarkdown(describeUrgency(item, urgency, today))}`);

	const description = withoutTags(item.description, explained);
	if (description) parts.push(escapeMarkdown(description));

	// The facts the sidebar has always shown and the editor never did. Dates as
	// written rather than reformatted, so what you read here is what you would
	// search the file for.
	const facts: string[] = [];
	if (item.start) facts.push(`Not before \`${item.start.text.slice(3)}\``);
	if (item.due) facts.push(`Due \`${item.due.text.slice(3)}\``);
	if (item.estimate !== null) facts.push(`Estimated ${formatEstimate(item.estimate)}`);
	if (item.took !== null) facts.push(`Took ${formatCycleTime(item.took)}`);
	// Shown rather than cut, because an id is the one machine tag you have a
	// reason to read: it is what you write in another item's `#after=`.
	if (id) facts.push(`Id \`${id}\``);
	if (facts.length) parts.push(facts.join(' · '));

	for (const blocker of blockers) {
		const name = escapeMarkdown(blocker.label);
		const shown = blocker.target ? `[${name}](${blocker.target.uri}#L${blocker.target.line + 1})` : name;
		// A finished blocker is not holding anything up. Saying so is more use
		// than leaving it out, because the reference is still written on the
		// line and its absence here would read as a parsing failure.
		parts.push(blocker.open ? `Waiting on ${shown}` : `Was waiting on ${shown}, which is done`);
	}

	parts.push('---');
	parts.push(statusRow(item, target));

	return parts.join('\n\n');
}
