/**
 * Contrast of the overdue-date highlight, computed rather than eyeballed.
 *
 * WCAG contrast is arithmetic — relative luminance of two colours, one ratio —
 * so there is no reason to look at a screenshot to know whether a highlight is
 * readable. This asserts it on every commit instead.
 *
 * Two ratios matter, and they pull in opposite directions:
 *
 *   text   the date must stay readable on top of the highlight.
 *          WCAG 2.1 SC 1.4.3 asks 4.5:1 for body text.
 *   patch  the highlight must be distinguishable from the plain editor
 *          background, or it says nothing at all.
 *          SC 1.4.11 asks 3:1 for a non-text indicator.
 *
 * They cannot both be met by a background wash. Measured across the default
 * themes: by the time the wash is strong enough for the patch ratio to reach
 * even 2:1, the text is down to 3.5:1. That is why the decoration has a
 * border, and why the border is not cosmetic — it carries the indicator
 * contrast beside the text instead of behind it.
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
	{ name: '2026 Dark', kind: 'dark', background: '#121314', date: '#79C0FF' },
	{ name: '2026 Light', kind: 'light', background: '#FFFFFF', date: '#0550AE' },
	{ name: 'Dark Modern', kind: 'dark', background: '#1F1F1F', date: '#CCCCCC' },
	{ name: 'Dark+', kind: 'dark', background: '#1E1E1E', date: '#D4D4D4' },
	{ name: 'Light Modern', kind: 'light', background: '#FFFFFF', date: '#3B3B3B' },
	{ name: 'Light+', kind: 'light', background: '#FFFFFF', date: '#000000' },
	{ name: 'High Contrast Black', kind: 'highContrast', background: '#000000', date: '#FFFFFF' },
	{ name: 'High Contrast Light', kind: 'highContrastLight', background: '#FFFFFF', date: '#000000' },
];

/**
 * editorWarning.foreground, which the border defaults to.
 *
 * From VS Code's built-in colour registry, not from any theme file: the
 * themes do not set it. The light value is confirmed against a running
 * editor, where the decoration measured rgb(191, 136, 3) = #BF8803.
 */
const EDITOR_WARNING = {
	dark: '#CCA700',
	light: '#BF8803',
	highContrast: '#FFCC00',
	highContrastLight: '#BF8803',
};

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
		// Half of black over white is mid grey.
		const half = composite(parse('#00000080'), parse('#FFFFFF'));
		assert.ok(Math.abs(half.r - 127.5) < 1);
		// A fully opaque colour ignores what is under it.
		assert.deepEqual(composite(parse('#123456'), parse('#FFFFFF')), { r: 0x12, g: 0x34, b: 0x56, alpha: 1 });
	});
});

describe('the overdue highlight is legible', () => {
	it('keeps the date readable on the highlight, in every default theme', () => {
		for (const theme of THEMES) {
			const wash = parse(contributed('xit.overdueDueDateBackground', theme.kind));
			const behind = composite(wash, parse(theme.background));
			const ratio = contrast(parse(theme.date), behind);

			assert.ok(ratio >= 4.5,
				`${theme.name}: a due date on the overdue highlight is ${ratio.toFixed(2)}:1, below the 4.5:1 WCAG asks for body text`);
		}
	});

	it('keeps the highlight visible against the editor, in every default theme', () => {
		// The border carries this, not the background. Its default is
		// editorWarning.foreground, which is chosen to be visible.
		for (const theme of THEMES) {
			const border = contributed('xit.overdueDueDateBorder', theme.kind);
			assert.equal(border, 'editorWarning.foreground');

			const ratio = contrast(parse(EDITOR_WARNING[theme.kind]), parse(theme.background));
			assert.ok(ratio >= 3,
				`${theme.name}: the overdue border is ${ratio.toFixed(2)}:1 against the editor background, below the 3:1 WCAG asks for a non-text indicator`);
		}
	});

	it('does not rely on the background alone, because it cannot', () => {
		// The reason the border exists. If a wash ever did reach 3:1 on its
		// own the border would be redundant, and this would be worth
		// revisiting - so it is asserted rather than assumed.
		const reachable = THEMES.some((theme) => {
			const wash = parse(contributed('xit.overdueDueDateBackground', theme.kind));
			return contrast(composite(wash, parse(theme.background)), parse(theme.background)) >= 3;
		});
		assert.equal(reachable, false, 'a background wash now reaches 3:1 on its own; the border may be unnecessary');
	});

	it('uses a translucent wash, so the theme colours the date', () => {
		// An opaque background would hide nothing, but a translucent one keeps
		// the highlight working with any theme rather than only with the ones
		// measured here.
		for (const kind of ['dark', 'light', 'highContrast', 'highContrastLight']) {
			const wash = parse(contributed('xit.overdueDueDateBackground', kind));
			assert.ok(wash.alpha < 1, `the ${kind} overdue background is opaque`);
			assert.ok(wash.alpha > 0.1, `the ${kind} overdue background is too faint to see at all`);
		}
	});

	it('does not set a foreground colour', () => {
		// A decoration's `color` wins over the TextMate token, so setting one
		// replaces the theme's date colour rather than adding to it, and the
		// date stops reading as a date.
		const source = readFileSync(resolve(REPO_ROOT, 'src/extension.ts'), 'utf8');
		const block = source.slice(source.indexOf('createTextEditorDecorationType'));
		const options = block.slice(0, block.indexOf('});'));
		assert.doesNotMatch(options, /(^|\s)color:/, 'the overdue decoration sets a foreground colour');
		assert.match(options, /backgroundColor:/);
		assert.match(options, /borderColor:/);
	});
});
