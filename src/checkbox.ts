/**
 * Checkbox logic, kept free of the `vscode` module so it can be unit tested.
 *
 * Spec §Checkbox: a checkbox is exactly three characters — `[`, a status
 * character, then `]`.
 */

/** The five statuses defined by [x]it! v1.1. */
export type Status = ' ' | 'x' | '@' | '~' | '?';

export const STATUSES: readonly Status[] = [' ', 'x', '@', '~', '?'];

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
const CHECKBOX = /^([^\S\n]*)\[([ x@~?])\](?=[^\S\n]|$)/;

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
 * Open and in-question items become checked; every other status opens again.
 * This keeps the behaviour the command had before the logic moved here.
 */
export function toggle(status: Status): Status {
	return status === ' ' || status === '?' ? 'x' : ' ';
}

/** Step through every status in a fixed cycle: open → ongoing → obsolete → in question → checked. */
export function shuffle(status: Status): Status {
	switch (status) {
		case ' ': return '@';
		case '@': return '~';
		case '~': return '?';
		case '?': return 'x';
		case 'x': return ' ';
		default: return ' ';
	}
}
