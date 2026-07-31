/**
 * Sorting a group by priority, then by due date.
 *
 * The whole difficulty is that an item is not a line. A subtask must move with
 * its parent, and so must every description continuation, so this reorders
 * blocks rather than lines - which is what src/tree.ts already knows, through
 * `endLine` and the parent/child links.
 *
 * Kept free of the `vscode` module so it can be unit tested, like the rest.
 */

import { priorityOf } from './checkbox';
import { commentLines } from './comment';
import { Day, dueDatesOn } from './dueDate';
import { Item, items } from './tree';

/** The bounds of the group `line` sits in: consecutive non-blank lines. */
export function groupAround(lines: readonly string[], line: number): { start: number; end: number } | null {
	if (line < 0 || line >= lines.length || lines[line].trim() === '') return null;

	let start = line;
	let end = line;
	while (start > 0 && lines[start - 1].trim() !== '') start -= 1;
	while (end < lines.length - 1 && lines[end + 1].trim() !== '') end += 1;

	return { start, end };
}

/**
 * How an item ranks. Worst-first is not the question here; most urgent first
 * is, so a higher priority sorts earlier and an earlier due date sorts earlier.
 *
 * A missing due date sorts last rather than first. An item with no date is not
 * the most urgent thing in the group, it is the least scheduled.
 */
function rank(lines: readonly string[], item: Item): [number, Day] {
	const [due] = dueDatesOn(lines[item.line]);
	return [-priorityOf(lines[item.line]), due ? due.endOfPeriod : Number.MAX_SAFE_INTEGER];
}

/**
 * `lines` with the group containing `line` sorted.
 *
 * Stable: items that rank equally keep the order they were written in, so
 * running this twice changes nothing the second time.
 *
 * Nesting is preserved and sorted at every level - a parent's children are
 * sorted among themselves, inside the parent's own block, which is what makes
 * the result read the same way it did before, only ordered.
 */
export function sortGroup(lines: readonly string[], line: number): string[] {
	const group = groupAround(lines, line);
	if (!group) return [...lines];

	// A group inside a comment is parked work. Sorting it would rewrite text
	// the user deliberately set aside.
	const parked = commentLines(lines);
	if (parked.has(group.start)) return [...lines];

	const all = items(lines);

	/** The block of text an item owns: its own line, and everything under it. */
	const blockOf = (item: Item): string[] => {
		const ordered = sortChildren(item.children);
		const out = [lines[item.line]];

		// Continuations sit between this item's line and its first child, and
		// after the last child's block. Taken from the gaps rather than
		// recomputed, so nothing is lost whatever is in them.
		const owned = new Set<number>();
		for (const child of item.children) {
			const childItem = all.get(child)!;
			for (let at = childItem.line; at <= childItem.endLine; at++) owned.add(at);
		}

		for (let at = item.line + 1; at <= item.endLine; at++) {
			if (!owned.has(at)) out.push(lines[at]);
		}

		for (const child of ordered) out.push(...blockOf(all.get(child)!));
		return out;
	};

	const sortChildren = (children: readonly number[]): number[] =>
		[...children].sort((a, b) => {
			const [priorityA, dueA] = rank(lines, all.get(a)!);
			const [priorityB, dueB] = rank(lines, all.get(b)!);
			return priorityA - priorityB || dueA - dueB || a - b;
		});

	// The group's own top level: items in it with no parent inside it.
	const roots: number[] = [];

	for (let at = group.start; at <= group.end; at++) {
		const item = all.get(at);
		if (item && (item.parent === null || item.parent < group.start)) roots.push(at);
	}

	// Only when there is nothing to sort at all. A group with one root item
	// still has children to order inside it, which an earlier `< 2` here
	// silently skipped.
	if (roots.length === 0) return [...lines];

	// Lines a root's block already accounts for. Everything else in the group
	// is loose - a title, or a comment, which does not split a group and so
	// can sit between two items.
	const owned = new Set<number>();
	for (const root of roots) {
		for (let at = root; at <= all.get(root)!.endLine; at++) owned.add(at);
	}

	// Loose lines used to be dropped, which made the rebuilt group shorter,
	// which tripped the line-count guard below, which abandoned the sort. So a
	// group with a comment in it never sorted and the command reported that it
	// was already in order - the guard doing its job while the outcome was a
	// lie. They are carried now: anything before the first item stays at the
	// head, and anything after one travels with the item that follows it,
	// because a note written above an item is a note about that item.
	const head: string[] = [];
	const prefix = new Map<number, string[]>();
	const trailing: string[] = [];
	let pending: string[] = [];

	for (let at = group.start; at <= group.end; at++) {
		if (owned.has(at)) continue;
		if (roots.length === 0 || at < roots[0]) head.push(lines[at]);
		else pending.push(lines[at]);

		const next = roots.find((root) => root > at);
		if (next !== undefined && pending.length > 0) {
			prefix.set(next, [...(prefix.get(next) ?? []), ...pending]);
			pending = [];
		}
	}
	trailing.push(...pending);

	const sorted = [...head];
	for (const root of sortChildren(roots)) {
		sorted.push(...(prefix.get(root) ?? []), ...blockOf(all.get(root)!));
	}
	sorted.push(...trailing);

	// Same number of lines out as in, or something has been lost. Cheap to
	// check and the one failure that would be unforgivable.
	const before = lines.slice(group.start, group.end + 1);
	if (sorted.length !== before.length) return [...lines];

	return [...lines.slice(0, group.start), ...sorted, ...lines.slice(group.end + 1)];
}
