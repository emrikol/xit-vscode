/**
 * The document's structure, for the Outline panel and Go to Symbol.
 *
 * Kept free of the `vscode` module so it can be unit tested, like the other
 * three. extension.ts turns these into DocumentSymbols; nothing about the
 * shape here is VS Code's.
 */

import { readCheckbox, type Status } from './checkbox';
import { items } from './tree';
import { dueDatesOn, startDatesOn } from './dueDate';
import { commentLines } from './comment';
import { isTitle, titleText } from './title';

export interface Node {
	/** Shown in the panel. Carries the checkbox, so status reads without colour. */
	name: string;
	/** Grey text beside the name. The due date, where there is one. */
	detail: string;
	kind: 'title' | 'item';
	status: Status | null;
	line: number;
	/** Last line this node covers, so collapsing it in the panel covers the right lines. */
	endLine: number;
	/** Columns of the part to select when the node is clicked. */
	selectionStart: number;
	selectionEnd: number;
	children: Node[];
}

/**
 * The document as a tree of titles and items.
 *
 * Titles are the top level and the items after one hang under it, which is
 * what a group is: spec §Group, "any consecutive number of items … that MAY
 * be preceded by one title". Items before any title, or after a blank line
 * that ended a group, sit at the top level beside the titles.
 */
export function outline(lines: readonly string[]): Node[] {
	const comments = commentLines(lines);
	const all = items(lines);

	const roots: Node[] = [];
	const byLine = new Map<number, Node>();
	let title: Node | null = null;

	const nodeFor = (line: number): Node => {
		const item = all.get(line)!;
		const text = lines[line];
		const [due] = dueDatesOn(text);
		const [start] = startDatesOn(text);

		// Both arrows are lifted out into `detail`, so neither is printed
		// twice on the same row. Cut by offset rather than by replacing the
		// text, because the same string can legitimately appear in a
		// description - and back to front, because removing the earlier one
		// first would move the later one. src/collect.ts does the same, and
		// this used to lift only the due date, leaving `<- 2026-09-01` sitting
		// in the name.
		const from = item.indent.length + 3;
		const cuts = [due, start]
			.filter((date): date is NonNullable<typeof date> => date !== undefined)
			.sort((a, b) => b.start - a.start);

		let body = text.slice(from);
		for (const cut of cuts) body = body.slice(0, cut.start - from) + body.slice(cut.end - from);
		const description = body.replace(/\s+/g, ' ').trim();

		return {
			name: `[${item.status}] ${description}`.trimEnd(),
			detail: [start?.text, due?.text].filter(Boolean).join('  '),
			kind: 'item',
			status: item.status,
			line,
			endLine: item.endLine,
			selectionStart: item.indent.length,
			selectionEnd: item.indent.length + 3,
			children: [],
		};
	};

	for (const [line, text] of lines.entries()) {
		if (comments.has(line)) continue;

		if (all.has(line)) {
			const node = nodeFor(line);
			byLine.set(line, node);

			const parent = all.get(line)!.parent;
			if (parent !== null && byLine.has(parent)) byLine.get(parent)!.children.push(node);
			else if (title) title.children.push(node);
			else roots.push(node);
			continue;
		}

		if (readCheckbox(text) || !isTitle(text)) continue;

		title = {
			name: titleText(text),
			detail: '',
			kind: 'title',
			status: null,
			line,
			// Extended as its items are found, so an empty group covers only
			// its own line. Spec §Group: a title may precede no items at all.
			endLine: line,
			selectionStart: 0,
			selectionEnd: text.length,
			children: [],
		};
		roots.push(title);
	}

	// A title covers everything under it. Done afterwards because a title's
	// extent is only known once the next one starts, or the file ends.
	for (const root of roots) {
		if (root.kind !== 'title') continue;
		for (const child of root.children) root.endLine = Math.max(root.endLine, child.endLine);
	}

	return roots;
}
