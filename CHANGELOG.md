# Change Log

All notable changes to the "xit" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.1.0] — not published yet

### Added

- **Marked titles.** A title is now written `# Groceries`. The specification defined a title by what it is *not*, which left the format with no invalid state for a line: `- [ ] Buy milk` read as a heading and the task disappeared from every list. Anything unmarked is now an error you can see. A fork.
- **A sixth status, `[>]` waiting** - the item should happen, you cannot act on it, and someone else holds it. None of the five covered that. A fork, and the first whose failure mode in another [x]it! tool is a lost task rather than a mis-rendered line.
- **Start dates,** `<- 2026-09-01`: the earliest day an item can be worked on, and the one real gap in the format. The same date patterns as the due date, read from the first day of the period rather than the last.
- **One item waiting on another,** with `#id=` and `#after=`. Ids are generated rather than derived, because sorting and archiving rewrite lines. `#after=` is clickable; a blocked item gets its own group; an unknown id, a duplicate, a cycle and waiting on something finished are all reported.
- **Priority without dots.** The dots were alignment padding, which is presentation stored in the document, and three of the guide's seven priority rules existed only to police them. A fork.
- **Time estimates,** `#est=2h`, totalled per group in the sidebar. A group with unestimated items shows `6h + 4`, because a total that quietly leaves things out is a number that lies.
- **Creation dates,** off by default, recorded as you finish typing a checkbox. Deliberately narrow: a pasted block is not stamped, and neither is undo.
- **File-level directives** in a comment - `<!-- xit: tags=work -->` and `<!-- xit: archive=Done -->`. An unknown key is ignored in silence, so a directive written for a later version cannot break an earlier one.
- **Sort Group**, by priority then due date, moving whole items rather than lines.
- **Archive Finished Items**, to a group at the end of the same file. One edit in one document, so undo puts it back.
- **Postpone**, pushing the due date forward - counted from today, because that is what postponing means.
- **Migrate to the Current Format**, applying every breaking change in one pass. Idempotent, and one edit so undo takes it back.
- **Tag completion** for names and values, drawn from the whole workspace.
- **An overdue count in the status bar**, silent when nothing is overdue.
- **URLs are highlighted,** and a `#fragment` in one is no longer read as a tag.
- A drift detector for the status set, which was written out by hand in eleven places with nothing checking they agreed, and another for priority.

- A workspace view: every outstanding item across every `.xit` file, grouped by urgency, in a sidebar. The hole three people filled outside VS Code first - a shell script ([#12](https://github.com/jotaen/xit/discussions/12)), an HTML view ([#7](https://github.com/jotaen/xit/discussions/7)) and a terminal UI ([#38](https://github.com/jotaen/xit/discussions/38)).
- Problems for the rules the grammar cannot express, including one specification MUST it can never enforce: a due date the calendar does not have, such as `-> 2026-02-31`. Also a malformed checkbox, an unterminated comment, a line that is not an item, a title or a comment, an indent that cannot nest, a broken link between items, and the places the format disregards what you wrote without saying so. `xit.diagnostics`.
- Completion dates, off by default, recorded as a tag rather than new syntax - syntax is for what you author, tags are for what the editor records. `xit.stampCompletionDate`. The format author's own suggestion in [#59](https://github.com/jotaen/xit/discussions/59).
- Repeating items, via a `#repeat=` tag. Checking one inserts its next occurrence below, with the due date advanced and its pattern kept. Intervals include `weekdays`, a named day such as `monday`, and an `-after` suffix that counts from the day it was checked rather than from the due date. [Discussion #5](https://github.com/jotaen/xit/discussions/5).
- The Outline panel, Go to Symbol and breadcrumbs, with subtasks nested under their parents and due dates shown beside each row.
- Folding for items with subtasks, groups under their title, and comment blocks.
- Subtasks. An item indented under another by one tab per level is a subtask, to any depth. Checking the last outstanding subtask checks the parent, all the way up; unchecking one reopens it. `xit.autoCheckParents` turns that off. This is a fork of the format - [discussion #2](https://github.com/jotaen/xit/discussions/2) is the most-upvoted open request on [x]it! and is not adopted upstream, so other tools will read a subtask as the parent's description text. A tab also continues a description, which the spec does not allow either - without that, Tab would nest a subtask but break a continuation. `.xit` files default to `editor.insertSpaces: false`. It costs one thing: a description continuation at a tab indent can no longer begin with a literal `[ ]`.
- Due dates whose period has passed are marked, and ones more than a fortnight past are marked again in a second colour. A due date names a period rather than always a day, so it counts as passed only once the period has ended: `-> 2026` becomes overdue on 1 January 2027, not in March. Weeks follow ISO 8601. Four styles (`border-and-background`, `background`, `border`, `underline`), a configurable threshold for the second tier, six contributed theme colours, and an off switch. This is the only thing here that a grammar cannot do, because it needs to know what today is; it is drawn as a decoration rather than through semantic tokens, so it adds a rule the grammar lacks instead of restating one it has.
- Highlighting for ```` ```xit ```` fenced code blocks in Markdown, so a list can live inside a larger document. This is the format author's own suggestion in [discussion #10](https://github.com/jotaen/xit/discussions/10), the most-upvoted open request on the format.
- A conformance suite built from the author's own [syntax guide](https://xit.jotaen.net/syntax-guide). Every example on that page is marked up with the token it is expected to be, which makes it an oracle; it found four defects that the hand-written tests did not.
- Web extension support. The extension now runs on vscode.dev and github.dev. It had no `browser` entry point, and an extension without one is ignored by the web extension host entirely.
- An extension icon and a file icon for `.xit` files. The artwork is deliberately generic; the [x]it! logo belongs to the official project.
- Integration tests, run in a real Extension Development Host, covering activation, command registration and the edits themselves. One suite runs in both hosts: `npm run test:web` in a headless Chromium, and `npm run test:integration` in desktop Electron.
- Manifest and bundle tests, so a contributed path that does not exist, a keybinding for a command that was never contributed, or a Node builtin in the web bundle fail on commit rather than at run time.
- First-line detection, so an extensionless file that opens with a checkbox is recognised without picking the language by hand.
- `npm run open-web` and `npm run open-web:demo`, which serve a real VS Code in the browser with the extension loaded.
- Comments, written with `<!--` and `-->` on whole lines. These are a [fork](https://github.com/emrikol/xit) of the [x]it! specification and are not part of the official format.
- Unit tests. The grammar is tokenized through `vscode-textmate` and `vscode-oniguruma`, so tests run on the same engine VS Code uses. The conformance fixture is the reference test file from `jotaen/xit-sublime`.
- Scopes `markup.other.task.tag.name.xit`, `markup.other.task.tag.value.xit` and `markup.other.comment.xit`.
- `markup.other.task.description.closed.xit`, which the README documented but the grammar never emitted.

### Changed

- **Nesting is one tab per level; spaces no longer nest.** The old rule was our own and too loose - a three-space line became a child of a two-space one, so a stray space created a level in silence. A space-indented item is not lost, only unnested, and is reported as `cannot-nest`.
- A second due date in an item is a warning rather than a hint. Silent disregard is the worst property a plain-text format can have, and a hint is not visible enough to say "this does nothing".
- `xit.refreshItems` returns its promise, so awaiting the command actually awaits the refresh.

### Fixed

- The extension was disabled in any folder the user had not trusted. It reads and rewrites the active document and nothing else, so it now declares support for untrusted workspaces.
- Bracket pair colorization repainted `[` and `]` over the checkbox colour, leaving every checkbox with blue ends and a coloured middle. `[~]` was the only one that escaped, because its scope is a comment. The square brackets are no longer declared as brackets.
- The toggle and shuffle commands dropped the promise from `editor.edit`, so a caller that awaited them saw the document before the edit landed.
- Priority was not highlighted on in-question items (`[?] ! Task`). The v1.1 change that added `[?]` did not update the priority pattern.
- In-question checkboxes carried the ongoing scope. They now use `markup.other.task.checkbox.in-question.xit`.
- Every scope name was comma separated rather than space separated, so scopes reached themes with a trailing comma, e.g. `variable.function.xit,`.
- Week due dates such as `-> 2022-W01` were cut short at the `W`.
- Due dates accepted malformed values such as `-> 2022-01/31`, `-> 2022-13-01` and `-> 2022-01-31T10:00`.
- Only the first due date in an item is highlighted, across its continuation lines, as the spec requires.
- Tag names swallowed trailing punctuation and any other non-space character, so `#tag!` and `(#tag)` were wrong, and `#tag1/#tag2` read as one tag.
- Priority was not highlighted when more than one space followed the checkbox, though the spec allows additional spaces.
- `[]` and `[  ]` were treated as checkboxes. A checkbox is exactly three characters.
- A line starting with `[` could be highlighted as a title.
- Toggle and shuffle commands acted on malformed checkboxes such as `[]`, and passed an undefined status to the replacer.
- All three commands threw a TypeError when invoked from the command palette with no editor focused, because they asserted `activeTextEditor` non-null.
- Selected line numbers were sorted lexicographically, so line 10 sorted before line 2.
- The internal `xit.suggest` command was listed in the command palette. Toggle and shuffle are now listed only for `.xit` files.

### Changed

- Checkbox command logic moved to `src/checkbox.ts` so it can be tested without the `vscode` module. Toggle and shuffle behaviour is unchanged.
- Items are matched with `begin`/`end` rather than `begin`/`while`, so the grammar keeps state across an item's continuation lines.
- Minimum VS Code raised from 1.66 to 1.75, the oldest release that supports the current manifest. `@types/vscode` is pinned to that floor so the code cannot use API newer than the minimum it declares.
- TypeScript 4.5 to 7, `@types/node` 14 to 20, build target ES2020 to ES2022, and the stricter `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride` and `noFallthroughCasesInSwitch` checks.
- Removed the `onCommand:` activation events, which VS Code has inferred from contributed commands since 1.74. The extension now declares `onLanguage:xit` instead, so it runs whenever an xit file is open rather than waking on the first command. Marking overdue dates needs code, and it has to run without the user invoking anything.
- Dot-only priorities such as `[ ] ... Not important` are highlighted. Spec §Priority: "any number of exclamation marks (`!`) and dots (`.`)", and any number includes none. A test asserted the opposite on purpose.
- The `=` of a valueless tag is part of the tag. `#tag=` left it uncoloured in the middle of a coloured tag, the same defect the square brackets had.
- `[ ] ---> 2022-01-31` and `[ ] Due-> 2022-01-31` no longer highlight a due date. The guide: "Due dates can be surrounded by a space or punctuation (apart from a hyphen or slash)."
- `.claude` and source maps are no longer bundled into the extension.
- Publisher changed from `tscpp` to `emrikol`, so the extension identity is `emrikol.xit` rather than `tscpp.xit`. The publisher is a Marketplace account, not a credit line: the original `tscpp.xit` is a different extension and this build would otherwise collide with it. The LICENSE keeps Elias Skogevall's copyright notice, as MIT requires, with the fork's added beside it.
- Git hooks run the suite before a commit, and the suite, the integration tests and a packaging check before a push. They install themselves on `npm install` through `core.hooksPath`, with no extra dependency. The push hook runs the integration tests in a headless browser rather than in desktop Electron, which opened a VS Code window that took focus mid-push. `@vscode/test-electron` has no headless mode on any platform and macOS has no xvfb to hide it behind, so the desktop run stays a manual command.
- The extension is bundled with esbuild instead of shipped as raw `tsc` output, so activation loads one file rather than one per module.
- Manifest metadata the Marketplace uses: `license`, `keywords`, `homepage`, `bugs`, the object form of `repository`, `extensionKind`, and `capabilities.virtualWorkspaces`. Marketplace Q&A is turned off, because Issues, Discussions and pull requests are all closed on purpose.