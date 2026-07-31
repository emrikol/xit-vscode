/**
 * What a title is, in one place.
 *
 * The specification defines a title by what it is not: spec §Title, and the
 * syntax guide's `groups/5`, say only that it "can neither start with
 * whitespace, nor with an opening square bracket". That is the whole
 * definition, which means the format has no invalid state for a line -
 * anything that fails to be an item is silently promoted to a heading.
 *
 * That is not a hypothetical. Every one of these read as a title:
 *
 *     - [ ] Buy milk
 *     * [ ] Call Sam
 *     x] Slip
 *
 * The first two are what anyone with Markdown habits types. None of them
 * appeared in the workspace view. The failure is not a mis-rendered line, it
 * is a lost task, and it is worth a fork to remove.
 *
 * So a title is marked. A line is now a title, an item, a continuation, a
 * comment, or an error you can see.
 *
 * `#` and then a space, or `#` alone on its line. The space is what keeps it
 * clear of a tag: `#[\p{L}\d_-]+` needs a name character straight after the
 * hash, so `# Groceries` can never be one and `#groceries` on its own line is
 * an error rather than a heading that happens to look like a tag.
 *
 * Kept free of the `vscode` module, like the rest of src/.
 */

/** The character that opens a title. */
export const MARKER = '#';

const TITLE = /^#(?=[^\S\n]|$)/;

/** Whether `text` is a title line. */
export function isTitle(text: string): boolean {
	return TITLE.test(text);
}

/**
 * The title without its marker, trimmed.
 *
 * What the Outline shows, and what folding names a group. An empty title - a
 * bare `#` - is legal and gives an empty string, because the specification
 * lets a group be headed by nothing in particular.
 */
export function titleText(text: string): string {
	return isTitle(text) ? text.slice(MARKER.length).trim() : text.trim();
}

/**
 * `text` with the title marker added, for the migration in src/migrate.ts.
 *
 * Idempotent: a line that is already a title is returned unchanged, so
 * migrating a file twice is the same as migrating it once.
 */
export function markTitle(text: string): string {
	return isTitle(text) ? text : `${MARKER} ${text.trimEnd()}`;
}
