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

import { Status } from './checkbox';
import { commentLines } from './comment';
import { Day, daysBetween, dueDatesOn, startDatesOn, startOfPeriod } from './dueDate';
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
	parent: number | null;
	children: number[];
}

/**
 * Every item in a document.
 *
 * Items inside a comment are left out. Parked work is not outstanding work,
 * and a list of what is outstanding should not carry it.
 */
export function collect(lines: readonly string[]): Collected[] {
	const parked = commentLines(lines);
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
			const text = lines[item.line];
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
				tags: [...new Set(allTags.filter((tag) => tag.item === item.line).map((tag) => tag.key))],
				parent: item.parent,
				children: item.children,
			};
		})
		.sort((a, b) => a.line - b.line);
}

/** How urgent an item is, which is what the sidebar groups by. */
export type Urgency = 'critical' | 'overdue' | 'soon' | 'later' | 'none' | 'waiting' | 'notYet';

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
