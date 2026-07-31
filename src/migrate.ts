/**
 * Bringing a file written for the older rules up to date.
 *
 * Three forks landed together and each changes what an existing document
 * means. Running three passes over your files would be worse than any of them,
 * so this is one pass:
 *
 *   - nesting became one tab per level, where it used to take two or more
 *     spaces
 *   - titles became marked with `# `, where any unindented line was one
 *   - priority became exclamation marks, where dots padded them for alignment
 *
 * Everything here is a pure function over lines, so it is unit tested in plain
 * Node like the rest of src/. extension.ts is the only part that touches a
 * document.
 *
 * Every transform is idempotent, and there is a test that says so. Migrating
 * twice has to be the same as migrating once, because nobody remembers which
 * files they have already done.
 */

import { STATUS_CLASS, readCheckbox } from './checkbox';
import { commentLines } from './comment';
import { isTitle, markTitle } from './title';

/** A line changed by the migration, for reporting what was touched. */
export interface Change {
	line: number;
	before: string;
	after: string;
}

export interface Migration {
	lines: string[];
	changes: Change[];
}

/**
 * The nesting rule as it was: any indent that is strictly longer than its
 * parent's and starts with it. Kept here, and only here, because the migration
 * is the last thing that needs to know what the old rule meant.
 */
function wasDeeper(inner: string, outer: string): boolean {
	return inner.length > outer.length && inner.startsWith(outer);
}

/**
 * A line that was a title under the old rule: unindented, and not opening with
 * a bracket. Spec §Title, which defined a title by what it was not.
 */
const WAS_A_TITLE = /^[^\s[]/;

/**
 * Something that was meant to be an item and failed.
 *
 * These are deliberately *not* marked as titles. `- [ ] Buy milk` was read as
 * a heading before, which is the bug that marked titles exist to remove;
 * writing `# ` in front of it would preserve the bug forever rather than fix
 * it. Left alone, it becomes an `unrecognised-line` error the next time the
 * file is opened, which is the whole point.
 */
const MEANT_TO_BE_AN_ITEM = /^[^\S\n]*[-*+>]?[^\S\n]*\[[^\]\n]{0,3}\]/;

/** A priority with dot padding, as the old rule allowed. */
const PADDED_PRIORITY = new RegExp(`^(\\[[${STATUS_CLASS}]\\][^\\S\\n]+)((?:!+\\.*)|(?:\\.+!*))(?=[^\\S\\n]|$)`);

/**
 * Space-indented nesting rewritten as one tab per level.
 *
 * Depth cannot be read off the indent on its own - the old rule counted
 * "deeper than the line above", not a fixed width - so this walks the document
 * keeping the stack of open items, exactly as the old reader did, and emits
 * one tab per level of that stack.
 *
 * Continuation lines move with their item: the item's old indent is swapped
 * for its new one and whatever followed it is kept, so a four-space
 * continuation stays four spaces and lands under the description as before.
 */
export function tabIndent(lines: readonly string[]): string[] {
	const parked = commentLines(lines);

	// Open items as [oldIndent, newIndent], shallowest first.
	let stack: [string, string][] = [];

	return lines.map((text, line) => {
		if (parked.has(line)) return text;
		if (text.trim() === '') {
			stack = [];
			return text;
		}

		const checkbox = readCheckbox(text);

		if (!checkbox) {
			// Unindented lines end the nest, as they always did.
			if (!/^[^\S\n]/.test(text)) {
				stack = [];
				return text;
			}

			const item = stack[stack.length - 1];
			if (!item || !text.startsWith(item[0])) return text;
			return item[1] + text.slice(item[0].length);
		}

		const indent = text.slice(0, checkbox.column);
		while (stack.length && !wasDeeper(indent, stack[stack.length - 1][0])) stack.pop();

		const depth = '\t'.repeat(stack.length);
		stack.push([indent, depth]);

		return depth + text.slice(checkbox.column);
	});
}

/** Unmarked titles given their marker. */
export function markTitles(lines: readonly string[]): string[] {
	const parked = commentLines(lines);

	return lines.map((text, line) => {
		if (parked.has(line)) return text;
		if (!WAS_A_TITLE.test(text) || isTitle(text)) return text;
		if (MEANT_TO_BE_AN_ITEM.test(text)) return text;
		return markTitle(text);
	});
}

/**
 * Dot padding removed from priorities.
 *
 * A priority that was only dots had an importance of zero, so removing the
 * dots removes the priority, and the space that separated it goes too.
 */
export function stripPriorityDots(lines: readonly string[]): string[] {
	const parked = commentLines(lines);

	return lines.map((text, line) => {
		if (parked.has(line)) return text;

		const match = PADDED_PRIORITY.exec(text);
		if (!match) return text;

		const [whole, prefix, priority] = match;
		const marks = priority.replace(/\./g, '');
		const rest = text.slice(whole.length);

		// `[ ] ... Do this` becomes `[ ] Do this`: with nothing left of the
		// priority, the separator before the description goes with it.
		return marks ? prefix + marks + rest : prefix.replace(/[^\S\n]+$/, '') + rest;
	});
}

/**
 * Every transform, in the order they have to run.
 *
 * Indentation first: marking titles asks which lines are unindented, and
 * stripping priorities asks which lines start with a checkbox, so both want
 * the indentation already settled.
 */
export function migrate(lines: readonly string[]): Migration {
	const after = stripPriorityDots(markTitles(tabIndent(lines)));

	const changes: Change[] = [];
	for (const [line, before] of lines.entries()) {
		if (after[line] !== before) changes.push({ line, before, after: after[line] });
	}

	return { lines: after, changes };
}
