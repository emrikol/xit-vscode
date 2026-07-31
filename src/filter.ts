/**
 * Narrowing the workspace view to a tag, and grouping it by one.
 *
 * Kept free of the `vscode` module so it can be unit tested, like collect.ts
 * that it reads from.
 *
 * This exists because the fork built file-wide tags and then read them
 * nowhere. A directive at the top of a file - `<!-- xit: tags=client-acme -->`,
 * see src/directive.ts - tags every item in it, and until now that changed
 * nothing anybody could see: completion read the raw tag index, the sidebar
 * grouped by urgency alone, and `Collected.tags` was carried from file to view
 * without a single reader. Tagging a file is only worth doing if something can
 * answer "what is outstanding for this tag".
 */

/**
 * The choice matching items that carry no tag at all.
 *
 * The empty string cannot collide with a real tag: src/tag.ts requires at
 * least one character in a name, so no document can produce this key. Worth
 * having as a choice rather than only as a leftover group - "what have I never
 * filed" is a question, and it is the one that finds work about to be lost.
 */
export const UNTAGGED = '';

/** How the view arranges its top level. */
export type Grouping = 'urgency' | 'tag';

export interface TagChoice {
	/** The folded tag name, or UNTAGGED. */
	tag: string;
	/** How many of the items given carry it. */
	count: number;
}

export interface TagGroup<T> {
	tag: string;
	rows: T[];
}

/**
 * Tag names in the order they are shown, which is alphabetical with the
 * untagged group last.
 *
 * Alphabetical rather than commonest-first, deliberately. Ordering by count
 * makes the list rearrange itself as items are ticked off, so the group you
 * were reading moves while you read it. A stable order is worth more than a
 * ranked one in a panel you return to all day.
 */
function inDisplayOrder(tags: readonly string[]): string[] {
	return [...tags].sort((a, b) => {
		if (a === UNTAGGED) return 1;
		if (b === UNTAGGED) return -1;
		return a < b ? -1 : a > b ? 1 : 0;
	});
}

/**
 * Every tag on the items given, with how many carry it.
 *
 * Counts an item once per distinct tag it has, and counts an item with no tags
 * under UNTAGGED, so the counts add up to more than the number of items
 * whenever anything is tagged twice. That is the honest total for a list where
 * one item can appear in two groups.
 */
export function tagChoices<T>(rows: readonly T[], tagsOf: (row: T) => readonly string[]): TagChoice[] {
	const counts = new Map<string, number>();

	for (const row of rows) {
		const tags = new Set(tagsOf(row));
		for (const tag of tags.size ? tags : [UNTAGGED]) counts.set(tag, (counts.get(tag) ?? 0) + 1);
	}

	return inDisplayOrder([...counts.keys()]).map((tag) => ({ tag, count: counts.get(tag)! }));
}

/**
 * Whether an item passes a tag selection.
 *
 * Any of the selected tags, not all of them. Picking a second tag in a
 * multi-select adds to what is shown, which is what ticking a second box in a
 * picker means everywhere else; intersecting instead would make each pick
 * shrink the list, and for tags that name projects the intersection is almost
 * always empty.
 *
 * No selection, or an empty one, passes everything. There is no state where
 * the filter hides all the work by accident.
 */
export function matchesTags(tags: readonly string[], selection: ReadonlySet<string> | null): boolean {
	if (!selection || selection.size === 0) return true;
	if (tags.length === 0) return selection.has(UNTAGGED);
	return tags.some((tag) => selection.has(tag));
}

/**
 * Rows grouped by tag, in display order.
 *
 * An item carrying two tags appears under both. Duplicating it is the honest
 * answer - it really is part of both projects - and picking one tag to file it
 * under would have to pick arbitrarily, then hide it from the other group
 * where someone is looking for it.
 *
 * Row order inside a group is the order given, so the caller decides it.
 */
export function byTag<T>(rows: readonly T[], tagsOf: (row: T) => readonly string[]): TagGroup<T>[] {
	const groups = new Map<string, T[]>();

	for (const row of rows) {
		const tags = new Set(tagsOf(row));
		for (const tag of tags.size ? tags : [UNTAGGED]) {
			const found = groups.get(tag);
			if (found) found.push(row);
			else groups.set(tag, [row]);
		}
	}

	return inDisplayOrder([...groups.keys()]).map((tag) => ({ tag, rows: groups.get(tag)! }));
}

/**
 * How a selection reads in the view's message.
 *
 * Named rather than counted. "Filtered to #work" says what to do about it;
 * "1 filter active" makes you open the picker to find out what you filtered
 * to, which is the question the message was supposed to answer.
 */
export function describeSelection(selection: ReadonlySet<string> | null): string | null {
	if (!selection || selection.size === 0) return null;

	const names = inDisplayOrder([...selection]).map((tag) => (tag === UNTAGGED ? 'untagged' : `#${tag}`));
	const listed = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;

	return `Filtered to ${listed}.`;
}
