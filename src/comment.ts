/**
 * Comment blocks, which are a fork of the specification rather than part of
 * it. See the README, and emrikol/xit for the forked spec.
 *
 * Whole lines only: a comment opens with `<!--` at the start of a line and
 * closes with `-->` followed by nothing but blanks. Both may sit on one line.
 * An unterminated comment runs to the end of the file.
 *
 * Everything that reads structure needs this, because a line inside a comment
 * is not a title, not an item and not a due date - it is parked. Kept in one
 * place so the outline and the folding cannot disagree about where a comment
 * is, which they briefly did: `<!-- on hold -->` starts with neither a blank
 * nor `[`, so anything applying the title rule without checking here first
 * reads it as a title.
 */

const OPEN = /^<!--/;
const CLOSE = /-->[^\S\n]*$/;

/** Every line inside a comment block, the markers included. */
export function commentLines(lines: readonly string[]): Set<number> {
	const inside = new Set<number>();
	let open = false;

	for (const [line, text] of lines.entries()) {
		if (!open && OPEN.test(text)) open = true;
		if (open) inside.add(line);
		// Checked after opening, so a comment that starts and ends on one line
		// is one line rather than the rest of the file.
		if (open && CLOSE.test(text)) open = false;
	}

	return inside;
}

export interface CommentBlock {
	start: number;
	end: number;
}

/** Comment blocks as ranges. */
export function commentBlocks(lines: readonly string[]): CommentBlock[] {
	const blocks: CommentBlock[] = [];
	let start: number | null = null;

	for (const [line, text] of lines.entries()) {
		if (start === null && OPEN.test(text)) start = line;

		if (start !== null && CLOSE.test(text)) {
			blocks.push({ start, end: line });
			start = null;
		}
	}

	if (start !== null) blocks.push({ start, end: lines.length - 1 });

	return blocks;
}
