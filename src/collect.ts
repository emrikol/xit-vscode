/**
 * A document reduced to the items worth listing elsewhere.
 *
 * Kept free of the `vscode` module so it can be unit tested. The workspace
 * index reads files and calls this; nothing here knows what a file is.
 *
 * Three people built this outside VS Code because it is the hole in a
 * plain-text todo list: kilicbaran a shell script (#12), RoyiAvital an HTML
 * view (#7), NiloCK a whole TUI (#38). NiloCK's reason is the one to keep in
 * mind - his todos were "littered with undone, forgotten [ ] things". Every
 * provider so far answers "what does this file say". This is the first step
 * towards answering "what is due".
 */

import type { Status } from './checkbox';
import { commentLines } from './comment';
import { directives } from './directive';
import { type Day, daysBetween, dueDatesOn, startDatesOn, startOfPeriod } from './dueDate';
import { cycleTime } from './cycle';
import { estimateOn } from './estimate';
import { type Reference, blocked as blockedLines, dependencies } from './link';
import { tags } from './tag';
import { items } from './tree';

export interface Collected {
	line: number;
	/** Depth in the nest, counted from zero. */
	depth: number;
	status: Status;
	/** The description, without the checkbox, the due date or the indentation. */
	description: string;
	/** The due date as written, and the last day of the period it names. */
	due: { text: string; endOfPeriod: Day } | null;
	/** The start date as written, and the first day of the period it names. */
	start: { text: string; startOfPeriod: Day } | null;
	/** Folded tag names, so `#Work` and `#work` are one tag. */
	tags: string[];
	/** How long it is expected to take, in minutes, or null. */
	estimate: number | null;
	/**
	 * Whether it waits on another item that is not finished yet.
	 *
	 * Answered here for references within this file, which is all a pure
	 * function over one document can know. WorkspaceIndex follows the ones
	 * naming another file and sets this again.
	 */
	blocked: boolean;
	/** What it waits on, unresolved. The index needs these to look across files. */
	waitingOn: Reference[];
	/** Whole days from creation to completion, where both were recorded. */
	took: number | null;
	parent: number | null;
	children: number[];
}

/**
 * Every item in a document.
 *
 * Items inside a comment are left out. Parked work is not outstanding work,
 * and a list of what is outstanding should not carry it.
 */
export function collect(
	lines: readonly string[],
	estimateTag = 'est',
	dateTags = { creation: 'created', completion: 'done' },
): Collected[] {
	const parked = commentLines(lines);
	// Tags the file declares about itself, which every item inherits. See
	// src/directive.ts: a work.xit should not need `#work` on every line.
	const inherited = directives(lines).tags;
	const waiting = blockedLines(lines);
	const waitingOn = dependencies(lines);
	const all = items(lines);
	const allTags = tags(lines);

	const depthOf = (line: number): number => {
		let depth = 0;
		let at = all.get(line)!.parent;
		while (at !== null) {
			depth += 1;
			at = all.get(at)!.parent;
		}
		return depth;
	};

	return [...all.values()]
		.filter((item) => !parked.has(item.line))
		.map((item) => {
			const text = item.text;
			const [due] = dueDatesOn(text);
			const [start] = startDatesOn(text);

			// Both arrows are lifted out of the description, so neither is
			// printed twice on the same row. Cut by offset and back to front,
			// because removing the earlier one first would move the later one.
			const from = item.indent.length + 3;
			const cuts = [due, start]
				.filter((date): date is NonNullable<typeof date> => date !== undefined)
				.sort((a, b) => b.start - a.start);

			let body = text.slice(from);
			for (const cut of cuts) body = body.slice(0, cut.start - from) + body.slice(cut.end - from);
			const description = body.replace(/\s+/g, ' ').trim();

			return {
				line: item.line,
				depth: depthOf(item.line),
				status: item.status,
				description,
				due: due ? { text: due.text, endOfPeriod: due.endOfPeriod } : null,
				start: start ? { text: start.text, startOfPeriod: startOfPeriod(start.parts) } : null,
				tags: [...new Set([...inherited, ...allTags.filter((tag) => tag.item === item.line).map((tag) => tag.key)])],
				estimate: estimateOn(text, estimateTag),
				blocked: waiting.has(item.line),
				took: cycleTime(text, dateTags.creation, dateTags.completion),
				waitingOn: waitingOn.filter((each) => each.line === item.line).map((each) => each.on),
				parent: item.parent,
				children: item.children,
			};
		})
		.sort((a, b) => a.line - b.line);
}

/** How urgent an item is, which is what the sidebar groups by. */
export type Urgency = 'critical' | 'overdue' | 'soon' | 'later' | 'none' | 'waiting' | 'notYet' | 'blocked';

/**
 * The urgencies, worst first. The one order, used by everything that ranks.
 *
 * It lived twice - here in the shape the sidebar wanted, and again in
 * src/sort.ts - with nothing checking the two agreed. Two orderings of the
 * same eight values is the sidebar and Sort Group quietly disagreeing about
 * which item is more urgent the moment one of them is edited.
 *
 * The last three are the ones you cannot act on, below everything you can.
 * None is hidden: hiding would lose work, and ranking them by a due date you
 * cannot work towards would put them above things you can. Waiting comes
 * first of the three because someone else is holding it, which is worth
 * seeing; not-yet-started is your own decision and can wait at the bottom.
 */
export const URGENCY_ORDER: readonly Urgency[] = [
	'critical',
	'overdue',
	'soon',
	'later',
	'none',
	'waiting',
	'blocked',
	'notYet',
];

/** What each urgency is called, wherever one is shown to a person. */
export const URGENCY_LABEL: Record<Urgency, string> = {
	critical: 'Critically overdue',
	overdue: 'Overdue',
	soon: 'Due soon',
	later: 'Later',
	none: 'No due date',
	waiting: 'Waiting on someone else',
	blocked: 'Blocked by another item',
	notYet: 'Not started yet',
};

export interface Thresholds {
	today: Day;
	/** Days past the end of a period before it counts as critical. 0 disables the tier. */
	criticalAfterDays: number;
	/** Days ahead within which a date counts as due soon. */
	soonWithinDays: number;
}

/**
 * Where an item belongs in a list ordered by urgency.
 *
 * The same thresholds the editor decorations use, so the sidebar and the
 * editor never disagree about what is late.
 */
export function urgencyOf(item: Collected, thresholds: Thresholds): Urgency {
	// Three tasks converged on one question - what counts as outstanding for
	// an item you cannot act on yet - and this is the single answer all of
	// them use: it is outstanding, and it is sorted below everything you can
	// act on. Hiding it would lose work; ranking it by a due date you cannot
	// work towards would put it above things you can.
	//
	// Waiting comes first because someone else is holding it, which is worth
	// seeing; not-yet-started is your own decision and can wait at the bottom.
	if (item.status === '>') return 'waiting';
	if (item.blocked) return 'blocked';
	if (item.start && item.start.startOfPeriod > thresholds.today) return 'notYet';

	if (!item.due) return 'none';

	const { today, criticalAfterDays, soonWithinDays } = thresholds;
	const days = daysBetween(item.due.endOfPeriod, today);

	// Positive means the period ended that many days ago.
	if (days > 0) {
		return criticalAfterDays > 0 && days >= criticalAfterDays ? 'critical' : 'overdue';
	}

	return -days <= soonWithinDays ? 'soon' : 'later';
}

/** Whether an item is still outstanding. */
export function isOpen(item: Collected): boolean {
	// Checked and obsolete are both finished, for opposite reasons. Ongoing
	// and in-question are not.
	return item.status !== 'x' && item.status !== '~';
}

/**
 * How many outstanding items are overdue, and how many of those are critical.
 *
 * Exported so it can be unit tested without a status bar. The thresholds are
 * read the same way the view and the editor decorations read them, so the
 * three cannot disagree about what is late.
 */
export function overdueCount(files: { items: Collected[] }[], thresholds: Thresholds) {
	let overdue = 0;
	let critical = 0;

	for (const file of files) {
		for (const item of file.items) {
			if (!isOpen(item)) continue;
			const urgency = urgencyOf(item, thresholds);
			if (urgency === 'critical') critical += 1;
			if (urgency === 'critical' || urgency === 'overdue') overdue += 1;
		}
	}

	return { overdue, critical };
}

/**
 * The estimates of everything outstanding in a list, totalled.
 *
 * Returns the total and how many items had no estimate, because a total that
 * quietly leaves things out reads as "this group is six hours" when it is six
 * hours plus however long four unestimated items take. Saying "6h + 4" is
 * honest; saying "6h" is not.
 */
export function totalEstimate(items: readonly Collected[]): { minutes: number; unestimated: number } {
	let minutes = 0;
	let unestimated = 0;

	for (const item of items) {
		if (item.estimate === null) unestimated += 1;
		else minutes += item.estimate;
	}

	return { minutes, unestimated };
}
