# Change Log

All notable changes to the "xit" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.1.0] — not published yet

### Added

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