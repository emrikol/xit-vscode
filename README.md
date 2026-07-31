# xit!

This extension provides language support for [xit!](https://xit.jotaen.net/).

It implements the [x]it! specification v1.1, plus comments, which are a [fork](https://github.com/emrikol/xit) of the specification and are not part of the official format.

- [Syntax Highlighting](#syntax-highlighting)
- [Comments](#comments)
- [Development](#development)
- [Shortcuts](#shortcuts)
- [Snippets](#snippets)

## Syntax Highlighting

![screenshot showing the syntax highlighting](assets/screenshots/01.png)

### Customization

If the colors and looks of the syntax highlighting is not correct or as fancy as you want to, you can try to edit the `tokenColorCustomizations` in the user settings.

```json
{
    "editor.tokenColorCustomizations": {
        "textMateRules": [{
            // Replace this with the scope you want to edit.
            // Available scopes are:
            // - markup.other.task.title.xit
            // - markup.other.task.checkbox.open.xit
            // - markup.other.task.checkbox.ongoing.xit
            // - markup.other.task.checkbox.checked.xit
            // - markup.other.task.checkbox.obsolete.xit
            // - markup.other.task.checkbox.in-question.xit
            // - markup.other.task.checkbox.waiting.xit
            // - markup.other.task.description.closed.xit
            // - markup.other.task.priority.xit
            // - markup.other.task.date.xit
            // - markup.other.task.tag.xit
            // - markup.other.task.tag.name.xit
            // - markup.other.task.tag.value.xit
            // - markup.other.comment.xit
            "scope": "markup.other.task.checkbox.open.xit",
            "settings": {
                // Customize open checkbox color
                "foreground": "#00FF00",
                // ... and the fontStyle
                "fontStyle": "bold"
            }
        }]
    }
}
```

### Strikethrough Not Working?

If closed tasks (completed/obsolete) are not striketroughed, then you may want to explicitly specify that the strikethrough scope is striketroughed. This is happening because your theme did not specify the striketrough rule.

```json
{
    "editor.tokenColorCustomizations": {
        "[Theme That Is Not Working]": {
            "textMateRules": [
                {
                    "scope": "markup.strikethrough",
                    "settings": {
                        "fontStyle": "strikethrough"
                    }
                }
            ]
        }
    }
}
```

## Waiting

`[>]` means the item should happen, you cannot act on it, and someone or something else holds it.

```
[>] Waiting on the contract to come back
[@] Writing the release notes
[ ] Publish
```

None of the five statuses in the specification covers this. `[@]` ongoing means you are doing it, and `[?]` in question means it is unclear the thing should happen at all. Status is the primary axis of the format — it is why the checkbox is the leftmost thing on the line — and waiting gates what you can do, which is what a status is for. A tag would describe it; only a status gates it.

A waiting item is outstanding: it is not finished, so it appears in the workspace view and the shuffle cycle passes through it. Toggling one checks it, on the grounds that what you do to a waiting item when it stops waiting is finish it.

`>` was chosen rather than any other character, and the choice is measured rather than aesthetic. The syntax guide names the characters it considers invalid — `[*]`, `[o]`, `[X]`, and `[ ]` with a non-breaking space — and `>` is not among them, so no example in the conformance corpus changes meaning and the divergence costs nothing. `*` or `o` would each have flipped one example from invalid to valid. It also collides with nothing: priority uses `!` and `.`, and the due-date arrow is unambiguous inside brackets.

**This is a fork of the format.** Other [x]it! tools read `[>] Waiting` as neither an item nor a title, so the line disappears from their lists rather than rendering oddly. That is a worse failure than the other forks here cost, and it is accepted deliberately — see [emrikol/xit](https://github.com/emrikol/xit).

## Comments

A comment occupies whole lines. It starts with `<!--` at the beginning of a line, and ends with `-->` followed by nothing but spaces. Both may be on the same line.

```
<!-- This list is on hold -->
[ ] An item

<!--
[ ] This item is commented out
[ ] So is this one
-->
```

A comment does not split a group, so the items on either side of it stay in one group. A comment cannot appear inside an item, between its description lines. An unterminated comment runs to the end of the file.

Comments are a fork of the [x]it! specification, not part of the official format, so other [x]it! tools will not understand them. See [emrikol/xit](https://github.com/emrikol/xit).

## In Markdown

A fenced code block tagged `xit` is highlighted inside any Markdown file.

````markdown
Notes from the meeting.

```xit
Follow-ups
[ ] ! Write it up -> 2026-08-14 #work
[x] Book the room
```
````

This is the format author's own suggestion for keeping a list inside a larger document, from [discussion #10](https://github.com/jotaen/xit/discussions/10). Nothing about the fence is special to this extension: ` ``` ` and `~~~` both work, the language name is case-insensitive, and the block is ordinary Markdown everywhere else.

## Subtasks

An item indented under another is a subtask. **One tab per level.**

```
[ ] Ship the release
	[x] Write the notes
	[x] Tag the commit
	[ ] Publish
```

There is no depth limit, on purpose. A cap would have to live in the TypeScript and in the diagnostics and could not live in the grammar, which nests by back-referencing its parent's indentation and so cannot count; the highlighting and the diagnostics disagreeing about one line is worse than no limit at all.

Check the last outstanding subtask and the parent checks itself, all the way up the nest. Uncheck one and the parent reopens, because a ticked parent above an unticked child states something false. Turn it off with `xit.autoCheckParents`. It only ever moves an item between open and checked — an ongoing, obsolete or in-question parent was set deliberately and is left alone.

**Spaces do not nest.** This rule was looser to begin with — "two or more spaces, or one tab, from the previous level" — and that was our own invention and too loose to keep. A three-space line became a child of a two-space one, so a single stray space created a nesting level and nothing said anything. Tabs for indentation, spaces for alignment: nesting is structure and should scale to whatever depth you like a level to look, so it is a tab.

A space-indented checkbox is not lost by the change. Indentation only decides which item is the parent, so such a line becomes a sibling rather than a child, and the Problems panel reports it as `cannot-nest`. Four spaces or more stays silent, because that is a description continuation and a continuation may begin with a bracket.

Description continuations are unchanged: four spaces, or a tab. Four is not arbitrary — `[ ] ` is exactly four columns, so the continuation lands under the first letter of the description. A tab is however many columns the reader's tab stop says, which is four here and eight on GitHub and in most terminals, so spaces are what keep that alignment true everywhere. The tab is kept alongside them because otherwise the Tab key would nest a subtask and break a continuation. `.xit` files default to `editor.insertSpaces: false`, so Tab inserts a real tab.

Separating the two rules had an unexpected reward. The syntax guide's `description/8` says "Square brackets in the description (even at the beginning of subsequent lines) are not recognised as checkboxes", with a four-space example — and that example agrees with this grammar again, so tightening a rule for its own reasons gave a conformance divergence back.

A closed parent strikes through its own description, but not its subtasks: an open subtask under a checked parent is not done, and is not drawn as though it were. A subtask struck through is one that is closed in its own right.

**This is a fork of the format.** [Discussion #2](https://github.com/jotaen/xit/discussions/2) is the most-upvoted open request on [x]it!, at 21, and jotaen has not adopted it — his stated hesitation is whether editors can implement it at all. Other xit tools will read a subtask as the parent's description text, which still reads correctly to a person, but the nesting is ours alone.

The one thing it costs: a description continuation indented with a tab can no longer begin with a literal `[ ]`, because that is a subtask. At four spaces it can, which is why the guide's own example of exactly that agrees with this grammar.

## Overdue Dates

A due date whose period has passed is marked, and one more than a fortnight past is marked again in a second colour.

| Setting | Default | |
| --- | --- | --- |
| `xit.overdueDueDates` | `true` | Turn the marking off entirely. |
| `xit.overdueDueDateStyle` | `border-and-background` | `border-and-background`, `background`, `border` or `underline`. |
| `xit.criticallyOverdueAfterDays` | `14` | Days past the end of the period before the second colour. `0` uses one colour for everything. |

Six theme colours are contributed, so any of it can be recoloured: `xit.overdueDueDateBackground`, `xit.overdueDueDateForeground`, `xit.overdueDueDateBorder`, and the same three under `xit.criticallyOverdueDueDate…`.

A due date names a period, not always a day, so it counts as passed only once the whole period has ended:

| Written | Overdue from |
| --- | --- |
| `-> 2026-01-31` | 1 February 2026 |
| `-> 2026-01` | 1 February 2026 |
| `-> 2026-Q1` | 1 April 2026 |
| `-> 2026-W01` | 5 January 2026 |
| `-> 2026` | 1 January 2027 |

Weeks follow ISO 8601, so week 1 is the one containing the first Thursday of the year, and a week can end in the following year: `-> 2022-W52` runs out on 1 January 2023.

Only the first due date of an item counts, as the specification requires, and this applies to `.xit` files only — not to xit inside a Markdown fence.

### Why the filled styles set the text colour too

The two styles that paint a background also set the foreground, and they cannot be separated. A background the extension chooses, under text the theme chooses, is a pair of colours that have never met: the first version of this did exactly that, and in Monokai a purple `#AE81FF` date landed on the amber fill at 2.73:1, down from 5.23:1 with no marking at all. Lowering the opacity did not rescue it, and three bundled themes are already below 4.5:1 before anything is drawn, so no fixed threshold was even reachable.

Owning both sides fixes it by construction — the same pair in every theme, including ones written after this, at 9.36:1 on dark and 5.54:1 on light. The `border` and `underline` styles own neither side, which is equally safe: the text keeps exactly the contrast the theme gave it.

The critical tier is bold as well as red. Amber and red are chosen to weigh the same so they read as one family, which leaves hue as the only thing between them, and amber against red is the pair red-green colour blindness collapses. WCAG SC 1.4.1 asks that colour not be the only cue, so weight is the one that carries.

`test/contrast.test.mjs` computes all of this against the seventeen themes VS Code ships, on every commit.

## Workspace Items

A sidebar listing every outstanding item across every `.xit` file in the workspace, grouped by how urgent it is: critically overdue, overdue, due soon, later, no due date. Click a row to open the file at that line.

The thresholds are the same ones the editor decorations use, so the sidebar and the file never disagree about what is late. `xit.dueSoonWithinDays` sets the window for "due soon", default 7.

Checked and obsolete items are hidden; the toolbar toggles them back. Both count as finished, for opposite reasons — one was done, the other never will be — and neither is outstanding.

This is the part that makes a plain-text todo list bearable across more than one file. Three people built it outside VS Code before this existed: a shell script in [#12](https://github.com/jotaen/xit/discussions/12), an HTML view in [#7](https://github.com/jotaen/xit/discussions/7), and a whole terminal UI in [#38](https://github.com/jotaen/xit/discussions/38), whose author described his todos as "littered with undone, forgotten `[ ] things`".

## Problems

The syntax highlighting cannot check everything the specification asks for, and one rule it cannot check is a `MUST`:

> The due date value MUST be representable by the gregorian calendar.

No regular expression counts the days in February, so `-> 2026-02-31` highlights as a perfectly good due date. It is now reported as a problem instead. So are a checkbox that was clearly meant to be one and is not, a comment that is never closed and so silently swallows the rest of the file, and a second due date in an item — legal, and disregarded, which is the part nobody expects.

Only the impossible date is an error. Turn the lot off with `xit.diagnostics`.

## Completion Dates and Repeats

Both use tags rather than new syntax, so a file using them still reads correctly in every other [x]it! tool.

`xit.stampCompletionDate`, **off by default**, records when an item was checked and removes the record if it is reopened. `xit.completionDateTag` names the tag, default `done`. This is the format author's own suggestion, from [#59](https://github.com/jotaen/xit/discussions/59): `[ ] Paint the room #created=2023-02-01 #completed=2023-03-04`.

An item tagged `#repeat=` is rescheduled when you check it — the checked one stays, and its next occurrence is inserted below:

```
[x] Water the plants -> 2026-08-03 #repeat=weekly
[ ] Water the plants -> 2026-08-10 #repeat=weekly
```

Intervals are `daily`, `weekly`, `monthly`, `quarterly`, `yearly`, or a count such as `3d`, `2w`, `6m`. The date keeps whichever pattern it was written in, so `-> 2026-01 #repeat=monthly` becomes `-> 2026-02`, a month rather than a day in February. An interval that is not recognised does nothing at all: scheduling something on a date nobody asked for is worse than not scheduling it.

## Outline and Folding

Titles and items fill the Outline panel, with subtasks nested under their parents, which also gives Go to Symbol and breadcrumbs. Due dates show beside each row, so the outline doubles as a due-date list.

Items fold with their subtasks and continuations, groups fold under their title, and comment blocks fold. VS Code folds by indentation without any of this, and folds this format wrong: it cannot tell a description continuation from a subtask, and does not know that a blank line ends an item.

## Development

```sh
npm install            # also installs the git hooks
npm test               # build, then run the unit tests
npm run test:web       # run the integration tests in a headless browser
npm run test:integration   # run the same tests in desktop VS Code
npm run open-web:demo  # serve a real VS Code in the browser, on demo/
npm run icons          # re-render the icons from their SVG sources
```

`npm install` points `core.hooksPath` at `.githooks`, so the hooks install themselves with no extra dependency. `pre-commit` runs the unit tests. `pre-push` runs those, then `test:web`, then confirms the extension still packages, which catches manifest mistakes the tests cannot see. Both take `--no-verify` if you need to get past them.

The grammar tests tokenize through `vscode-textmate` and `vscode-oniguruma`, the same libraries VS Code uses, so they exercise the real Oniguruma engine rather than JavaScript's regular expressions. The conformance fixture is the reference `test.xit` from [jotaen/xit-sublime](https://github.com/jotaen/xit-sublime).

### The two integration runs

`src/test/extension.test.ts` is one suite that runs in both extension hosts.

- **`npm run test:web`** bundles it for a web worker and runs it in a headless Chromium through `@vscode/test-web`. Nothing appears on screen. This is the one on the pre-push hook.
- **`npm run test:integration`** runs it in desktop Electron through `@vscode/test-cli`. It opens a real VS Code window that takes focus for a few seconds. Run it by hand before anything that matters.

The desktop run cannot be made quiet, and it is worth writing down why so nobody spends an afternoon on it again. `@vscode/test-electron` has no headless mode on any platform; it launches the real application. On Linux the usual answer is to run it under `xvfb`, a virtual X display. macOS has no equivalent: its window server is not detachable, and there is no `xvfb-run` for Quartz. Hiding the window is not an option either, because the tests need a focused editor. Hence the split.

Two things about the web run are easy to get wrong:

- `--headless` has to be passed explicitly. `@vscode/test-web` documents it as defaulting to true when `--extensionTestsPath` is given, and on the command line it does not: `minimist` is told `headless` is a boolean flag, and minimist sets an absent boolean flag to `false` rather than `undefined`, so the `options.headless ?? …` fallback never fires. A test in `test/manifest.test.mjs` keeps the flag in the script.
- `src/test/index.ts` lists its test files one `import()` at a time. esbuild has no equivalent of the `require.context` glob the official sample uses, so a new test file that nobody adds to that list would never run and the suite would still report green. `test/bundle.test.mjs` compares the list against `src/test/*.test.ts`.

Neither host may see Node. The tests read no files and call no `require`; the handful of manifest values they need are literals in `src/test/manifest.ts`, checked against `package.json` by the unit suite.

### How the highlighting is put together

One structural implementation, one oracle, and code only where a grammar cannot reach.

**The grammar does everything structural.** `syntaxes/xit.tmLanguage.json` is the only place that knows what an item, a priority, a due date or a tag looks like.

**The conformance suite is the oracle.** The author's [syntax guide](https://xit.jotaen.net/syntax-guide) marks up every example with the token it is expected to be, which makes the page an expected-output corpus. `npm run corpus` rebuilds `test/fixtures/syntax-guide.json` from it; `test/conformance.test.mjs` compares, in both directions, and lists the handful of deliberate divergences with a reason for each. It is not on any hook, because a push should not fail because a website was edited.

**There is deliberately no semantic token provider.** It is the obvious idea, another fork does it, and the format author has said VS Code's engine is one of the better ones for it. The reason not to is not activation cost, which is negligible. It is that semantic highlighting is opt-in per theme and can be switched off, so the grammar has to stay correct on its own regardless. A provider therefore never replaces the grammar, it duplicates it — and the copy that is not the fallback is the one that silently falls behind.

**Date arithmetic is the exception**, because no grammar can know what today is. That is `src/dueDate.ts`, drawn with a decoration rather than a semantic token, so it adds a rule the grammar does not have instead of restating one it does.

**Where duplication is forced, it is detected rather than avoided.** The decoration has to find due dates itself, and VS Code exposes no API for reading TextMate tokens from an extension, so there is no shared source to be had. `test/dueDate.test.mjs` runs the whole corpus through both the grammar and the TypeScript matcher and fails on one character of disagreement. Two other things in this repo are held the same way: the manifest literals in `src/test/manifest.ts` against `package.json`, and the test-file list in `src/test/index.ts` against `src/test/*.test.ts`.

### Divergences from upstream, on purpose

Kept here so they are not silently "fixed". Each is also recorded where it lives, with the discussion it came from.

- **A tag must follow a space or punctuation**, so `a#tag` holds no tag. The spec is silent, and jotaen answered [#51](https://github.com/jotaen/xit/discussions/51) with "Currently, yes" — but his own `xit-sublime` rule carries the same lookbehind, so the reference implementation disagrees with the answer.
- **Additional spaces before a priority are allowed.** Spec §Item: "Additional space characters MAY appear." The syntax guide says the opposite and marks the line invalid.
- **A malformed priority does not invalidate the checkbox.** The guide drops all highlighting from `[ ] .!. Invalid`; nothing in the spec says a bad priority unmakes a checkbox, and `xit-sublime` agrees with us here.
- **Comments** (`<!--` … `-->`) are a fork of the format, not part of it.

`npm run open-web` serves the conformance fixture and `npm run open-web:demo` serves `demo/showcase.xit`, both in a real VS Code in the browser with this extension loaded. That is the only way to check what the grammar actually looks like rather than what it ought to look like.

The extension runs in both hosts: `dist/extension.js` for desktop and `dist/web/extension.js` for vscode.dev and github.dev. Both come from the same source. Nothing here imports from Node, and `test/bundle.test.mjs` keeps it that way.

## Shortcuts

The extension provides shortcuts for toggling/shuffling checkbox state. The shortcuts are configured by default as shown below:

- `ctrl+space` - Toggle checkboxes if available, else trigger editor suggestions.
- `ctrl+alt+x` - Toggle all selected checkboxes.
- `ctrl+alt+d` - Shuffle all selected checkboxes. This will shift the checkbox state to `' ' -> '@' -> '>' -> '~' -> '?' -> 'x'`.

## Snippets

- `u` - Unchecked (`[ ] `)
- `a`/`@` - Ongoing (`[@] `)
- `w`/`>` - Waiting (`[>] `)
- `o`/`~` - Obsolete (`[~] `)
- `x` - Checked (`[x] `)
- `q` - Question (`[?] `)
- `c` - Comment (`<!--  -->`)
- `cb` - Comment block (`<!--` / `-->` on their own lines)
