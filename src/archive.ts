/**
 * Moving finished items out of the way.
 *
 * This is the specific reason a plain-text todo file rots: the completed work
 * never leaves, so the file slowly becomes an archive nobody reads, and the
 * three things you actually have to do are somewhere in the middle of it.
 *
 * Items move to a group at the end of the same file rather than to a separate
 * `done.xit`. That is a deliberate choice and it gives something up - the file
 * still grows - in exchange for the property every destructive command here
 * has: it is one edit in one document, so the editor's own undo puts it back
 * exactly. Nothing reaches a second file that the user cannot take back with a
 * keystroke.
 *
 * Kept free of the `vscode` module so it can be unit tested, like the rest.
 */

import { commentLines } from './comment';
import { directives } from './directive';
import { isTitle, markTitle, titleText } from './title';
import { Item, items } from './tree';

export interface Archived {
	lines: string[];
	/** How many items were moved, for a message that says what happened. */
	moved: number;
}

/** Finished, for either reason: it was done, or it never will be. */
function isFinished(item: Item): boolean {
	return item.status === 'x' || item.status === '~';
}

/**
 * Whether an item can be archived: finished, and with nothing outstanding
 * beneath it.
 *
 * A checked parent with an open subtask is not finished, whatever its own
 * checkbox says, and filing it away would hide work. The auto-check exists to
 * stop that state arising; this refuses to trust that it always did.
 */
function isArchivable(item: Item, all: Map<number, Item>): boolean {
	if (!isFinished(item)) return false;
	return item.children.every((child) => isArchivable(all.get(child)!, all));
}

/**
 * `lines` with every finished item moved under a title at the end.
 *
 * Idempotent: items already under the archive title are left where they are,
 * so running this twice does nothing the second time.
 */
export function archive(lines: readonly string[], title: string): Archived {
	const all = items(lines);
	const parked = commentLines(lines);

	// A file may name its own archive group, which beats the setting: the
	// setting is one answer for every file, and this is the file's answer for
	// itself. See src/directive.ts.
	const declared = directives(lines).archive;
	if (declared !== null) title = declared;

	// Where the archive already starts, if it does. Everything from there on
	// is left untouched, which is what makes this idempotent.
	const heading = markTitle(title);
	const existing = lines.findIndex((text, line) =>
		!parked.has(line) && isTitle(text) && titleText(text) === titleText(heading));
	const boundary = existing === -1 ? lines.length : existing;

	const moving = new Set<number>();
	for (const item of all.values()) {
		if (item.line >= boundary || parked.has(item.line)) continue;
		// Only whole top-level items. A finished subtask of an unfinished
		// parent stays where it is: it is part of work still in progress.
		if (item.parent !== null && all.has(item.parent) && all.get(item.parent)!.line < boundary) continue;
		if (!isArchivable(item, all)) continue;

		for (let at = item.line; at <= item.endLine; at++) moving.add(at);
	}

	if (moving.size === 0) return { lines: [...lines], moved: 0 };

	const kept: string[] = [];
	const taken: string[] = [];

	for (const [line, text] of lines.entries()) {
		if (line < boundary && moving.has(line)) taken.push(text);
		else kept.push(text);
	}

	// A group has to be separated from what precedes it by a blank line, or
	// the archive would join whatever group happens to end the file.
	while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();

	const out = existing === -1
		? [...kept, '', heading, ...taken]
		: insertAfterTitle(kept, heading, taken);

	const moved = [...all.values()].filter((item) => moving.has(item.line) && item.parent === null).length;
	return { lines: out, moved };
}

/** Put `taken` directly under an archive title that is already in `kept`. */
function insertAfterTitle(kept: readonly string[], heading: string, taken: readonly string[]): string[] {
	const at = kept.findIndex((text) => isTitle(text) && titleText(text) === titleText(heading));
	// Newest first under the title, so the most recently finished work is the
	// easiest to find when you are looking for what you did.
	return [...kept.slice(0, at + 1), ...taken, ...kept.slice(at + 1)];
}
