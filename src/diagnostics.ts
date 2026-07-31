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

import { STATUSES, STATUS_CLASS, readCheckbox } from './checkbox';
import { commentLines } from './comment';
import { dueDatesOn } from './dueDate';
import { MARKER, isTitle } from './title';
import { linkProblems } from './link';
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

/**
 * Whether `indent` before a checkbox can neither nest nor continue.
 *
 * Nesting is one tab per level. Four spaces or more is a description
 * continuation, and a line of description that happens to begin with `[ ]` is
 * legal - the syntax guide has exactly that example - so those stay silent.
 *
 * What is left is unambiguous: one to three spaces, or any mix of tabs and
 * spaces in either order. Neither nests, neither continues, and both are
 * almost always a file written when "two or more spaces" still nested. Saying
 * so is what let that rule be tightened without losing anyone's structure.
 *
 * Written out rather than done as one pattern because the mixed case has to
 * hold whichever character comes first, and the regular expression that says
 * that is harder to read than the sentence it stands for.
 */
/**
 * A tag value that opens with a quote, with the rest of the line after it.
 *
 * Whether the quote ever closes is decided in code, because the closing quote
 * has to be the same character as the opening one and a back-reference inside
 * a negated class is not something a regular expression will do for you.
 */
const UNCLOSED_TAG_VALUE = /(?<=[\s\p{P}])(#[\p{L}\d_-]+=)(['"])([^\n]*)$/gu;

/**
 * Exclamation marks after a checkbox that do not form the priority.
 *
 * Group 1 is everything up to them, so the report can point at the marks
 * rather than the whole line. Group 3 distinguishes the two rules: absent
 * means the marks run straight into the description with no space, present
 * means a priority was read and these came after it.
 */
const NOT_A_PRIORITY = new RegExp(
	`^(\\[[${STATUS_CLASS}]\\][^\\S\\n]+)(?:(!+)(?=[^\\s!])|(!+)[^\\S\\n]+(!+)(?=[^\\S\\n]|$))`,
);

function cannotNest(indent: string): boolean {
	if (!indent.includes(' ')) return false;
	if (indent.includes('\t')) return true;
	return indent.length < 4;
}

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

		// An indent that used to nest and no longer does. Reported wherever the
		// line really does hold a checkbox, whether or not it ended up an item,
		// because the point is the indentation rather than the checkbox.
		const checkbox = readCheckbox(text);
		if (checkbox && checkbox.column > 0 && cannotNest(text.slice(0, checkbox.column))) {
			found.push({
				line,
				start: 0,
				end: checkbox.column,
				severity: 'warning',
				code: 'cannot-nest',
				message: 'This indentation does not nest. A subtask is indented by one tab per level; spaces do not nest, and a tab mixed with spaces does not either.',
			});
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
			continue;
		}

		// A tag value opened with a quote and never closed. Spec §Tag, and the
		// guide's tags/9: "If the closing quote is missing (or doesn't match),
		// the value is disregarded altogether." The tag survives, the value
		// vanishes, and nothing says so.
		for (const match of text.matchAll(UNCLOSED_TAG_VALUE)) {
			const [whole, name, quote, rest] = match;
			if (rest.includes(quote)) continue;
			found.push({
				line,
				start: match.index! + name.length,
				end: match.index! + whole.length,
				severity: 'warning',
				code: 'dropped-tag-value',
				message: `This value opens with ${quote} and never closes it, so the whole value is disregarded and only the tag name is kept.`,
			});
		}

		// Exclamation marks that look like a priority and are not. Two rules,
		// both of which turn what you wrote into description text in silence:
		// the guide's priority/5, "If the space between priority and
		// description is missing, the exclamation mark is treated as part of
		// the description", and priority/6, "Any exclamation marks after the
		// priority don't belong to the priority anymore".
		//
		// priority/6 is reported only where the description *begins* with more
		// marks, which is the case that looks like a mistyped priority. Any
		// later `!` is left alone, because "finish this today!" is prose and a
		// diagnostic that fires on prose is a diagnostic people turn off.
		const missed = NOT_A_PRIORITY.exec(text);
		if (missed) {
			const [whole, prefix, noSpace, , extra] = missed;
			const end = missed.index + whole.length;
			found.push({
				line,
				// Point at the marks that do nothing, never at the priority
				// that works. In the second case those are at the very end of
				// the match, which is why this counts back from it.
				start: noSpace ? missed.index + prefix.length : end - extra.length,
				end,
				severity: 'warning',
				code: 'not-a-priority',
				message: noSpace
					? 'A priority needs a space after it, so this is description text rather than a priority.'
					: 'The priority is the first run of exclamation marks only, so these are description text.',
			});
		}

		// A line that is not a comment, not an item, and not a title. Titles
		// are marked in this fork, which is the only reason this state exists
		// at all - before the marker, every one of these was a heading.
		//
		// Column zero only, matching the grammar's `invalid` rule exactly. An
		// indented line is a description continuation, and the two must agree
		// about which lines are wrong or the squiggles and the colours would
		// contradict each other.
		if (text.trim() !== '' && /^\S/.test(text) && !all.has(line) && !isTitle(text)) {
			found.push({
				line,
				start: 0,
				end: text.length,
				severity: 'error',
				code: 'unrecognised-line',
				message: `This is not an item, a title or a comment. A title starts with \`${MARKER} \`; an item starts with a checkbox; a description continues on the next line indented by four spaces or a tab.`,
			});
		}
	}

	// A second due date in an item is legal, and disregarded, which is the
	// part people do not expect. A warning rather than a hint: silent
	// disregard is the worst property a plain-text format can have, because
	// nothing compiles it. You wrote a due date, the file kept it, and nothing
	// uses it. See also `dropped-tag-value` and `not-a-priority` above.
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
						severity: 'warning',
						code: 'extra-due-date',
						message: 'An item has one due date; spec §Description says any others "MUST be disregarded". This one has no effect.',
					});
				}
				seen = true;
			}
		}
	}

	// Broken links between items. Reported rather than repaired: a broken
	// reference is a fact about the file, and guessing which item was meant
	// would be worse than saying so.
	for (const problem of linkProblems(lines)) {
		found.push({
			line: problem.line,
			start: problem.start,
			end: problem.end,
			// A cycle is an error because nothing in it can ever start. The
			// others are warnings: the file still means something, it just
			// does not mean what it looks like.
			severity: problem.kind === 'cycle' ? 'error' : 'warning',
			code: problem.kind,
			message: problem.message,
		});
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
