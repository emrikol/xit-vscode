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
 * A checkbox at the start of a line.
 *
 * The trailing lookahead matters: `[ ]foo` is not an item, because the spec
 * requires a space between the checkbox and whatever follows it.
 */
const CHECKBOX = /^\[([ x@~?])\](?=[^\S\n]|$)/;

/** The status of the item on `line`, or null if the line does not start one. */
export function readStatus(line: string): Status | null {
	const match = CHECKBOX.exec(line);
	return match ? (match[1] as Status) : null;
}

/** `line` with its checkbox set to `status`. Lines without a checkbox are returned unchanged. */
export function writeStatus(line: string, status: Status): string {
	return readStatus(line) === null ? line : `[${status}]${line.slice(3)}`;
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
