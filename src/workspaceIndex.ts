/**
 * Every xit item in the workspace, kept current.
 *
 * The only module here that touches the file system, and it does so through
 * `vscode.workspace.fs` rather than Node's `fs`. That is not a style
 * preference: the extension runs in a web worker on vscode.dev, where there
 * is no Node, and in a virtual workspace, where there are no files on a disk
 * at all. The manifest claims support for both.
 */

import * as vscode from 'vscode';

import { type Collected, collect, isOpen } from './collect';
import { type Reference, foldId, identities } from './link';
import { dateTags, estimateTag } from './settings';
import { type TagUsage, tagUsage } from './tag';

export interface FileItems {
	uri: vscode.Uri;
	items: Collected[];
	/** Ids declared in this file, folded, with the line each sits on. */
	ids: Map<string, number>;
	/** Tags in this file, for completion. Kept here because only the index has read every file. */
	tags: Map<string, TagUsage>;
}

const PATTERN = '**/*.xit';

/** `file` resolved beside `from`, with `.xit` added where it was left off. */
function beside(from: vscode.Uri, file: string): vscode.Uri {
	const name = file.endsWith('.xit') ? file : `${file}.xit`;
	return vscode.Uri.joinPath(from, '..', name);
}

/** Ids declared in a document, folded, with the line each sits on. */
function idsIn(lines: readonly string[]): Map<string, number> {
	return new Map(identities(lines).map((each) => [foldId(each.id), each.line]));
}

/** How long to wait after a keystroke before re-reading a document. */
const SETTLE = 300;

export class WorkspaceIndex implements vscode.Disposable {
	private readonly files = new Map<string, FileItems>();
	private readonly changed = new vscode.EventEmitter<void>();
	private readonly disposables: vscode.Disposable[] = [];
	private pending: ReturnType<typeof setTimeout> | undefined;

	readonly onDidChange = this.changed.event;

	constructor() {
		const watcher = vscode.workspace.createFileSystemWatcher(PATTERN);

		this.disposables.push(
			watcher,
			watcher.onDidCreate((uri) => this.read(uri).then(() => this.settled())),
			watcher.onDidChange((uri) => this.read(uri).then(() => this.settled())),
			watcher.onDidDelete((uri) => {
				this.files.delete(uri.toString());
				this.changed.fire();
			}),
			// An open document with unsaved edits is what the user is looking
			// at. An index built only from disk would disagree with the editor
			// in front of them, which is worse than being slightly stale.
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document.languageId !== 'xit') return;
				this.settle(() => {
					this.fromDocument(event.document);
					this.settled();
				});
			}),
			vscode.workspace.onDidCloseTextDocument((document) => {
				// Back to whatever is on disk, since the buffer is gone.
				if (document.languageId === 'xit') void this.read(document.uri).then(() => this.settled());
			}),
			vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
		);
	}

	/**
	 * The file and line a reference points at, or null.
	 *
	 * A reference naming no file means this one. A reference naming a file
	 * resolves it beside the file doing the referring, which is what anyone
	 * writing `#after="work-todo.xit#k3f9"` means by it, and `.xit` is added
	 * where it was left off.
	 */
	resolve(from: vscode.Uri, reference: Reference): { uri: vscode.Uri; line: number } | null {
		const uri = reference.file === null ? from : beside(from, reference.file);
		const file = this.files.get(uri.toString());
		if (!file) return null;

		const line = file.ids.get(foldId(reference.id));
		return line === undefined ? null : { uri, line };
	}

	/**
	 * Which items are blocked, once references across files are followed.
	 *
	 * `collect` already answers this for references within one file, which is
	 * the right answer for a document read on its own and the only one a pure
	 * function can give. This is the layer that knows what other files exist,
	 * so it is the layer that finishes the job - and it mutates `blocked`
	 * rather than threading a workspace through every pure function below.
	 */
	private resolveBlocked(): void {
		for (const file of this.files.values()) {
			for (const item of file.items) {
				if (item.blocked) continue;

				item.blocked = item.waitingOn.some((reference) => {
					if (reference.file === null) return false;
					const target = this.resolve(file.uri, reference);
					if (!target) return false;

					const held = this.files.get(target.uri.toString())!.items.find((each) => each.line === target.line);
					return held !== undefined && isOpen(held);
				});
			}
		}
	}

	/**
	 * Every tag in the workspace, merged across files.
	 *
	 * Merged here rather than per file because a tag invented in one file
	 * should be offered in every other - that is what makes tags worth using
	 * across a workspace instead of decaying into near-duplicates.
	 */
	tags(): Map<string, TagUsage> {
		const merged = new Map<string, TagUsage>();

		for (const file of this.files.values()) {
			for (const [key, usage] of file.tags) {
				const found = merged.get(key) ?? { spellings: new Map<string, number>(), values: new Set<string>() };
				for (const [name, count] of usage.spellings)
					found.spellings.set(name, (found.spellings.get(name) ?? 0) + count);
				for (const value of usage.values) found.values.add(value);
				merged.set(key, found);
			}
		}

		return merged;
	}

	/** Every file with items in it, in a stable order. */
	all(): FileItems[] {
		return [...this.files.values()].sort((a, b) => a.uri.toString().localeCompare(b.uri.toString()));
	}

	/** Re-read the whole workspace. */
	async refresh(): Promise<void> {
		this.files.clear();

		// The exclude argument is null rather than omitted, which is what
		// makes findFiles honour files.exclude and search.exclude. Without it
		// a repository with a large node_modules is scanned for nothing.
		const found = await vscode.workspace.findFiles(PATTERN, undefined);
		await Promise.all(found.map((uri) => this.read(uri)));

		// Open documents last, so unsaved edits win over what is on disk.
		for (const document of vscode.workspace.textDocuments) {
			if (document.languageId === 'xit') this.fromDocument(document);
		}

		this.resolveBlocked();
		this.changed.fire();
	}

	/** Re-resolve cross-file blocking, then announce. Every change needs both. */
	private settled(): void {
		this.resolveBlocked();
		this.changed.fire();
	}

	private settle(run: () => void) {
		if (this.pending) clearTimeout(this.pending);
		this.pending = setTimeout(run, SETTLE);
	}

	private fromDocument(document: vscode.TextDocument) {
		const lines: string[] = [];
		for (let line = 0; line < document.lineCount; line++) lines.push(document.lineAt(line).text);
		this.files.set(document.uri.toString(), {
			uri: document.uri,
			items: collect(lines, estimateTag(), dateTags()),
			tags: tagUsage(lines),
			ids: idsIn(lines),
		});
	}

	private async read(uri: vscode.Uri): Promise<void> {
		// An open copy is the truth; the file on disk may be behind it.
		const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
		if (open) {
			this.fromDocument(open);
			return;
		}

		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
			this.files.set(uri.toString(), {
				uri,
				items: collect(lines, estimateTag(), dateTags()),
				tags: tagUsage(lines),
				ids: idsIn(lines),
			});
		} catch {
			// Deleted between being found and being read, or unreadable. Not
			// worth a message: the watcher will bring it back if it returns.
			this.files.delete(uri.toString());
		}
	}

	dispose() {
		if (this.pending) clearTimeout(this.pending);
		this.changed.dispose();
		for (const disposable of this.disposables) disposable.dispose();
	}
}
