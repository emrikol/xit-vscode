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
import { Day, daysBetween, dueDatesOn } from './dueDate';
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

			const from = item.indent.length + 3;
			const body = text.slice(from);
			const description = (due
				? body.slice(0, due.start - from) + body.slice(due.end - from)
				: body
			).replace(/\s+/g, ' ').trim();

			return {
				line: item.line,
				depth: depthOf(item.line),
				status: item.status,
				description,
				due: due ? { text: due.text, endOfPeriod: due.endOfPeriod } : null,
				tags: [...new Set(allTags.filter((tag) => tag.item === item.line).map((tag) => tag.key))],
				parent: item.parent,
				children: item.children,
			};
		})
		.sort((a, b) => a.line - b.line);
}

/** How urgent an item is, which is what the sidebar groups by. */
export type Urgency = 'critical' | 'overdue' | 'soon' | 'later' | 'none';

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
