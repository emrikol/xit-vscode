/**
 * The preview's markup, in a real browser.
 *
 * Everything else here asserts on strings. A string assertion cannot tell you
 * that `<ul>` closed, that the nesting came out as nesting rather than as
 * siblings, or that clicking a button actually posts a message - and the two
 * bugs this feature's predecessor shipped were both in exactly that kind of
 * seam, where the test covered the shape I had built rather than the thing a
 * person does.
 *
 * So this loads the generated HTML into headless Chromium, parses it as a
 * browser parses it, and clicks. Playwright and the browser are already here
 * for the integration run.
 *
 * It is not on the pre-commit hook - launching a browser per commit is too
 * slow - it runs with the integration suite before a push.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const require_ = createRequire(import.meta.url);
const { preview, previewHtml } = require_('../../out/preview.js');

const THRESHOLDS = { today: 20260731, criticalAfterDays: 14, soonWithinDays: 7 };

let browser;
let page;

before(async () => {
	browser = await chromium.launch();
});

after(async () => {
	await browser?.close();
});

/**
 * Render a document into a fresh page, as the webview would.
 *
 * A page per test rather than one shared. Sharing it meant a test that loaded
 * markup of its own left the next one without the stub, and the failure looked
 * like a broken click handler rather than a dirty fixture.
 */
async function render(lines) {
	const html = previewHtml(preview(lines, { thresholds: THRESHOLDS }), 'test-nonce');
	// The webview API the client script expects, defined before it runs.
	// `addInitScript` does not fire for `setContent`, so the stub is prepended
	// to the document rather than injected on navigation.
	const stub =
		'<script>window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:(m)=>window.__posted.push(m)});</script>';
	await page?.close();
	page = await browser.newPage();
	await page.setContent(stub + html);
	return html;
}

describe('the markup a browser actually parses', () => {
	it('nests a subtask inside its parent, not beside it', async () => {
		// The assertion a string check cannot make. `<li><ul><li>` and
		// `<li></li><ul><li>` differ by one character and mean opposite things.
		await render(['[ ] Parent', '\t[ ] Child']);
		const nested = await page.$$eval('li > ul > li', (nodes) => nodes.length);
		const top = await page.$$eval('main > section > ul > li', (nodes) => nodes.length);
		assert.equal(top, 1, 'the parent should be the only top-level item');
		assert.equal(nested, 1, 'the child should be inside the parent');
	});

	it('closes every tag it opens', async () => {
		// A browser silently repairs bad markup, so the check is that what it
		// parsed round-trips to the same thing.
		const html = await render(['# Todos', '[ ] One', '\t[x] Two', '<!--', 'parked', '-->', 'bare line']);
		const reparsed = await page.evaluate(() => document.querySelector('main').outerHTML);
		await page.setContent(html.replace(/<main>[\s\S]*<\/main>/, reparsed));
		const again = await page.evaluate(() => document.querySelector('main').outerHTML);
		assert.equal(again, reparsed, 'the browser had to repair the markup');
	});

	it('gives every checkbox a real button and an accessible name', async () => {
		await render(['[ ] Milk', '[x] Bread']);
		const boxes = await page.$$eval('.box', (nodes) =>
			nodes.map((node) => ({ tag: node.tagName, type: node.type, label: node.getAttribute('aria-label') })),
		);
		assert.equal(boxes.length, 2);
		for (const box of boxes) {
			assert.equal(box.tag, 'BUTTON', 'a div with a click handler is an anti-pattern');
			assert.equal(box.type, 'button', 'an untyped button submits');
			assert.ok(box.label && box.label.length > 0, 'icon-only button without aria-label');
		}
		assert.match(boxes[0].label, /Open: Milk/);
	});

	it('reports progress with a real progress element', async () => {
		await render(['# Shopping', '[x] Milk', '[ ] Bread', '[ ] Eggs']);
		const bar = await page.$eval('progress', (node) => ({ value: node.value, max: node.max }));
		assert.deepEqual(bar, { value: 1, max: 3 });
		assert.equal(await page.textContent('.count'), '1 of 3');
	});

	it('keeps a parked block collapsed, and keyboard reachable', async () => {
		await render(['[ ] Real', '<!--', '[ ] Parked', '-->']);
		const open = await page.$eval('details.parked', (node) => node.open);
		assert.equal(open, false, 'parked work should start collapsed');
		assert.equal(await page.textContent('details.parked summary'), '3 parked lines');
		// A native <details> is focusable without any script of ours.
		assert.equal(await page.$$eval('summary', (nodes) => nodes.length), 1);
	});

	it('shows a line it cannot parse rather than dropping it', async () => {
		await render(['[ ] Real', '- [ ] Markdown habit']);
		assert.equal(await page.textContent('.raw'), 'Not recognised: - [ ] Markdown habit');
	});
});

describe('nothing from the file becomes markup', () => {
	it('does not let a description inject an element', async () => {
		await render(['[ ] <img src=x onerror="window.__pwned=1">']);
		assert.equal(await page.evaluate(() => window.__pwned), undefined, 'the description executed');
		assert.equal(await page.$$eval('img', (nodes) => nodes.length), 0, 'the description created an element');
		assert.match(await page.textContent('.text'), /<img src=x/);
	});

	it('does not let a comment become a real HTML comment', async () => {
		// The specific hazard: `<!-- parked -->` passed through would be
		// invisible in the DOM, and a `-->` inside a description could break
		// out of it.
		await render(['[ ] Note --> and <!-- more']);
		const comments = await page.evaluate(() => {
			const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
			let count = 0;
			while (walker.nextNode()) count += 1;
			return count;
		});
		assert.equal(comments, 0, 'file content produced an HTML comment node');
	});

	it('does not let a title break out of its heading', async () => {
		await render(['# </h2><script>window.__pwned=1</script>', '[ ] Item']);
		assert.equal(await page.evaluate(() => window.__pwned), undefined);
		assert.equal(await page.$$eval('h2', (nodes) => nodes.length), 1);
	});
});

describe('clicking', () => {
	it('posts the line it was clicked on', async () => {
		await render(['[ ] First', '[ ] Second']);
		await page.click('.box >> nth=1');
		assert.deepEqual(await page.evaluate(() => window.__posted), [{ type: 'cycle', line: 1 }]);
	});

	it('posts for a nested subtask too', async () => {
		await render(['[ ] Parent', '\t[ ] Child']);
		await page.click('li > ul .box');
		assert.deepEqual(await page.evaluate(() => window.__posted), [{ type: 'cycle', line: 1 }]);
	});

	it('works from the keyboard, because it is a button', async () => {
		await render(['[ ] Only']);
		await page.focus('.box');
		await page.keyboard.press('Enter');
		assert.deepEqual(await page.evaluate(() => window.__posted), [{ type: 'cycle', line: 0 }]);
	});

	it('shows a visible focus ring', async () => {
		// `outline: none` without a replacement is on the anti-pattern list,
		// and it is the difference between usable and unusable by keyboard.
		await render(['[ ] Only']);
		await page.focus('.box');
		const outline = await page.$eval('.box', (node) => getComputedStyle(node).outlineStyle);
		assert.notEqual(outline, 'none', 'focused button has no visible focus ring');
	});

	it('ignores a click that is not on a checkbox', async () => {
		await render(['# Todos', '[ ] Only']);
		await page.click('h2');
		assert.deepEqual(await page.evaluate(() => window.__posted), []);
	});
});
