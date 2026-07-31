/**
 * Tests for ```xit fenced code blocks in Markdown.
 *
 * The feature is jotaen's own answer to Discussion #10, the most-upvoted open
 * request on the format ("Ability to add free/more text in the file"), which
 * he answered with "another approach would be to make use of embedded code
 * blocks" and a screenshot of it working in Sublime Text.
 *
 * The injection is tokenized on its own here, without a Markdown grammar to
 * inject into. Its patterns are top-level, so it tokenizes a fenced block by
 * itself; the injectionSelector only tells VS Code where to splice it in. The
 * alternative is loading VS Code's own Markdown grammar, which only exists on
 * disk after `npm run test:integration` has downloaded a copy, and a test that
 * silently skips itself on a clean checkout is worth very little.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { tokenize, scoped } from './tokenizer.mjs';

const SCOPE = 'markdown.xit.codeblock';
const EMBEDDED = 'meta.embedded.block.xit';

/** Tokenize a Markdown document through the injection. */
function md(...lines) {
	return tokenize(lines.join('\n'), SCOPE);
}

/** Text on a line carrying a scope, using the injection grammar. */
function on(line, fragment) {
	return scoped(line, fragment);
}

describe('xit in a Markdown code fence', () => {
	it('highlights an item inside the block', async () => {
		const lines = await md('```xit', '[ ] Do this', '```');
		assert.deepEqual(on(lines[1], 'task.checkbox.open'), ['[ ]']);
	});

	it('marks the block as embedded xit', async () => {
		// contributes.grammars maps this scope back to the xit language, which
		// is what makes comment toggling and the like work inside the fence.
		const lines = await md('```xit', '[ ] Do this', '```');
		assert.ok(on(lines[1], EMBEDDED).length, 'the content is not marked as embedded xit');
	});

	it('highlights every construct, not just the checkbox', async () => {
		const lines = await md('```xit', '[ ] ! Do this -> 2026-08-14 #tag="a value"', '```');
		const [item] = lines.slice(1);
		assert.deepEqual(on(item, 'task.priority'), ['!']);
		assert.deepEqual(on(item, 'task.date'), ['-> 2026-08-14']);
		assert.deepEqual(on(item, 'task.tag'), ['#tag="a value"']);
	});

	it('keeps the fences out of the embedded language', async () => {
		// If the inner rule swallows the closing fence, the rest of the
		// document is tokenized as xit and the Markdown below it loses its
		// highlighting entirely.
		const lines = await md('```xit', '[ ] Do this', '```');
		for (const index of [0, 2]) {
			assert.equal(on(lines[index], EMBEDDED).length, 0, `line ${index} is inside the embedded block`);
			assert.equal(on(lines[index], 'task.').length, 0, `line ${index} was tokenized as xit`);
		}
	});

	it('names the language on the opening fence', async () => {
		const [fence] = await md('```xit', '[ ] Do this', '```');
		assert.deepEqual(on(fence, 'fenced_code.block.language'), ['xit']);
	});

	it('stops at the closing fence', async () => {
		const lines = await md('```xit', '[ ] Inside', '```', '[ ] Outside');
		assert.deepEqual(on(lines[1], 'task.checkbox'), ['[ ]']);
		assert.deepEqual(on(lines[3], 'task.checkbox'), []);
	});

	it('leaves other languages alone', async () => {
		for (const language of ['js', 'markdown', 'xitx', '']) {
			const lines = await md('```' + language, '[ ] Do this', '```');
			assert.equal(on(lines[1], 'task.checkbox').length, 0, `\`\`\`${language} was claimed`);
		}
	});

	it('accepts the tilde fence and longer fences', async () => {
		// Markdown allows either character and any length from three up.
		for (const fence of ['~~~', '````', '~~~~~']) {
			const lines = await md(fence + 'xit', '[ ] Do this', fence);
			assert.deepEqual(on(lines[1], 'task.checkbox.open'), ['[ ]'], `${fence} did not open a block`);
		}
	});

	it('does not close a backtick fence with a tilde one', async () => {
		const lines = await md('```xit', '[ ] Inside', '~~~', '[ ] Still inside');
		assert.deepEqual(on(lines[3], 'task.checkbox.open'), ['[ ]']);
	});

	it('is case-insensitive about the language name', async () => {
		for (const name of ['xit', 'XIT', 'Xit']) {
			const lines = await md('```' + name, '[ ] Do this', '```');
			assert.deepEqual(on(lines[1], 'task.checkbox.open'), ['[ ]'], `\`\`\`${name} was not claimed`);
		}
	});

	it('carries item state across lines inside the block', async () => {
		// The whole reason the grammar uses begin/end rather than begin/while:
		// a continuation line belongs to the item above it. That has to keep
		// working through the injection, which is a second rule stack.
		const lines = await md('```xit', '[x] Done ...', '    ... and still done', '```');
		assert.ok(on(lines[2], 'task.description.closed').length, 'the continuation lost the item');
	});

	it('disregards a second due date inside the block, as it does outside', async () => {
		const lines = await md('```xit', '[ ] Task -> 2026-01-31 -> 2026-02-28', '```');
		assert.deepEqual(on(lines[1], 'task.date'), ['-> 2026-01-31']);
	});
});
