/**
 * The rules a regular expression cannot express.
 *
 * Kept free of the `vscode` module so it can be unit tested; extension.ts
 * turns these into Diagnostics.
 *
 * The one that is a specification MUST: "The due date value MUST be
 * representable by the gregorian calendar." The grammar highlights
 * `-> 2026-02-31` as a perfectly good due date because a regular expression
 * cannot count the days in February. jotaen hits the same wall and says so in
 * his own Sublime source - "it can't enforce valid calendar dates". The
 * knowledge is already here, in src/dueDate.ts, and nothing surfaced it.
 *
 * Severity is deliberately restrained. Only an impossible date is an error.
 * jotaen, in #63: "Marking things as invalid should also be more of a
 * nice-to-have." A todo list that shouts at you is a worse todo list.
 */

import { STATUSES } from './checkbox';
import { commentLines } from './comment';
import { dueDatesOn } from './dueDate';
import { items } from './tree';

export type Severity = 'error' | 'warning' | 'hint';

export interface Problem {
	line: number;
	start: number;
	end: number;
	severity: Severity;
	message: string;
	/** Short, stable, and greppable. Shown beside the message in the Problems panel. */
	code: string;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function lastDayOfMonth(year: number, month: number): number {
	return month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
}

/**
 * A checkbox that was clearly meant to be one and is not.
 *
 * Only where the line opens with a bracket, so ordinary prose that happens to
 * contain brackets is left alone. `f[x]=x` in a description is legal and
 * common - the syntax guide has it as an example.
 */
const NEARLY_A_CHECKBOX = /^\[[^\]\n]{0,3}\]/;

/** Everything worth reporting about a document. */
export function problems(lines: readonly string[]): Problem[] {
	const found: Problem[] = [];
	const parked = commentLines(lines);
	const all = items(lines);

	for (const [line, text] of lines.entries()) {
		if (parked.has(line)) continue;

		// A day the calendar does not have. The grammar cannot check this, and
		// the spec requires it.
		for (const due of dueDatesOn(text)) {
			const { year, month, date } = due.parts;
			if (date === undefined || month === undefined) continue;

			const last = lastDayOfMonth(year, month);
			if (date > last) {
				found.push({
					line,
					start: due.start,
					end: due.end,
					severity: 'error',
					code: 'impossible-date',
					message: `${year}-${String(month).padStart(2, '0')} has ${last} days, so this date does not exist.`,
				});
			}
		}

		// Something shaped like a checkbox that is not one. Reported only when
		// the line is not already a valid item, so this never fires on a line
		// the grammar is happy with.
		if (!all.has(line) && NEARLY_A_CHECKBOX.test(text)) {
			const [match] = NEARLY_A_CHECKBOX.exec(text)!;
			found.push({
				line,
				start: 0,
				end: match.length,
				severity: 'warning',
				code: 'malformed-checkbox',
				message: `A checkbox is exactly three characters: \`[\`, one of \`${STATUSES.join('')}\`, then \`]\`, followed by a space or the end of the line.`,
			});
		}
	}

	// A second due date in an item is legal, and disregarded, which is the
	// part people do not expect. A hint rather than a warning: nothing is
	// wrong, it just does not do what it looks like it does.
	for (const item of all.values()) {
		let seen = false;

		for (let line = item.line; line <= item.endLine; line++) {
			if (parked.has(line)) continue;
			// A nested item's dates are its own.
			if (line !== item.line && all.has(line)) continue;

			for (const due of dueDatesOn(lines[line])) {
				if (seen) {
					found.push({
						line,
						start: due.start,
						end: due.end,
						severity: 'hint',
						code: 'extra-due-date',
						message: 'An item has one due date; spec §Description says any others "MUST be disregarded". This one has no effect.',
					});
				}
				seen = true;
			}
		}
	}

	// An unterminated comment swallows the rest of the file, silently.
	const opened = lines.findIndex((text, line) => parked.has(line) && /^<!--/.test(text));
	if (opened !== -1 && parked.has(lines.length - 1) && !/-->[^\S\n]*$/.test(lines[lines.length - 1])) {
		found.push({
			line: opened,
			start: 0,
			end: 4,
			severity: 'warning',
			code: 'unterminated-comment',
			message: 'This comment is never closed, so everything below it is commented out.',
		});
	}

	return found.sort((a, b) => a.line - b.line || a.start - b.start);
}
