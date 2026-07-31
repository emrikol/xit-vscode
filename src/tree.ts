/**
 * The nesting a document's indentation implies.
 *
 * Kept free of the `vscode` module so it can be unit tested, like checkbox.ts
 * and dueDate.ts.
 *
 * Subtasks are this fork's addition — discussion #2, the most-upvoted open
 * request on the format, which jotaen has not adopted. The grammar highlights
 * them without knowing their depth, because every level looks the same and
 * TextMate cannot count indentation anyway. This is where depth actually
 * matters, and here it is easy: this is ordinary code and can count.
 */

import { readCheckbox, Status } from './checkbox';
import { commentLines } from './comment';

export interface Item {
	readonly line: number;
	/**
	 * The whitespace before the checkbox, as written.
	 *
	 * Kept as text rather than as a width, and compared as a prefix, because a
	 * width cannot answer the question when tabs and spaces are mixed: four
	 * tabs is four characters and six spaces is six, so the deeper-looking
	 * line measures as the shallower one. The grammar has the same problem and
	 * solves it the same way, by back-referencing the parent's exact
	 * indentation, so the two agree by construction.
	 *
	 * The consequence, which is the honest one: a nest indented with tabs and
	 * a nest indented with spaces do not nest inside each other. Pick one.
	 */
	readonly indent: string;
	readonly status: Status;
	/** Line number of the enclosing item, or null at the top level. */
	readonly parent: number | null;
	readonly children: number[];
	/**
	 * Last line this item owns: its own line, its description continuations,
	 * and everything nested under it.
	 *
	 * What the Outline and the folding ranges are built from, so it is worked
	 * out here once rather than by each of them.
	 */
	endLine: number;
}

/**
 * Whether an item counts as finished for the purpose of closing its parent.
 *
 * Only `[x]`. Obsolete (`[~]`) is arguable — an item nobody will ever do is
 * not outstanding, so a parent whose children are all done-or-abandoned could
 * fairly be called done. It is left out because the conservative reading is
 * the one that never surprises: nothing here should tick a box the user did
 * not tick, on the strength of a judgement call about what abandoned means.
 */
function isDone(status: Status): boolean {
	return status === 'x';
}

/** An indent that can nest: tabs, and nothing else. */
const NESTABLE = /^\t*$/;

/**
 * Whether `inner` is nested inside `outer`, by indentation.
 *
 * Only tabs nest. The earlier rule here was "two or more spaces, or one tab",
 * which was too loose in a way that cost real structure: a three-space line
 * became a child of a two-space one, so a single stray space created a level
 * and nothing said anything.
 *
 * Compared as a prefix rather than a width. That mattered more when spaces
 * nested - four tabs is four characters and six spaces is six, so measuring by
 * width made the deeper-looking line the shallower one - and it is kept
 * because it is still the correct test and costs nothing.
 *
 * A space-indented checkbox is not lost by this: items() records every line
 * that holds one, and indentation only decides parentage, so such a line
 * becomes a sibling rather than a child. src/diagnostics.ts reports it.
 */
function isDeeper(inner: string, outer: string): boolean {
	return inner.length > outer.length && inner.startsWith(outer) && NESTABLE.test(inner);
}

/**
 * Every item in the document, with its parent and children resolved.
 *
 * A blank line ends the nest entirely, per spec §Item ("The item MUST NOT
 * contain any blank lines"), so items on either side of one are unrelated
 * however they are indented.
 */
export function items(lines: readonly string[]): Map<number, Item> {
	const found = new Map<number, Item>();
	// Parked work is not work. This used to be every caller's job to remember,
	// and one of them forgot: a tag inside a comment reached completion,
	// because tags() walks these items. Filtering here removes the footgun
	// rather than adding a seventh place that has to remember.
	//
	// A comment does end an item, though it does not split a group: the fork's
	// rule is that a comment "cannot appear inside an item". Skipping parked
	// lines outright was wrong for exactly that reason - an item before a
	// comment swallowed the comment and everything after it, which the folding
	// tests caught immediately.
	const parked = commentLines(lines);

	// Items still open above the current line, shallowest first.
	let ancestors: Item[] = [];

	/** Close every ancestor not still open at `line`, ending it on the line before. */
	const closeThrough = (keep: (item: Item) => boolean, line: number) => {
		while (ancestors.length && !keep(ancestors[ancestors.length - 1])) {
			ancestors.pop()!.endLine = line - 1;
		}
	};

	for (const [line, text] of lines.entries()) {
		if (parked.has(line)) {
			closeThrough(() => false, line);
			continue;
		}
		if (text.trim() === '') {
			closeThrough(() => false, line);
			continue;
		}

		const checkbox = readCheckbox(text);

		if (!checkbox) {
			// A continuation extends whatever it is indented under. A line in
			// column zero is a title or prose, and ends everything.
			if (!/^[^\S\n]/.test(text)) closeThrough(() => false, line);
			else if (ancestors.length) ancestors[ancestors.length - 1].endLine = line;
			continue;
		}

		// The parent is the nearest item above whose indentation is a proper
		// prefix of this line's. Anything else is a sibling or a cousin, and is
		// finished as far as this line is concerned.
		const indent = text.slice(0, checkbox.column);
		closeThrough((item) => isDeeper(indent, item.indent), line);

		const parent = ancestors[ancestors.length - 1] ?? null;
		const item: Item = {
			line,
			indent,
			status: checkbox.status,
			parent: parent ? parent.line : null,
			children: [],
			endLine: line,
		};

		parent?.children.push(line);
		found.set(line, item);
		ancestors.push(item);
	}

	closeThrough(() => false, lines.length);

	// An ancestor's range has to cover its descendants', which the loop above
	// only gets right for the deepest one on the stack at any moment.
	for (const item of [...found.values()].sort((a, b) => b.line - a.line)) {
		if (item.parent === null) continue;
		const parent = found.get(item.parent)!;
		parent.endLine = Math.max(parent.endLine, item.endLine);
	}

	return found;
}

/**
 * Ancestors that should close because every child of theirs is now done, and
 * ancestors that should reopen because one is not.
 *
 * Both directions, though only the first was asked for. A parent left ticked
 * above an unticked child states something false, and the pair is what makes
 * the feature coherent rather than a one-way trapdoor.
 *
 * Returned rather than applied, so the caller can make every change in one
 * edit. Applying them one at a time would fire a document change per step,
 * and each of those would ask this question again.
 *
 * @param lines the document
 * @param changed lines the user just edited
 */
export function cascade(lines: readonly string[], changed: readonly number[]): Map<number, Status> {
	const all = items(lines);
	const updates = new Map<number, Status>();

	/** The status a line will have once everything decided so far is applied. */
	const statusOf = (line: number) => updates.get(line) ?? all.get(line)!.status;

	// Walk from the deepest line upward, so a grandparent sees the decision
	// already made about its child rather than the status on disk.
	const queue = [...new Set(changed)]
		.filter((line) => all.has(line))
		.map((line) => all.get(line)!.parent)
		.filter((line): line is number => line !== null);

	const seen = new Set<number>();

	while (queue.length) {
		// Deepest first. A parent cannot be judged until its own children are.
		queue.sort((a, b) => all.get(b)!.indent.length - all.get(a)!.indent.length);
		const line = queue.shift()!;
		if (seen.has(line)) continue;
		seen.add(line);

		const item = all.get(line)!;
		if (!item.children.length) continue;

		const allDone = item.children.every((child) => isDone(statusOf(child)));
		const wanted: Status = allDone ? 'x' : ' ';

		// Only ever move between open and checked. An ongoing, obsolete or
		// in-question parent was set deliberately, and a child being ticked is
		// not a reason to overrule that.
		if (statusOf(line) !== wanted && (statusOf(line) === 'x' || statusOf(line) === ' ')) {
			updates.set(line, wanted);
			if (item.parent !== null) queue.push(item.parent);
		}
	}

	return updates;
}
