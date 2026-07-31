/**
 * Checkbox logic, kept free of the `vscode` module so it can be unit tested.
 *
 * Spec §Checkbox: a checkbox is exactly three characters — `[`, a status
 * character, then `]`.
 */

/**
 * The five statuses defined by [x]it! v1.1, and one of this fork's own.
 *
 * `>` is waiting: the item should happen, you cannot act on it, and someone or
 * something else holds it. None of the five covers that. `@` ongoing means you
 * are doing it; `?` in question means it is unclear the thing should happen at
 * all. Status is the primary axis of the format - it is why the checkbox is
 * the leftmost thing on the line - and waiting gates what you can do, which is
 * what a status is for. A tag would describe it; only a status gates it.
 *
 * `>` rather than any other character, and the choice is measured. The syntax
 * guide names its invalid examples: `[*]`, `[o]`, `[X]`, and `[ ]` with a
 * non-breaking space. `>` is not among them, so no example in the conformance
 * corpus changes meaning. `*` or `o` would each have flipped one from invalid
 * to valid. It collides with nothing - priority uses `!` and `.`, and the
 * due-date arrow is unambiguous inside brackets - and it reads as handed off.
 */
export type Status = ' ' | 'x' | '@' | '~' | '?' | '>';

export const STATUSES: readonly Status[] = [' ', 'x', '@', '~', '?', '>'];

/**
 * The statuses as the body of a regular-expression character class.
 *
 * This is the source of truth for every status pattern in the TypeScript. It
 * used to be written out by hand in four places here and seven more in the
 * grammar, with nothing checking that the eleven agreed, which made adding a
 * status an eleven-file edit whose failure mode was silent and partial: a
 * status the grammar knew and repeat.ts did not.
 *
 * The grammar is static JSON and cannot import this, so those seven stay
 * literal and test/checkbox.test.mjs compares them against STATUSES instead -
 * the house pattern for duplication that cannot be removed.
 *
 * Escaped for the characters a class treats specially, none of which is a
 * status today. That is the point: it stays correct if one becomes one.
 */
export const STATUS_CLASS = STATUSES.map((status) => status.replace(/[\\\]^-]/g, '\\$&')).join('');

/**
 * A checkbox, with whatever indentation precedes it.
 *
 * The trailing lookahead matters: `[ ]foo` is not an item, because the spec
 * requires a space between the checkbox and whatever follows it.
 *
 * The leading indentation is this fork's subtasks (discussion #2). It is
 * deliberately more permissive here than in the grammar, which asks for two
 * spaces or a tab and an item above to nest under. Highlighting has to be
 * strict about that, because it is describing the format. A command does not:
 * toggling a checkbox the grammar declined to colour is harmless, and
 * refusing to would be baffling.
 */
const CHECKBOX = new RegExp(`^([^\\S\\n]*)\\[([${STATUS_CLASS}])\\](?=[^\\S\\n]|$)`);

export interface Checkbox {
	/** Column the `[` sits at, which is the width of the indentation before it. */
	readonly column: number;
	readonly status: Status;
}

/** The checkbox on `line`, or null if there is not one. */
export function readCheckbox(line: string): Checkbox | null {
	const match = CHECKBOX.exec(line);
	return match ? { column: match[1].length, status: match[2] as Status } : null;
}

/** The status of the item on `line`, or null if the line does not hold one. */
export function readStatus(line: string): Status | null {
	return readCheckbox(line)?.status ?? null;
}

/** `line` with its checkbox set to `status`. Lines without a checkbox are returned unchanged. */
export function writeStatus(line: string, status: Status): string {
	const checkbox = readCheckbox(line);
	if (!checkbox) return line;

	// Spliced around the checkbox rather than rebuilt from its start, so a
	// subtask keeps the indentation that makes it one.
	return line.slice(0, checkbox.column) + `[${status}]` + line.slice(checkbox.column + 3);
}

/**
 * Open, in-question and waiting items become checked; every other status opens
 * again. Waiting joins the first group because the thing you do to a waiting
 * item when it stops waiting is finish it.
 */
export function toggle(status: Status): Status {
	return status === ' ' || status === '?' || status === '>' ? 'x' : ' ';
}

/**
 * Step through every status in a fixed cycle:
 * open → ongoing → waiting → obsolete → in question → checked.
 *
 * Waiting sits after ongoing so the three you can still act on, or are
 * waiting to act on, stay together at the front of the cycle.
 */
export function shuffle(status: Status): Status {
	switch (status) {
		case ' ': return '@';
		case '@': return '>';
		case '>': return '~';
		case '~': return '?';
		case '?': return 'x';
		case 'x': return ' ';
		default: return ' ';
	}
}

/**
 * The priority of an item: how many exclamation marks it carries, or zero.
 *
 * A second implementation of a rule the grammar already has, like the due date
 * and the tag before it, and for the same reason - VS Code offers no way to
 * read TextMate tokens from an extension. The duplication is detected rather
 * than avoided: test/checkbox.test.mjs runs the conformance corpus through both
 * and fails if they disagree about a single line.
 *
 * The dots the specification allows are gone from this fork; priority is
 * exclamation marks. See the README.
 */
const PRIORITY = new RegExp(`^[^\\S\\n]*\\[[${STATUS_CLASS}]\\][^\\S\\n]+(!+)(?=[^\\S\\n]|$)`);

export function priorityOf(line: string): number {
	return PRIORITY.exec(line)?.[1].length ?? 0;
}
