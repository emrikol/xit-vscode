/**
 * The document as something you can look at and click, rather than edit.
 *
 * Kept free of the `vscode` module so it can be unit tested, like hover.ts.
 * This produces a model and then HTML from it; the custom editor is a thin
 * shell that supplies a nonce and posts messages back.
 *
 * Two rules shape everything here.
 *
 * **No line is ever lost.** Anything this cannot render as a component - an
 * invalid line, a malformed checkbox, syntax it does not recognise - is shown
 * as raw text with a marker. The specification defined a title by what it is
 * *not*, so `- [ ] Buy milk` was silently promoted to a heading and the task
 * disappeared from every list; that is the failure this fork was built to
 * prevent, and a preview that quietly omitted what it could not parse would
 * reintroduce it one layer up. `accountsForEveryLine` in the tests is what
 * holds the rule.
 *
 * **Nothing reaches the DOM unescaped.** Every string here comes out of
 * someone's file. `<!-- parked -->` passed through would become a real HTML
 * comment - invisible but present - and a `-->` inside a description could
 * break out of it. Same discipline as escapeMarkdown in hover.ts.
 */

import { type Status, priorityOf } from './checkbox';
import { type Collected, type Thresholds, type Urgency, collect, isOpen, totalEstimate, urgencyOf } from './collect';
import { commentLines } from './comment';
import { formatCycleTime } from './cycle';
import { formatEstimate } from './estimate';
import { STATUS_LABEL, withoutTags } from './hover';
import { foldName } from './tag';
import { isTitle, titleText } from './title';
import { type Item, items } from './tree';

/** One item, with everything the preview draws about it. */
export interface Row {
	line: number;
	status: Status;
	statusLabel: string;
	urgency: Urgency;
	/** The description as written, minus the checkbox and the date arrows. */
	description: string;
	/** How many `!` marks, zero for none. */
	priority: number;
	due: string | null;
	start: string | null;
	estimate: string | null;
	took: string | null;
	tags: readonly string[];
	blocked: boolean;
	open: boolean;
	/**
	 * The description's continuation lines, as written.
	 *
	 * Carried because they are content. Without them a multi-line description
	 * showed only its first line in the preview, which is the rule this module
	 * is built on being broken by the module itself - and the
	 * `accounts for every line` test is what caught it.
	 */
	continuation: { line: number; text: string }[];
	children: Row[];
}

export interface Group {
	kind: 'group';
	/** The title text, or null for items that precede any title. */
	title: string | null;
	/** The title's line, for the raw/parsed round trip. Null for an untitled group. */
	line: number | null;
	rows: Row[];
	/** Closed and total, counting every level of nesting. */
	done: number;
	total: number;
	minutes: number;
	unestimated: number;
}

/** A line the renderer could not turn into anything, shown as written. */
export interface Raw {
	kind: 'raw';
	line: number;
	text: string;
}

export type Block = Group | Raw;

export interface PreviewOptions {
	thresholds: Thresholds;
	estimateTag?: string;
	dateTags?: { creation: string; completion: string };
	/**
	 * Tag names drawn as something other than a pill.
	 *
	 * `#est=30m` becomes the estimate chip and `#after=` becomes the blocked
	 * chip, so listing them again as pills would say the same thing twice. A
	 * `#shop` you invented has nowhere else to appear and stays.
	 */
	explained?: readonly string[];
}

/** Text that cannot become markup. */
export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Schemes a link may not use, whatever the file says.
 *
 * An allow-list would be wrong here: `quill://` is a real scheme someone uses
 * for meeting links, and so is anything else their tools invent. What must
 * never survive is a scheme that executes.
 */
const DANGEROUS = /^(javascript|data|vbscript):/i;

/** `[label](target)`, and a bare URL, in one pass so neither can nest in the other. */
const LINK = /\[([^\]\n]*)\]\(([^)\s]+)\)|\b[a-zA-Z][a-zA-Z\d+.-]*:\/\/[^\s)]+/g;

/**
 * Text with its links made clickable, everything else escaped.
 *
 * Tokenised rather than escaped-then-substituted: escaping first would turn a
 * quote inside a target into `&quot;` before it could be checked, and running
 * a replacement over already-escaped text is how an injection gets built back
 * up out of its own escapes.
 */
export function linkify(text: string): string {
	let out = '';
	let at = 0;

	for (const match of text.matchAll(LINK)) {
		const start = match.index ?? 0;
		out += escapeHtml(text.slice(at, start));
		at = start + match[0].length;

		const [whole, label, target] = match;
		const href = target ?? whole;

		// A scheme that executes is written out as text, not linked. It stays
		// visible - the rule is that nothing is hidden - it just is not live.
		if (DANGEROUS.test(href.trim())) {
			out += escapeHtml(whole);
			continue;
		}

		out += `<a href="${escapeHtml(href)}">${escapeHtml(label ?? whole)}</a>`;
	}

	return out + escapeHtml(text.slice(at));
}

/** Everything about an item that the preview shows, from a collected one. */
function rowFor(
	item: Collected,
	lines: readonly string[],
	thresholds: Thresholds,
	byLine: Map<number, Collected>,
	explained: ReadonlySet<string>,
	all: Map<number, Item>,
): Row {
	// Lines this item owns that no child owns: its continuations.
	const own = all.get(item.line);
	const childRanges = item.children
		.map((child) => all.get(child))
		.filter((child): child is Item => child !== undefined);
	const continuation: { line: number; text: string }[] = [];

	for (let line = item.line + 1; own && line <= own.endLine; line++) {
		if (childRanges.some((child) => line >= child.line && line <= child.endLine)) continue;
		const text = lines[line];
		if (text !== undefined && text.trim() !== '') continuation.push({ line, text: text.trim() });
	}

	return {
		line: item.line,
		status: item.status,
		statusLabel: STATUS_LABEL[item.status],
		urgency: urgencyOf(item, thresholds),
		// Priority and tags are drawn as their own components, so they come out
		// of the description rather than being printed twice - the rule the
		// hover already follows for the tags it restates in words.
		description: withoutTags(item.description, item.tags).replace(/^!+(\s+|$)/, ''),
		priority: priorityOf(lines[item.line] ?? ''),
		due: item.due?.text.slice(3) ?? null,
		start: item.start?.text.slice(3) ?? null,
		estimate: item.estimate === null ? null : formatEstimate(item.estimate),
		took: item.took === null ? null : formatCycleTime(item.took),
		tags: item.tags.filter((tag) => !explained.has(tag)),
		blocked: item.blocked,
		open: isOpen(item),
		continuation,
		children: item.children
			.map((child) => byLine.get(child))
			.filter((child): child is Collected => child !== undefined)
			.map((child) => rowFor(child, lines, thresholds, byLine, explained, all)),
	};
}

/** Every row under this one, itself included. What the group counts. */
function flatten(rows: readonly Row[]): Row[] {
	return rows.flatMap((row) => [row, ...flatten(row.children)]);
}

/**
 * The document as blocks, in the order they appear.
 *
 * A group runs from a title, or from the first item after a break, until a
 * blank line or the next title - the same shape spec §Group describes and the
 * outline already builds.
 */
export function preview(lines: readonly string[], options: PreviewOptions): Block[] {
	const {
		thresholds,
		estimateTag = 'est',
		dateTags = { creation: 'created', completion: 'done' },
		explained = [estimateTag, 'id', 'after', dateTags.creation, dateTags.completion, 'repeat'],
	} = options;
	const hidden = new Set(explained.map(foldName));

	const collected = collect(lines, estimateTag, dateTags);
	const byLine = new Map(collected.map((item) => [item.line, item]));
	const all = items(lines);

	const inComment = commentLines(lines);

	const blocks: Block[] = [];
	let group: Group | null = null;

	/** Lines already spoken for: an item's own line, and everything it owns. */
	const owned = new Set<number>();
	for (const item of all.values()) {
		if (item.parent !== null) continue;
		for (let line = item.line; line <= item.endLine; line++) owned.add(line);
	}

	const close = () => {
		if (!group) return;
		const rows = flatten(group.rows);
		group.total = rows.length;
		group.done = rows.filter((row) => !row.open).length;

		const totals = totalEstimate(
			rows.map((row) => byLine.get(row.line)).filter((item): item is Collected => item !== undefined),
		);
		group.minutes = totals.minutes;
		group.unestimated = totals.unestimated;

		blocks.push(group);
		group = null;
	};

	const started = (title: string | null, line: number | null): Group => ({
		kind: 'group',
		title,
		line,
		rows: [],
		done: 0,
		total: 0,
		minutes: 0,
		unestimated: 0,
	});

	for (const [line, text] of lines.entries()) {
		// A comment does not appear at all. Parked work is not outstanding work,
		// and every other view already drops it - the outline skips it, collect
		// filters it, the sidebar never lists it, its tags never reach
		// completion. A marker offering to expand it was a half-measure: it put
		// five rows of furniture at the top of the file for content nobody was
		// asking to see, and the way to read a comment is to switch to Raw,
		// where it is right there in the text.
		//
		// It still ends the group above it, because a comment cannot sit inside
		// an item.
		if (inComment.has(line)) {
			close();
			continue;
		}

		if (text.trim() === '') {
			close();
			continue;
		}

		if (owned.has(line)) {
			// A top-level item starts or continues the current group; its own
			// nested lines were consumed when the row was built.
			const item = byLine.get(line);
			if (item && all.get(line)?.parent === null) {
				// Items before any title are a group of their own, which is what
				// spec §Group allows: a title MAY precede a group, not must.
				group ??= started(null, null);
				group.rows.push(rowFor(item, lines, thresholds, byLine, hidden, all));
			}
			continue;
		}

		if (isTitle(text)) {
			close();
			group = started(titleText(text), line);
			continue;
		}

		// Nothing else this understands. Shown, not swallowed.
		close();
		blocks.push({ kind: 'raw', line, text });
	}

	close();

	return blocks;
}

/**
 * The stylesheet, drawn entirely from the editor's own theme variables.
 *
 * No colours of our own. A preview that asserted a palette would look like
 * something that had wandered into the editor rather than part of it, and the
 * webview's CSP forbids external fonts and stylesheets anyway.
 */
const STYLE = `
:root { color-scheme: light dark; }
body {
	margin: 0; padding: 1rem 1.25rem;
	font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
	color: var(--vscode-editor-foreground); background: var(--vscode-editor-background);
}
.group { margin: 0 0 1.5rem; }
.group-head { display: flex; align-items: baseline; gap: .6rem; margin: 0 0 .5rem; }
h2 { font-size: 1em; font-weight: 600; margin: 0; text-wrap: balance; }
.count { font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground); font-size: .9em; }
progress { inline-size: 6rem; block-size: .35rem; }
ul { list-style: none; margin: 0; padding: 0; }
li ul { margin-inline-start: 1.5rem; }
.item { display: flex; align-items: baseline; gap: .5rem; padding: .15rem 0; min-inline-size: 0; }
.box {
	flex: none; inline-size: 1.4rem; block-size: 1.4rem; padding: 0; cursor: pointer;
	font-family: var(--vscode-editor-font-family); font-size: .95em; line-height: 1;
	color: inherit; background: transparent;
	border: 1px solid var(--vscode-checkbox-border, var(--vscode-contrastBorder, currentColor));
	border-radius: 3px;
}
.box:hover { background: var(--vscode-list-hoverBackground, rgba(128 128 128 / .2)); }
.box:focus-visible { outline: 2px solid var(--vscode-focusBorder, currentColor); outline-offset: 2px; }
.text { min-inline-size: 0; overflow-wrap: anywhere; }
.done .text { text-decoration: line-through; color: var(--vscode-descriptionForeground); }
.chip {
	display: inline-block; margin-inline-start: .4rem; padding: 0 .35rem; border-radius: 3px;
	font-size: .85em; font-variant-numeric: tabular-nums;
	background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
}
.chip.overdue, .chip.critical { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-editor-foreground); }
.chip.soon { background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-editor-foreground); }
.priority { color: var(--vscode-editorWarning-foreground); font-weight: 600; }
.unparsed { font-size: .8em; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-editorError-foreground, currentColor); }
.raw {
	font-family: var(--vscode-editor-font-family); white-space: pre-wrap; overflow-wrap: anywhere;
	border-inline-start: 2px solid var(--vscode-editorError-foreground, currentColor); padding-inline-start: .5rem; margin: .25rem 0;
}
.continued { margin: .1rem 0 .2rem 1.9rem; color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
a { color: var(--vscode-textLink-foreground, currentColor); }
a:hover { color: var(--vscode-textLink-activeForeground, currentColor); }
.empty { color: var(--vscode-descriptionForeground); }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

/** A chip, or nothing when there is nothing to say. */
function chip(text: string | null, className = ''): string {
	return text ? `<span class="chip ${className}">${escapeHtml(text)}</span>` : '';
}

/** One item and everything under it. */
function rowHtml(row: Row): string {
	// A real button, so keyboard, focus ring and screen-reader semantics come
	// free. A styled div with a click handler would have none of them, and is
	// on the Web Interface Guidelines' anti-pattern list by name.
	const label = `${row.statusLabel}: ${row.description || 'no description'}. Change status`;
	const box = `<button class="box" type="button" data-line="${row.line}" aria-label="${escapeHtml(label)}">${escapeHtml(row.status === ' ' ? '' : row.status)}</button>`;

	const priority =
		row.priority > 0
			? `<span class="priority" aria-label="priority ${row.priority}">${'!'.repeat(row.priority)}</span> `
			: '';
	const urgent =
		row.urgency === 'critical' || row.urgency === 'overdue' ? row.urgency : row.urgency === 'soon' ? 'soon' : '';

	const parts = [
		chip(row.start && `from ${row.start}`),
		chip(row.due && `due ${row.due}`, urgent),
		chip(row.estimate),
		chip(row.took && `took ${row.took}`),
		row.blocked ? chip('blocked') : '',
		...row.tags.map((tag) => chip(`#${tag}`)),
	].join('');

	const continued = row.continuation.length
		? `<p class="continued">${row.continuation.map((each) => linkify(each.text)).join('<br>')}</p>`
		: '';
	const children = row.children.length ? `<ul>${row.children.map(rowHtml).join('')}</ul>` : '';

	return `<li${row.open ? '' : ' class="done"'}><div class="item">${box}<span class="text">${priority}${linkify(row.description)}${parts}</span></div>${continued}${children}</li>`;
}

/** One block: a group, a collapsed comment, or a line shown as written. */
function blockHtml(block: Block): string {
	if (block.kind === 'raw') {
		return `<p class="raw" data-line="${block.line}"><span class="unparsed">Not recognised</span> ${escapeHtml(block.text)}</p>`;
	}

	const total =
		block.total > 0
			? `<span class="count">${block.done} of ${block.total}</span><progress value="${block.done}" max="${block.total}"></progress>`
			: '';
	const heading = block.title === null ? '' : `<h2>${escapeHtml(block.title)}</h2>`;
	const head = heading || total ? `<div class="group-head">${heading}${total}</div>` : '';

	return `<section class="group">${head}<ul>${block.rows.map(rowHtml).join('')}</ul></section>`;
}

/**
 * The whole page.
 *
 * `nonce` is the webview's, and every inline style and script must carry it or
 * the content security policy drops it.
 */
export function previewHtml(blocks: readonly Block[], nonce: string): string {
	const body = blocks.length
		? blocks.map(blockHtml).join('')
		: '<p class="empty">Nothing in this file yet. Switch to Raw to start writing.</p>';

	return `<style nonce="${nonce}">${STYLE}</style><main>${body}</main><script nonce="${nonce}">${CLIENT}</script>`;
}

/**
 * The whole of the browser-side script.
 *
 * Deliberately this small. Everything above is unit tested in Node and every
 * DOM assertion is made against real markup in a real browser, but this is the
 * one piece that only exists inside the webview - so the less of it there is,
 * the less lives where a test cannot follow. It delegates from the document
 * rather than binding per button, so re-rendering does not have to rebind.
 */
export const CLIENT = `
const vscode = acquireVsCodeApi();
document.addEventListener('click', (event) => {
	const box = event.target.closest('.box');
	if (!box) return;
	vscode.postMessage({ type: 'cycle', line: Number(box.dataset.line) });
});
`;
