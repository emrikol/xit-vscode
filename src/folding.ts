/**
 * What can be collapsed: items with subtasks, groups, and comment blocks.
 *
 * Kept free of the `vscode` module so it can be unit tested.
 *
 * VS Code folds by indentation on its own, without any provider, and it folds
 * this format wrong. It cannot tell a description continuation from a subtask,
 * and it does not know that a blank line ends an item. It also has no idea
 * what `<!--` means here. All three are things the tree already knows.
 */

import { items } from './tree';
import { commentBlocks, commentLines } from './comment';
import { isTitle } from './title';

export interface Fold {
	/** First line of the range, which stays visible when collapsed. */
	start: number;
	end: number;
	kind: 'item' | 'group' | 'comment';
}

function isBlank(text: string): boolean {
	return text.trim() === '';
}

/** `<!--` … `-->` blocks worth a fold arrow, which is any spanning more than one line. */
function comments(lines: readonly string[]): Fold[] {
	return commentBlocks(lines)
		.filter((block) => block.end > block.start)
		.map((block) => ({ start: block.start, end: block.end, kind: 'comment' as const }));
}

/**
 * A group: consecutive items, optionally headed by a title.
 *
 * Spec §Group. Only offered where a title heads it, because a run of items
 * with no title is already foldable item by item and a second range covering
 * the same lines gives two arrows that do the same thing.
 */
function groups(lines: readonly string[], inComment: (line: number) => boolean): Fold[] {
	const folds: Fold[] = [];
	let title: number | null = null;
	let last: number | null = null;

	const close = () => {
		if (title !== null && last !== null && last > title) folds.push({ start: title, end: last, kind: 'group' });
		title = null;
		last = null;
	};

	for (const [line, text] of lines.entries()) {
		if (inComment(line)) continue;

		if (isBlank(text)) {
			close();
			continue;
		}

		if (title === null && last === null && isTitle(text)) {
			title = line;
			continue;
		}

		// A second title with no blank line between ends the first group.
		if (isTitle(text) && last !== null) {
			close();
			title = line;
			continue;
		}

		last = line;
	}

	close();
	return folds;
}

/** Every range worth offering a fold arrow for. */
export function folds(lines: readonly string[]): Fold[] {
	// Every commented line, not only the ones in a foldable block. A comment
	// opened and closed on one line offers no fold, and is still a comment -
	// missing that read `<!-- on hold -->` as a title heading a group.
	const parked = commentLines(lines);
	const inComment = (line: number) => parked.has(line);

	const itemFolds: Fold[] = [];
	for (const item of items(lines).values()) {
		// Nothing to collapse on an item that occupies one line.
		if (item.endLine > item.line && !inComment(item.line)) {
			itemFolds.push({ start: item.line, end: item.endLine, kind: 'item' });
		}
	}

	return [...comments(lines), ...itemFolds, ...groups(lines, inComment)].sort(
		(a, b) => a.start - b.start || a.end - b.end,
	);
}
