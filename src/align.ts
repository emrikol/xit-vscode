/**
 * Lining up the priority marks in a column, without putting them in the file.
 *
 * The specification pads a priority with dots so the exclamation marks align:
 *
 *     [ ] ...! Low
 *     [ ] ..!! Medium
 *     [ ] !!!! Urgent
 *
 * This fork dropped the dots, because that is presentation stored in the
 * document and three of the syntax guide's seven priority rules existed only
 * to police it. Alignment is a rendering job, so it is done by rendering.
 *
 * Off by default, and the reason is worth keeping: **Sort Group** answers
 * "which of these is most urgent" definitively, and a column only helps you
 * eyeball it. The dots existed because plain text had no alternative; the
 * alternative turned out to be sorting rather than drawing. This is here for
 * when you want the shape of a list at a glance without reordering it.
 *
 * Kept free of the `vscode` module so it can be unit tested, like the rest.
 */

import { priorityOf, readCheckbox } from './checkbox';
import { commentLines } from './comment';

export interface Padding {
	line: number;
	/** Column the priority starts at, which is where the padding is drawn. */
	column: number;
	/** Spaces to draw before it. Never zero: the widest item in a group needs none. */
	pad: number;
}

/**
 * Where to draw padding so every priority in a group ends in the same column.
 *
 * A group is consecutive non-blank lines, the same unit the format already has
 * and the same one Sort Group works on. Aligning across a whole file would
 * make one urgent item indent everything below it, which is worse than not
 * aligning at all.
 *
 * Items with no priority are left alone rather than padded to match. Padding a
 * line that has nothing to align would indent the description of every
 * ordinary item in the group, which is a lot of movement to line up a few
 * marks.
 */
export function alignments(lines: readonly string[]): Padding[] {
	const parked = commentLines(lines);
	const found: Padding[] = [];

	let group: { line: number; column: number; width: number }[] = [];

	const flush = () => {
		const widest = Math.max(0, ...group.map((each) => each.width));
		for (const each of group) {
			if (each.width < widest) found.push({ line: each.line, column: each.column, pad: widest - each.width });
		}
		group = [];
	};

	for (const [line, text] of lines.entries()) {
		if (text.trim() === '') {
			flush();
			continue;
		}
		if (parked.has(line)) continue;

		const width = priorityOf(text);
		if (width === 0) continue;

		const checkbox = readCheckbox(text);
		if (!checkbox) continue;

		// The priority starts after the checkbox and whatever spaces follow it.
		const after = checkbox.column + 3;
		const column = after + (/^[^\S\n]*/.exec(text.slice(after))?.[0].length ?? 0);
		group.push({ line, column, width });
	}

	flush();
	return found;
}
