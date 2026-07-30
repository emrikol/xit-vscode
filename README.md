# xit!

This extension provides language support for [xit!](https://xit.jotaen.net/).

It implements the [x]it! specification v1.1, plus comments, which are a
[fork](https://github.com/emrikol/xit) of the specification and are not part of
the official format.

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

## Comments

A comment occupies whole lines. It starts with `<!--` at the beginning of a
line, and ends with `-->` followed by nothing but spaces. Both may be on the
same line.

```
<!-- This list is on hold -->
[ ] An item

<!--
[ ] This item is commented out
[ ] So is this one
-->
```

A comment does not split a group, so the items on either side of it stay in
one group. A comment cannot appear inside an item, between its description
lines. An unterminated comment runs to the end of the file.

Comments are a fork of the [x]it! specification, not part of the official
format, so other [x]it! tools will not understand them. See
[emrikol/xit](https://github.com/emrikol/xit).

## Development

```sh
npm install            # also installs the git hooks
npm test               # build, then run the unit tests
npm run test:integration   # run the tests inside a real VS Code
npm run open-web:demo  # serve a real VS Code in the browser, on demo/
npm run icons          # re-render the icons from their SVG sources
```

`npm install` points `core.hooksPath` at `.githooks`, so the hooks install
themselves with no extra dependency. `pre-commit` runs the unit tests.
`pre-push` runs those, then the integration tests, then confirms the
extension still packages, which catches manifest mistakes the tests cannot
see. Both take `--no-verify` if you need to get past them.

The grammar tests tokenize through `vscode-textmate` and `vscode-oniguruma`,
the same libraries VS Code uses, so they exercise the real Oniguruma engine
rather than JavaScript's regular expressions. The conformance fixture is the
reference `test.xit` from
[jotaen/xit-sublime](https://github.com/jotaen/xit-sublime).

The integration tests run inside an Extension Development Host with
`@vscode/test-cli`, which downloads a real VS Code on first use and caches it
in `.vscode-test/`.

`npm run open-web` serves the conformance fixture and `npm run open-web:demo`
serves `demo/showcase.xit`, both in a real VS Code in the browser with this
extension loaded. That is the only way to check what the grammar actually
looks like rather than what it ought to look like.

The extension runs in both hosts: `dist/extension.js` for desktop and
`dist/web/extension.js` for vscode.dev and github.dev. Both come from the
same source. Nothing here imports from Node, and `test/bundle.test.mjs`
keeps it that way.

## Shortcuts

The extension provides shortcuts for toggling/shuffling checkbox state. The shortcuts are configured by default as shown below:

- `ctrl+space` - Toggle checkboxes if available, else trigger editor suggestions.
- `ctrl+alt+x` - Toggle all selected checkboxes.
- `ctrl+alt+d` - Shuffle all selected checkboxes. This will shift the checkbox state to `' ' -> '@' -> '~' -> '?' -> 'x'`.

## Snippets

- `u` - Unchecked (`[ ] `)
- `a`/`@` - Ongoing (`[@] `)
- `o`/`~` - Obsolete (`[~] `)
- `x` - Checked (`[x] `)
- `q` - Question (`[?] `)
- `c` - Comment (`<!--  -->`)
- `cb` - Comment block (`<!--` / `-->` on their own lines)
