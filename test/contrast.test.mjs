/**
 * Contrast of the overdue-date highlight, computed rather than eyeballed.
 *
 * WCAG contrast is arithmetic — relative luminance of two colours, one ratio —
 * so there is no reason to look at a screenshot to know whether a highlight is
 * readable. This asserts it on every commit instead.
 *
 * Two ratios matter:
 *
 *   text   the date must stay readable on the highlight.
 *          WCAG 2.1 SC 1.4.3 asks 4.5:1 for body text.
 *   mark   the highlight must be distinguishable from the plain editor
 *          background, or it says nothing at all.
 *          SC 1.4.11 asks 3:1 for a non-text indicator.
 *
 * The first attempt met neither reliably, and the reason is worth keeping.
 * It painted a translucent wash and left the theme choosing the text colour,
 * so one side of the text ratio belonged to us and the other to whoever wrote
 * the theme. Monokai puts #AE81FF on it: 2.73:1, down from 5.23:1 with no
 * highlight at all. Lowering the alpha did not rescue it, and three bundled
 * themes are already below 4.5:1 before anything is drawn, so no absolute bar
 * was even reachable.
 *
 * Owning both sides fixes it by construction. The badge sets its own
 * background and its own foreground, so the text ratio is the same in every
 * theme, including ones written after this — 9.36:1 on dark, 5.54:1 on light.
 * The styles that draw no background set no colours at all, which is equally
 * safe: the text then keeps exactly the contrast the theme gave it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT } from './tokenizer.mjs';

const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));

/**
 * The themes VS Code ships, as (editor background, the colour it gives a due
 * date) pairs.
 *
 * Copied here rather than read from an installed VS Code, so the test runs on
 * a clean checkout. The due-date foreground is what the theme gives
 * `constant.other`, which is the scope our grammar puts on a due date, or the
 * plain editor foreground where the theme sets no rule for it.
 *
 * Cross-checked against a running editor: in the 2026 Light theme the
 * decoration measured rgb(5, 80, 174) for a date, which is #0550AE below.
 */
const THEMES = [
	{ name: 'Abyss', kind: 'dark', background: '#000C18', date: '#F280D0' },
	{ name: '2026 Dark', kind: 'dark', background: '#121314', date: '#79C0FF' },
	{ name: '2026 Light', kind: 'light', background: '#FFFFFF', date: '#0550AE' },
	{ name: 'Dark Modern', kind: 'dark', background: '#1F1F1F', date: '#CCCCCC' },
	{ name: 'Dark+', kind: 'dark', background: '#1E1E1E', date: '#D4D4D4' },
	{ name: 'Kimbie Dark', kind: 'dark', background: '#221A0F', date: '#F79A32' },
	{ name: 'Light Modern', kind: 'light', background: '#FFFFFF', date: '#3B3B3B' },
	{ name: 'Light+', kind: 'light', background: '#FFFFFF', date: '#000000' },
	{ name: 'Monokai', kind: 'dark', background: '#272822', date: '#AE81FF' },
	{ name: 'Monokai Dimmed', kind: 'dark', background: '#1E1E1E', date: '#8080FF' },
	{ name: 'Quiet Light', kind: 'light', background: '#F5F5F5', date: '#9C5D27' },
	{ name: 'Red', kind: 'dark', background: '#390000', date: '#994646' },
	{ name: 'Solarized Dark', kind: 'dark', background: '#002B36', date: '#CB4B16' },
	{ name: 'Solarized Light', kind: 'light', background: '#FDF6E3', date: '#CB4B16' },
	{ name: 'Tomorrow Night Blue', kind: 'dark', background: '#002451', date: '#FFFFFF' },
	{ name: 'High Contrast Black', kind: 'highContrast', background: '#000000', date: '#FFFFFF' },
	{ name: 'High Contrast Light', kind: 'highContrastLight', background: '#FFFFFF', date: '#000000' },
];

const TIERS = ['overdueDueDate', 'criticallyOverdueDueDate'];

function parse(colour) {
	const digits = colour.replace('#', '');
	const full = digits.length === 3 ? [...digits].map((c) => c + c).join('') : digits;
	return {
		r: parseInt(full.slice(0, 2), 16),
		g: parseInt(full.slice(2, 4), 16),
		b: parseInt(full.slice(4, 6), 16),
		alpha: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
	};
}

/** `source` composited over `backdrop`, straight alpha. */
function composite(source, backdrop) {
	const blend = (channel) => source[channel] * source.alpha + backdrop[channel] * (1 - source.alpha);
	return { r: blend('r'), g: blend('g'), b: blend('b'), alpha: 1 };
}

/** WCAG 2.1 relative luminance. */
function luminance({ r, g, b }) {
	const linear = (value) => {
		const channel = value / 255;
		return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2.1 contrast ratio, 1 to 21. */
function contrast(one, other) {
	const [lighter, darker] = [luminance(one), luminance(other)].sort((a, b) => b - a);
	return (lighter + 0.05) / (darker + 0.05);
}

/** The default this extension contributes for a colour id, per theme kind. */
function contributed(id, kind) {
	const colour = manifest.contributes.colors.find((entry) => entry.id === id);
	assert.ok(colour, `${id} is not contributed`);
	const value = colour.defaults[kind];
	assert.ok(value, `${id} has no default for ${kind}`);
	return value;
}

describe('contrast maths', () => {
	// The formula itself, against values with known answers, so a mistake here
	// cannot quietly weaken every assertion below.
	it('agrees with the published reference values', () => {
		assert.equal(contrast(parse('#000000'), parse('#FFFFFF')).toFixed(2), '21.00');
		assert.equal(contrast(parse('#FFFFFF'), parse('#FFFFFF')).toFixed(2), '1.00');
		// WCAG's own worked example: #777777 on white is 4.48:1, just under AA.
		assert.equal(contrast(parse('#777777'), parse('#FFFFFF')).toFixed(2), '4.48');
	});

	it('composites alpha the way a renderer does', () => {
		const half = composite(parse('#00000080'), parse('#FFFFFF'));
		assert.ok(Math.abs(half.r - 127.5) < 1);
		assert.deepEqual(composite(parse('#123456'), parse('#FFFFFF')), { r: 0x12, g: 0x34, b: 0x56, alpha: 1 });
	});
});

describe('the overdue highlight is legible', () => {
	it('keeps the date readable on the badge, in every bundled theme', () => {
		// Both sides of this ratio are ours, so it does not depend on the
		// theme at all - the same pair of colours in all seventeen. That is
		// the point. The first attempt owned only the background and let the
		// theme keep the text colour, and Monokai put #AE81FF on the amber:
		// 2.73:1, down from 5.23:1 with no highlight at all.
		for (const theme of THEMES) {
			for (const tier of TIERS) {
				const background = parse(contributed(`xit.${tier}Background`, theme.kind));
				const foreground = parse(contributed(`xit.${tier}Foreground`, theme.kind));
				const ratio = contrast(foreground, composite(background, parse(theme.background)));

				assert.ok(ratio >= 4.5,
					`${theme.name}, ${tier}: text on the badge is ${ratio.toFixed(2)}:1, below the 4.5:1 WCAG asks for body text`);
			}
		}
	});

	it('keeps the mark visible against the editor, in every bundled theme', () => {
		// SC 1.4.11, for the badge itself and for the border and underline
		// styles, which draw nothing else.
		for (const theme of THEMES) {
			for (const tier of TIERS) {
				for (const part of ['Background', 'Border']) {
					const mark = parse(contributed(`xit.${tier}${part}`, theme.kind));
					const ratio = contrast(composite(mark, parse(theme.background)), parse(theme.background));

					assert.ok(ratio >= 3,
						`${theme.name}, ${tier}${part}: ${ratio.toFixed(2)}:1 against the editor background, below the 3:1 WCAG asks for a non-text indicator`);
				}
			}
		}
	});

	it('tells the two severities apart by more than colour', () => {
		// The two badges are chosen to weigh the same, which is what makes
		// them read as one family. It also means hue is all that separates
		// them - 1.42:1 of luminance on light themes - and amber against red
		// is exactly the pair red-green colour blindness collapses.
		//
		// WCAG SC 1.4.1: "Color is not used as the only visual means of
		// conveying information." So the critical tier is bold as well as
		// red, and this is the test that keeps it that way. It asserts the
		// difference rather than a contrast number, because raising the
		// contrast between them is not the fix - it would break the family
		// resemblance and still leave colour doing all the work.
		const source = readFileSync(resolve(REPO_ROOT, 'src/extension.ts'), 'utf8');
		const options = source.slice(source.indexOf('function renderOptions'), source.indexOf('function registerOverdueDecoration'));

		assert.match(options, /tier === 'critical'[\s\S]*?fontWeight/,
			'the critical tier is distinguished only by colour');
		assert.equal([...options.matchAll(/fontWeight/g)].length, 1,
			'the ordinary tier is bold too, so weight no longer distinguishes them');
	});

	it('never paints a background without also setting the foreground', () => {
		// The rule the first attempt broke. A background the extension owns,
		// under text the theme owns, is a pair of colours that have never met.
		const source = readFileSync(resolve(REPO_ROOT, 'src/extension.ts'), 'utf8');
		const options = source.slice(source.indexOf('function renderOptions'), source.indexOf('function registerOverdueDecoration'));

		// The two assignments must sit together, with nothing but whitespace
		// between them, so neither can be moved or removed on its own.
		assert.match(options, /options\.backgroundColor = new vscode\.ThemeColor\(colours\.background\);\s*\n\s*options\.color = new vscode\.ThemeColor\(colours\.foreground\);/,
			'a background is painted without the matching foreground beside it');

		// And nowhere else may paint one.
		const backgrounds = [...options.matchAll(/backgroundColor/g)];
		assert.equal(backgrounds.length, 1, 'more than one place paints a background');
	});

	it('offers every style the setting advertises', () => {
		const styles = manifest.contributes.configuration.properties['xit.overdueDueDateStyle'];
		assert.deepEqual(styles.enum, ['border-and-background', 'background', 'border', 'underline']);
		assert.equal(styles.default, 'border-and-background');
		assert.equal(styles.enumDescriptions.length, styles.enum.length);

		const source = readFileSync(resolve(REPO_ROOT, 'src/extension.ts'), 'utf8');
		for (const style of styles.enum) {
			assert.ok(source.includes(`'${style}'`), `${style} is offered but never drawn`);
		}
	});
});
