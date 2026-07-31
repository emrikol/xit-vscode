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
import { directiveProblems } from './directive';
import { parseEstimate } from './estimate';
import { parseInterval } from './repeat';
import { foldName, tagsOn } from './tag';
import { dueDatesOn, startDatesOn, startOfPeriod } from './dueDate';
import { MARKER, isTitle } from './title';
import { linkProblems } from './link';
import { items } from './tree';
import { lastDayOfMonth } from './calendar';

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

/** A date as `stamp` writes one, and as the calendar allows. */
function isDay(value: string | null): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
	if (!match) return false;

	const [, year, month, date] = match.map(Number);
	return month >= 1 && month <= 12 && date >= 1 && date <= lastDayOfMonth(year, month);
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

/**
 * The tags this fork gives meaning to, by their configured names.
 *
 * Passed in rather than read from settings, so this module stays pure and so a
 * renamed tag is still checked. Defaults match the manifest.
 */
export interface KnownTags {
	repeat: string;
	estimate: string;
	completion: string;
	creation: string;
}

export const DEFAULT_TAGS: KnownTags = {
	repeat: 'repeat',
	estimate: 'est',
	completion: 'done',
	creation: 'created',
};

/**
 * A value this fork gives meaning to, and cannot make sense of.
 *
 * The whole point of the four reports above is that silent disregard is the
 * worst property a plain-text format can have. These features were built with
 * exactly that flaw: `#repeat=sometimes` never repeats and `#est=2hrs` is
 * counted as unestimated, both without a word. `#after=` already reported an
 * unknown id, so the codebase disagreed with itself about this.
 *
 * A warning rather than an error. The file still means something; the tag just
 * does not do what it looks like it does.
 */
function unrecognisedValue(
	text: string,
	name: string,
	valid: (value: string | null) => boolean,
	expected: string,
): Problem[] {
	const key = foldName(name);

	return (
		tagsOn(text)
			// An absent value is an absent tag - spec §Tag - so `#repeat` on its
			// own is someone writing a plain tag, not a broken interval.
			.filter((tag) => tag.key === key && tag.value !== null && !valid(tag.value))
			.map((tag) => ({
				line: 0,
				start: tag.start,
				end: tag.end,
				severity: 'warning' as const,
				code: 'unrecognised-value',
				message: `\`${tag.value}\` is not something \`#${name}\` understands, so it does nothing. ${expected}`,
			}))
	);
}

/** Everything worth reporting about a document. */
export function problems(lines: readonly string[], known: KnownTags = DEFAULT_TAGS): Problem[] {
	const found: Problem[] = [];
	const parked = commentLines(lines);
	const all = items(lines);

	for (const [line, text] of lines.entries()) {
		if (parked.has(line)) continue;

		// A day the calendar does not have. The grammar cannot check this, and
		// the spec requires it. Both arrows: a start date is the same value
		// behind a different arrow, and `<- 2026-02-31` was going unreported
		// while `-> 2026-02-31` was caught.
		for (const due of [...dueDatesOn(text), ...startDatesOn(text)]) {
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
				message:
					'This indentation does not nest. A subtask is indented by one tab per level; spaces do not nest, and a tab mixed with spaces does not either.',
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

		// A value this fork gives meaning to and cannot read. Built with the
		// very flaw the reports above exist to remove.
		for (const [name, valid, expected] of [
			[
				known.repeat,
				(value: string | null) => parseInterval(value) !== null,
				'Intervals are daily, weekly, monthly, quarterly, yearly, weekdays, a named day such as monday, or a count such as 3d, 2w or 6m, optionally prefixed with + to count from when it was checked.',
			],
			[
				known.estimate,
				(value: string | null) => parseEstimate(value) !== null,
				'An estimate is a number and a unit: 30m, 2h, 1.5h, 1d or 1w.',
			],
			[known.completion, isDay, 'A date is written YYYY-MM-DD.'],
			[known.creation, isDay, 'A date is written YYYY-MM-DD.'],
		] as [string, (value: string | null) => boolean, string][]) {
			for (const problem of unrecognisedValue(text, name, valid, expected)) {
				found.push({ ...problem, line });
			}
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
				start: match.index + name.length,
				end: match.index + whole.length,
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
		// Column zero only, matching the grammar's `invalid` rule. An indented
		// line is a description continuation.
		//
		// The two do not agree line for line, and the comment here used to
		// claim they did: `[ x] Typo` is `invalid` to the grammar and
		// `malformed-checkbox` here, which is a more specific message rather
		// than a contradiction. What holds - and what test/drift.test.mjs
		// checks, rather than anyone asserting it - is that every line the
		// grammar refuses to colour is a line this objects to, by whichever
		// name fits best.
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

	// A window the calendar cannot satisfy: may not begin until after it is
	// due. Postpone used to be able to create this; it no longer can, so what
	// is left is only what a person can write by hand - still worth saying.
	for (const [line, text] of lines.entries()) {
		if (parked.has(line)) continue;

		const [due] = dueDatesOn(text);
		const [start] = startDatesOn(text);
		if (!due || !start || startOfPeriod(start.parts) <= due.endOfPeriod) continue;

		found.push({
			line,
			// The start date, because the due date is usually the one that is
			// right and the start is the one that was mistyped.
			start: start.start,
			end: start.end,
			severity: 'warning',
			code: 'starts-after-due',
			message: 'This item cannot begin until after it is due.',
		});
	}

	// The same for a second start date. `startDatesOn` takes the first and
	// drops the rest exactly as due dates do, so the silence was identical
	// and only the report was missing.
	for (const item of all.values()) {
		let seen = false;

		for (let line = item.line; line <= item.endLine; line++) {
			if (parked.has(line)) continue;
			if (line !== item.line && all.has(line)) continue;

			for (const start of startDatesOn(lines[line])) {
				if (seen) {
					found.push({
						line,
						start: start.start,
						end: start.end,
						severity: 'warning',
						code: 'extra-start-date',
						message: 'An item has one start date; any others are disregarded. This one has no effect.',
					});
				}
				seen = true;
			}
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
						message:
							'An item has one due date; spec §Description says any others "MUST be disregarded". This one has no effect.',
					});
				}
				seen = true;
			}
		}
	}

	// A directive that does nothing. A known key that cannot use its value is
	// the same failure as `#repeat=sometimes`; an unknown key is a hint,
	// because ignoring it is deliberate and a typo is indistinguishable from a
	// key a later version will understand.
	for (const problem of directiveProblems(lines)) {
		found.push({
			line: problem.line,
			start: problem.start,
			end: problem.end,
			severity: problem.kind === 'value' ? 'warning' : 'hint',
			code: problem.kind === 'value' ? 'unrecognised-value' : 'unknown-directive',
			message:
				problem.kind === 'value'
					? `\`${problem.key}\` cannot use that value, so this directive does nothing.`
					: `\`${problem.key}\` is not a directive this version understands, so it is ignored. That is deliberate - a directive written for a later version must not break an earlier one - but check the spelling.`,
		});
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
