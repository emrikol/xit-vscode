# Change Log

All notable changes to the "xit" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added

- Comments, written with `<!--` and `-->` on whole lines. These are a
  [fork](https://github.com/emrikol/xit) of the [x]it! specification and are
  not part of the official format.
- Unit tests. The grammar is tokenized through `vscode-textmate` and
  `vscode-oniguruma`, so tests run on the same engine VS Code uses. The
  conformance fixture is the reference test file from `jotaen/xit-sublime`.
- Scopes `markup.other.task.tag.name.xit`, `markup.other.task.tag.value.xit`
  and `markup.other.comment.xit`.
- `markup.other.task.description.closed.xit`, which the README documented but
  the grammar never emitted.

### Fixed

- Priority was not highlighted on in-question items (`[?] ! Task`). The v1.1
  change that added `[?]` did not update the priority pattern.
- In-question checkboxes carried the ongoing scope. They now use
  `markup.other.task.checkbox.in-question.xit`.
- Every scope name was comma separated rather than space separated, so scopes
  reached themes with a trailing comma, e.g. `variable.function.xit,`.
- Week due dates such as `-> 2022-W01` were cut short at the `W`.
- Due dates accepted malformed values such as `-> 2022-01/31`,
  `-> 2022-13-01` and `-> 2022-01-31T10:00`.
- Only the first due date in an item is highlighted, across its continuation
  lines, as the spec requires.
- Tag names swallowed trailing punctuation and any other non-space character,
  so `#tag!` and `(#tag)` were wrong, and `#tag1/#tag2` read as one tag.
- Priority was not highlighted when more than one space followed the
  checkbox, though the spec allows additional spaces.
- `[]` and `[  ]` were treated as checkboxes. A checkbox is exactly three
  characters.
- A line starting with `[` could be highlighted as a title.
- Toggle and shuffle commands acted on malformed checkboxes such as `[]`, and
  passed an undefined status to the replacer.
- All three commands threw a TypeError when invoked from the command palette
  with no editor focused, because they asserted `activeTextEditor` non-null.
- Selected line numbers were sorted lexicographically, so line 10 sorted
  before line 2.
- The internal `xit.suggest` command was listed in the command palette. Toggle
  and shuffle are now listed only for `.xit` files.

### Changed

- Checkbox command logic moved to `src/checkbox.ts` so it can be tested
  without the `vscode` module. Toggle and shuffle behaviour is unchanged.
- Items are matched with `begin`/`end` rather than `begin`/`while`, so the
  grammar keeps state across an item's continuation lines.
- Minimum VS Code raised from 1.66 to 1.75, the oldest release that supports
  the current manifest. `@types/vscode` is pinned to that floor so the code
  cannot use API newer than the minimum it declares.
- TypeScript 4.5 to 7, `@types/node` 14 to 20, build target ES2020 to ES2022,
  and the stricter `noUnusedLocals`, `noUnusedParameters`,
  `noImplicitOverride` and `noFallthroughCasesInSwitch` checks.
- Removed the `onCommand:` activation events, which VS Code has inferred from
  contributed commands since 1.74.
- `.claude` and source maps are no longer bundled into the extension.
- Git hooks run the suite before a commit, and the suite plus a packaging
  check before a push. They install themselves on `npm install` through
  `core.hooksPath`, with no extra dependency.