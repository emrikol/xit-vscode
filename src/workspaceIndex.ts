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

import { Collected, collect } from './collect';

export interface FileItems {
	uri: vscode.Uri;
	items: Collected[];
}

const PATTERN = '**/*.xit';

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
			watcher.onDidCreate((uri) => this.read(uri).then(() => this.changed.fire())),
			watcher.onDidChange((uri) => this.read(uri).then(() => this.changed.fire())),
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
					this.changed.fire();
				});
			}),
			vscode.workspace.onDidCloseTextDocument((document) => {
				// Back to whatever is on disk, since the buffer is gone.
				if (document.languageId === 'xit') void this.read(document.uri).then(() => this.changed.fire());
			}),
			vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
		);
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

		this.changed.fire();
	}

	private settle(run: () => void) {
		if (this.pending) clearTimeout(this.pending);
		this.pending = setTimeout(run, SETTLE);
	}

	private fromDocument(document: vscode.TextDocument) {
		const lines: string[] = [];
		for (let line = 0; line < document.lineCount; line++) lines.push(document.lineAt(line).text);
		this.files.set(document.uri.toString(), { uri: document.uri, items: collect(lines) });
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
			const text = new TextDecoder().decode(bytes);
			this.files.set(uri.toString(), { uri, items: collect(text.split(/\r?\n/)) });
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
