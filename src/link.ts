/**
 * Item identity, and one item waiting on another.
 *
 * The only thing the format genuinely cannot express: items cannot refer to
 * each other. No identity, no "blocked by", no link from an item to the thing
 * it waits on.
 *
 *     [ ] Draft the contract #id=k3f9
 *     [ ] Send it out #after=k3f9
 *
 * ## Why tags and not new syntax
 *
 * `[[wikilink]]` would collide with nothing today. It is still the wrong
 * answer. Every syntax element is permanent cost in three places that must not
 * drift - the grammar, the TypeScript and a conformance allowlist - and one
 * character added to the status set touched eleven hand-written patterns. A
 * dependency is not a date and pairs with no existing arrow, so it buys none
 * of that back. The rule in the README settles it: an arrow for what pairs
 * with an arrow, a tag for everything else.
 *
 * ## Why ids are generated and not derived
 *
 * An id has to survive a re-sort and a move between files, which rules out
 * anything positional - a line number, an index, a hash of the surrounding
 * text. Sorting a group and archiving finished items both rewrite lines, and
 * either would break every reference in the file.
 *
 * So an id is a short random token, written once and never recomputed. Base32
 * without vowels, so it cannot spell anything and cannot be confused between
 * `0`/`O` or `1`/`l`, and four characters - which is 32^4, plenty for one
 * person's todo files and short enough to read aloud.
 *
 * ## Referring across files
 *
 *     [ ] Send it out #after="work-todo.xit#k3f9"
 *
 * The file first, then the id. Quoted, because `.` and `#` are not legal in an
 * unquoted tag value and a quoted one takes anything - so this needs no new
 * syntax at all.
 *
 * Naming the file beats making ids unique across a workspace. Nothing
 * generates or enforces that uniqueness, so a global namespace works right up
 * until two files collide, and then it is silently wrong. An explicit filename
 * cannot be silently wrong.
 *
 * This module stays pure and knows nothing about paths: it parses `file#id`
 * and stops. Resolving the file against a workspace is the index's job, and
 * that is also where cross-file blocking is decided - see the note on
 * `blocked` below.
 *
 * ## What is deliberately not here
 *
 * Nothing cascades. Checking an item does not check what waits on it, and
 * nothing reorders itself. A dependency describes the world; it does not get
 * to edit your file. The same restraint the repeat interval already shows.
 *
 * Kept free of the `vscode` module so it can be unit tested, like the rest.
 */

import { commentLines } from './comment';
import { Tag, tagsOn } from './tag';
import { items } from './tree';

/** The tag naming an item, and the tag naming what it waits on. */
export const ID_TAG = 'id';
export const AFTER_TAG = 'after';

/**
 * Characters an id is built from: base32 with the vowels and the ambiguous
 * pairs removed, so an id can be read aloud and cannot spell a word.
 */
const ALPHABET = 'bcdfghjkmnpqrstvwxyz23456789';

/** How long a generated id is. 28^4 is ample for one person's files. */
const LENGTH = 4;

export interface Identified {
	/** Line the item starts on. */
	line: number;
	/** The id as written. Ids are compared folded, like every other tag value's name. */
	id: string;
	tag: Tag;
}

/** What an `#after=` names: an id, and optionally the file holding it. */
export interface Reference {
	/** The file as written, or null where the reference is to this file. */
	file: string | null;
	id: string;
}

export interface Dependency {
	/** Line of the item that is waiting. */
	line: number;
	/** The id it is waiting for, and where. */
	on: Reference;
	tag: Tag;
}

/**
 * Split an `#after=` value into a file and an id.
 *
 * `k3f9` is this file; `work-todo.xit#k3f9` is that one. The last `#` splits
 * them, so a filename containing a hash still works - unlikely, and free.
 */
export function parseReference(value: string): Reference {
	const at = value.lastIndexOf('#');
	if (at <= 0) return { file: null, id: value };
	return { file: value.slice(0, at), id: value.slice(at + 1) };
}

/** Ids are matched case-insensitively, like tag names. Values are not folded by the spec, so this is ours. */
export function foldId(id: string): string {
	return id.toLowerCase();
}

/** Every item in `lines` that names itself. */
export function identities(lines: readonly string[]): Identified[] {
	const found: Identified[] = [];
	const parked = commentLines(lines);

	for (const item of items(lines).values()) {
		if (parked.has(item.line)) continue;
		const tag = tagsOn(lines[item.line]).find((each) => each.key === ID_TAG);
		if (tag?.value) found.push({ line: item.line, id: tag.value, tag });
	}

	return found;
}

/** Every item in `lines` that waits on another. */
export function dependencies(lines: readonly string[]): Dependency[] {
	const found: Dependency[] = [];
	const parked = commentLines(lines);

	for (const item of items(lines).values()) {
		if (parked.has(item.line)) continue;
		for (const tag of tagsOn(lines[item.line])) {
			if (tag.key === AFTER_TAG && tag.value) found.push({ line: item.line, on: parseReference(tag.value), tag });
		}
	}

	return found;
}

/**
 * An id that is not already used in `lines`.
 *
 * `random` is passed in rather than reached for, so a test can pin it and so
 * this module needs no clock or global. Collisions are retried rather than
 * assumed away: 28^4 is ample, and "ample" is not "never".
 */
export function freshId(lines: readonly string[], random: () => number = Math.random): string {
	const taken = new Set(identities(lines).map((each) => foldId(each.id)));

	for (let attempt = 0; attempt < 1000; attempt += 1) {
		let id = '';
		for (let at = 0; at < LENGTH; at += 1) id += ALPHABET[Math.floor(random() * ALPHABET.length)];
		if (!taken.has(foldId(id))) return id;
	}

	// Unreachable with a sane `random`, and a thrown error beats a duplicate
	// id, which would silently point two references at one item.
	throw new Error('could not find an unused id');
}

export type ProblemKind = 'unknown-id' | 'duplicate-id' | 'cycle' | 'already-finished';

export interface LinkProblem {
	kind: ProblemKind;
	line: number;
	start: number;
	end: number;
	message: string;
}

/**
 * Everything wrong with the links in a document.
 *
 * Reported rather than repaired. A broken reference is a fact about the file,
 * and guessing which item was meant would be worse than saying so.
 */
export function linkProblems(lines: readonly string[]): LinkProblem[] {
	const found: LinkProblem[] = [];
	const all = identities(lines);
	const byId = new Map<string, Identified[]>();

	for (const each of all) {
		const key = foldId(each.id);
		byId.set(key, [...(byId.get(key) ?? []), each]);
	}

	for (const [id, sharing] of byId) {
		if (sharing.length < 2) continue;
		// Every one of them, not just the later ones: with a duplicate there
		// is no "original", and pointing at one would imply the other is fine.
		for (const each of sharing) {
			found.push({
				kind: 'duplicate-id',
				line: each.line,
				start: each.tag.start,
				end: each.tag.end,
				message: `The id \`${id}\` is used by ${sharing.length} items, so a reference to it is ambiguous.`,
			});
		}
	}

	const lineOf = new Map([...byId].filter(([, sharing]) => sharing.length === 1).map(([id, [each]]) => [id, each.line]));
	const status = new Map([...items(lines).values()].map((item) => [item.line, item.status]));
	const waiting = dependencies(lines);

	for (const each of waiting) {
		// A reference naming another file cannot be judged from here. The
		// index knows which files exist and what is in them; this function is
		// pure and deliberately does not. extension.ts reports those.
		if (each.on.file !== null) continue;

		const target = lineOf.get(foldId(each.on.id));

		if (target === undefined && !byId.has(foldId(each.on.id))) {
			found.push({
				kind: 'unknown-id',
				line: each.line,
				start: each.tag.start,
				end: each.tag.end,
				message: `Nothing in this file has the id \`${each.on.id}\`.`,
			});
			continue;
		}

		if (target !== undefined && (status.get(target) === 'x' || status.get(target) === '~')) {
			found.push({
				kind: 'already-finished',
				line: each.line,
				start: each.tag.start,
				end: each.tag.end,
				message: `This waits on \`${each.on.id}\`, which is already finished. It is not blocked.`,
			});
		}
	}

	for (const line of cycles(lines)) {
		const [each] = waiting.filter((one) => one.line === line);
		found.push({
			kind: 'cycle',
			line,
			start: each.tag.start,
			end: each.tag.end,
			message: 'These items wait on each other, so none of them can ever start.',
		});
	}

	return found.sort((a, b) => a.line - b.line || a.start - b.start);
}

/** Lines that are part of a dependency cycle. */
function cycles(lines: readonly string[]): number[] {
	const edges = new Map<number, number[]>();
	const lineOf = new Map(identities(lines).map((each) => [foldId(each.id), each.line]));

	for (const each of dependencies(lines)) {
		if (each.on.file !== null) continue;
		const target = lineOf.get(foldId(each.on.id));
		if (target !== undefined) edges.set(each.line, [...(edges.get(each.line) ?? []), target]);
	}

	const found = new Set<number>();
	const state = new Map<number, 'visiting' | 'done'>();

	const walk = (line: number, path: number[]): void => {
		if (state.get(line) === 'done') return;

		if (state.get(line) === 'visiting') {
			// Everything from where this line first appeared is in the cycle.
			for (const at of path.slice(path.indexOf(line))) found.add(at);
			return;
		}

		state.set(line, 'visiting');
		for (const next of edges.get(line) ?? []) walk(next, [...path, next]);
		state.set(line, 'done');
	};

	for (const line of edges.keys()) walk(line, [line]);

	return [...found].filter((line) => edges.has(line)).sort((a, b) => a - b);
}

/**
 * Lines whose item is waiting on something in this file that is not finished.
 *
 * Same-file only, on purpose. This is the right answer for a document read on
 * its own, and it is what `collect` uses; WorkspaceIndex resolves the
 * cross-file references afterwards, because only it knows what other files
 * exist. The alternative - threading a workspace through every pure function
 * here - would cost more than the one place that overwrites the answer.
 */
export function blocked(lines: readonly string[]): Set<number> {
	const lineOf = new Map(identities(lines).map((each) => [foldId(each.id), each.line]));
	const status = new Map([...items(lines).values()].map((item) => [item.line, item.status]));
	const found = new Set<number>();

	for (const each of dependencies(lines)) {
		if (each.on.file !== null) continue;
		const target = lineOf.get(foldId(each.on.id));
		// An unknown id blocks nothing. It is reported as a problem, and
		// treating it as a block would hide the item behind a typo.
		if (target === undefined) continue;
		if (status.get(target) !== 'x' && status.get(target) !== '~') found.add(each.line);
	}

	return found;
}
