/**
 * What a file says about itself.
 *
 * The format has no header, no defaults, no file-level anything, so every item
 * carries its own metadata even when all two hundred items in `work.xit` would
 * carry the same tag.
 *
 *     <!-- xit: tags=work,client-acme -->
 *     <!-- xit: archive=Done -->
 *
 * A comment is where this costs least. Comments are already a fork of the
 * specification, so a file using them already reads wrong in other [x]it!
 * tools, and a directive inside one adds no new breakage. It also means the
 * whole thing is invisible to the grammar, the outline and the diagnostics
 * without any of them being taught about it - they already skip comments.
 *
 * An unknown key is ignored, in silence and on purpose. A directive written
 * for a later version must not break an earlier one, and the alternative -
 * reporting it - would make every new key a breaking change for anyone who has
 * not updated.
 *
 * Kept free of the `vscode` module so it can be unit tested, like the rest.
 */

import { commentLines } from './comment';
import { isTagName } from './stamp';
import { foldName } from './tag';

/** Directives a file may declare. Anything else is ignored. */
export interface Directives {
	/** Tags every item in the file inherits, folded. */
	tags: string[];
	/** Title finished items are archived under, overriding the setting. */
	archive: string | null;
}

/** `xit: key=value`, inside a comment. */
const DIRECTIVE = /^[^\S\n]*xit:[^\S\n]*([a-z-]+)[^\S\n]*=[^\S\n]*(.*?)[^\S\n]*$/i;

/** Strip a comment's own punctuation, so the directive can be read off it. */
function withoutMarkers(text: string): string {
	return text.replace(/^[^\S\n]*<!--/, '').replace(/-->[^\S\n]*$/, '');
}

/** Everything `lines` declares about itself. */
export function directives(lines: readonly string[]): Directives {
	const parked = commentLines(lines);
	const found: Directives = { tags: [], archive: null };

	for (const [line, text] of lines.entries()) {
		if (!parked.has(line)) continue;

		const match = DIRECTIVE.exec(withoutMarkers(text));
		if (!match) continue;

		const [, key, value] = match;

		if (key.toLowerCase() === 'tags') {
			for (const name of value.split(',').map((part) => part.trim()).filter(Boolean)) {
				// Only names the format could actually express as a tag. A
				// directive must not be able to declare something you could
				// not have written by hand.
				if (isTagName(name) && !found.tags.includes(foldName(name))) found.tags.push(foldName(name));
			}
		}

		if (key.toLowerCase() === 'archive' && value !== '') found.archive = value;
	}

	return found;
}
