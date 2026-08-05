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

	it('puts nothing on the page for a comment', async () => {
		await render(['[ ] Real', '<!--', '[ ] Parked', '-->']);
		assert.equal(await page.$$eval('details', (nodes) => nodes.length), 0, 'a comment left furniture behind');
		const text = await page.textContent('main');
		assert.match(text, /Real/);
		assert.doesNotMatch(text, /Parked|parked line/);
	});

	it('shows a line it cannot parse rather than dropping it', async () => {
		await render(['[ ] Real', '- [ ] Markdown habit']);
		assert.equal(await page.textContent('.raw'), 'Not recognised - [ ] Markdown habit');
		// The marker is visible on purpose. A line the preview cannot draw is
		// exactly the line you need to be told about.
		const shown = await page.$eval('.unparsed', (node) => getComputedStyle(node).display);
		assert.notEqual(shown, 'none', 'the unparsed marker is invisible');
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

describe('links', () => {
	it('makes a markdown-style link a real anchor', async () => {
		await render(['[ ] Call [Kickoff, Jul 14](quill://meeting/9e0ef127)']);
		const link = await page.$eval('.text a', (node) => ({ href: node.getAttribute('href'), text: node.textContent }));
		assert.deepEqual(link, { href: 'quill://meeting/9e0ef127', text: 'Kickoff, Jul 14' });
	});

	it('links a bare URL in a continuation line too', async () => {
		await render(['[ ] Parent', '    see https://example.com/x']);
		assert.equal(await page.$eval('.continued a', (node) => node.getAttribute('href')), 'https://example.com/x');
	});

	it('does not create an anchor for a scheme that executes', async () => {
		await render(['[ ] [Evil](javascript:alert(1))']);
		assert.equal(await page.$$eval('.text a', (nodes) => nodes.length), 0, 'javascript: was made clickable');
		assert.match(await page.textContent('.text'), /javascript:alert/);
	});
});

describe('updating without reloading the page', () => {
	it('replaces the content on a message, keeping the scroll position', async () => {
		// Reassigning webview.html reloads the page: the scroll jumps to the
		// top and any open disclosure closes. Ticking a box is a document
		// change, so that happened on every single click.
		const { preview, previewBody } = require_('../../out/preview.js');
		await render(Array.from({ length: 200 }, (_, at) => `[ ] Item ${at}`));

		await page.evaluate(() => window.scrollTo(0, 1200));
		const before = await page.evaluate(() => window.scrollY);
		assert.ok(before > 0, 'the fixture is not tall enough to scroll');

		// Same height, different content. Replacing 200 items with one makes the
		// page shorter, and the browser then clamps the scroll legitimately -
		// which would be the test proving nothing rather than the code failing.
		const body = previewBody(
			preview(
				Array.from({ length: 200 }, (_, at) => (at === 0 ? '[x] Replaced' : `[ ] Item ${at}`)),
				{ thresholds: THRESHOLDS },
			),
		);
		await page.evaluate(
			(html) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'render', body: html } })),
			body,
		);

		assert.match(await page.textContent('main'), /Replaced/);
		assert.equal(await page.evaluate(() => window.scrollY), before, 'the scroll position was lost');
	});

	it('ignores a message that is not a render', async () => {
		await render(['[ ] Only']);
		await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'other' } })));
		assert.match(await page.textContent('main'), /Only/);
	});
});

describe('following a link', () => {
	it('hands the href to the extension instead of doing nothing', async () => {
		// A webview does not follow a link on its own, and will not hand a
		// custom scheme like quill:// anywhere at all - which is every meeting
		// link in a real file.
		await render(['[ ] Call [Kickoff, Jul 14](quill://meeting/9e0ef127)']);
		await page.click('.text a');
		assert.deepEqual(await page.evaluate(() => window.__posted), [{ type: 'open', href: 'quill://meeting/9e0ef127' }]);
	});

	it('works for a bare URL too', async () => {
		await render(['[ ] See https://example.com/x']);
		await page.click('.text a');
		assert.deepEqual(await page.evaluate(() => window.__posted), [{ type: 'open', href: 'https://example.com/x' }]);
	});

	it('does not also report a status change', async () => {
		await render(['[ ] Call [K](quill://m/1)']);
		await page.click('.text a');
		const posted = await page.evaluate(() => window.__posted);
		assert.equal(
			posted.some((message) => message.type === 'cycle'),
			false,
		);
	});

	it('does not navigate the page away', async () => {
		// preventDefault, or the whole view is replaced by whatever the href
		// resolves to and there is no way back.
		await render(['[ ] See https://example.com/x']);
		await page.click('.text a');
		assert.match(await page.textContent('main'), /See/);
	});

	it('follows a link in a continuation line', async () => {
		await render(['[ ] Parent', '    [Notes, Jul 7](quill://meeting/abc)']);
		await page.click('.continued a');
		assert.deepEqual(await page.evaluate(() => window.__posted), [{ type: 'open', href: 'quill://meeting/abc' }]);
	});
});

describe('the Raw/Parsed control, in the page', () => {
	it('is there, marks Parsed as current, and puts Raw first', async () => {
		await render(['[ ] Only']);
		const segments = await page.$$eval('.viewswitch .switch', (nodes) =>
			nodes.map((node) => ({ text: node.textContent, tag: node.tagName, current: node.getAttribute('aria-current') })),
		);
		assert.deepEqual(segments, [
			{ text: 'Raw', tag: 'BUTTON', current: null },
			{ text: 'Parsed', tag: 'SPAN', current: 'true' },
		]);
	});

	it('asks for the raw view when Raw is clicked', async () => {
		await render(['[ ] Only']);
		await page.click('.viewswitch [data-view="raw"]');
		assert.deepEqual(await page.evaluate(() => window.__posted), [{ type: 'view', view: 'raw' }]);
	});

	it('stays put when the page is scrolled', async () => {
		// It is the way out. Having to scroll back to the top to leave is the
		// kind of thing that makes a view feel like a trap.
		await render(Array.from({ length: 200 }, (_, at) => `[ ] Item ${at}`));
		const before = await page.$eval('.viewswitch', (node) => node.getBoundingClientRect().top);
		await page.evaluate(() => window.scrollTo(0, 1500));
		const after = await page.$eval('.viewswitch', (node) => node.getBoundingClientRect().top);
		assert.equal(after, before, 'the control scrolled away with the content');
	});

	it('does not report a status click when Raw is pressed', async () => {
		await render(['[ ] Only']);
		await page.click('.viewswitch [data-view="raw"]');
		const posted = await page.evaluate(() => window.__posted);
		assert.equal(
			posted.some((message) => message.type === 'cycle'),
			false,
		);
	});

	it('is reachable and operable from the keyboard', async () => {
		await render(['[ ] Only']);
		await page.focus('.viewswitch [data-view="raw"]');
		const outline = await page.$eval('.viewswitch [data-view="raw"]', (node) => getComputedStyle(node).outlineStyle);
		assert.notEqual(outline, 'none', 'no visible focus ring on the way out');
		await page.keyboard.press('Enter');
		assert.deepEqual(await page.evaluate(() => window.__posted), [{ type: 'view', view: 'raw' }]);
	});
});

describe('the status menu', () => {
	it('opens on the checkbox and offers every status', async () => {
		// Clicking used to cycle: six clicks to get back where you started, and
		// no way to see what the choices even were.
		await render(['[@] Ongoing item']);
		assert.equal(await page.$eval('#status-menu', (node) => node.hidden), true, 'the menu starts open');

		await page.click('.box');
		assert.equal(await page.$eval('#status-menu', (node) => node.hidden), false);

		const labels = await page.$$eval('#status-menu [data-status]', (nodes) => nodes.map((node) => node.textContent));
		assert.equal(labels.length, 6, 'not every status is offered');
		for (const word of ['Open', 'Checked', 'Ongoing', 'Obsolete', 'In question', 'Waiting']) {
			assert.ok(
				labels.some((label) => label.includes(word)),
				`${word} is not in the menu`,
			);
		}
	});

	it('sets the status that was chosen, for the line it was opened on', async () => {
		await render(['[ ] First', '[ ] Second']);
		await page.click('.box >> nth=1');
		await page.click('#status-menu [data-status="@"]');
		assert.deepEqual(await page.evaluate(() => window.__posted), [{ type: 'set', line: 1, status: '@' }]);
	});

	it('carries a status that needs escaping in an attribute', async () => {
		// `>` is a status and a character HTML cares about.
		await render(['[ ] Item']);
		await page.click('.box');
		await page.click('#status-menu [data-status=">"]');
		assert.deepEqual(await page.evaluate(() => window.__posted), [{ type: 'set', line: 0, status: '>' }]);
	});

	it('closes without choosing when Escape is pressed, and gives focus back', async () => {
		await render(['[ ] Item']);
		await page.click('.box');
		await page.keyboard.press('Escape');
		assert.equal(await page.$eval('#status-menu', (node) => node.hidden), true);
		assert.deepEqual(await page.evaluate(() => window.__posted), [], 'Escape chose something');
		assert.equal(await page.evaluate(() => document.activeElement.className), 'box', 'focus was left nowhere');
	});

	it('closes when something else is clicked', async () => {
		await render(['# Todos', '[ ] Item']);
		await page.click('.box');
		await page.click('h2');
		assert.equal(await page.$eval('#status-menu', (node) => node.hidden), true);
		assert.deepEqual(await page.evaluate(() => window.__posted), []);
	});

	it('says on the button that it opens a menu', async () => {
		await render(['[ ] Item']);
		const before = await page.$eval('.box', (node) => ({
			pop: node.getAttribute('aria-haspopup'),
			open: node.getAttribute('aria-expanded'),
		}));
		assert.deepEqual(before, { pop: 'menu', open: 'false' });

		await page.click('.box');
		assert.equal(await page.$eval('.box', (node) => node.getAttribute('aria-expanded')), 'true');
	});

	it('puts focus in the menu so the keyboard can drive it', async () => {
		await render(['[ ] Item']);
		await page.click('.box');
		assert.equal(await page.evaluate(() => document.activeElement.dataset.status), ' ');
		await page.keyboard.press('Enter');
		assert.deepEqual(await page.evaluate(() => window.__posted), [{ type: 'set', line: 0, status: ' ' }]);
	});

	it('opens above the checkbox when there is no room below', async () => {
		// On a long file most checkboxes are near the bottom of the viewport,
		// so a menu that only ever drops downwards is off-screen most of the
		// time.
		await render(Array.from({ length: 200 }, (_, at) => `[ ] Item ${at}`));
		const boxes = await page.$$('.box');
		const last = boxes[boxes.length - 1];
		await last.scrollIntoViewIfNeeded();
		await last.click();

		const placement = await page.evaluate(() => {
			const menu = document.getElementById('status-menu').getBoundingClientRect();
			return { top: menu.top, bottom: menu.bottom, height: window.innerHeight };
		});
		assert.ok(placement.top >= 0, 'the menu ran off the top');
		assert.ok(placement.bottom <= placement.height + 1, 'the menu ran off the bottom');
	});
});

describe('clicking', () => {
	it('opens the menu for a nested subtask, on its own line', async () => {
		await render(['[ ] Parent', '\t[ ] Child']);
		await page.click('li > ul .box');
		await page.click('#status-menu [data-status="x"]');
		assert.deepEqual(await page.evaluate(() => window.__posted), [{ type: 'set', line: 1, status: 'x' }]);
	});

	it('works from the keyboard, because it is a button', async () => {
		await render(['[ ] Only']);
		await page.focus('.box');
		await page.keyboard.press('Enter');
		assert.equal(await page.$eval('#status-menu', (node) => node.hidden), false);
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

	it('does not report a status change when the view switch is used', async () => {
		await render(['[ ] Only']);
		await page.click('.viewswitch [data-view="raw"]');
		const posted = await page.evaluate(() => window.__posted);
		assert.equal(
			posted.some((message) => message.type === 'set'),
			false,
		);
	});
});
