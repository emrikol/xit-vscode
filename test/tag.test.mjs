/**
 * Tags: the case rules, and the drift detector against the grammar.
 *
 * Spec §Tag puts opposite rules on the two halves - names are
 * case-insensitive, values are case-sensitive - which is exactly the shape of
 * mistake where one rule gets written and applied to both.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { tokenize, scoped } from './tokenizer.mjs';
import { corpusAspects } from './corpus.test.mjs';

const { tagsOn, tags, tagIndex, foldName, tagUsage, commonSpelling } = createRequire(import.meta.url)('../out/tag.js');

const on = (line) => tagsOn(line);

describe('reading tags', () => {
	it('finds a plain tag', () => {
		assert.deepEqual(on('[ ] A #tag here').map((t) => t.text), ['#tag']);
	});

	it('finds several on one line', () => {
		assert.deepEqual(on('[ ] #one and #two and #three').map((t) => t.name), ['one', 'two', 'three']);
	});

	it('reads an unquoted value', () => {
		const [tag] = on('[ ] #tag=value');
		assert.equal(tag.name, 'tag');
		assert.equal(tag.value, 'value');
	});

	it('reads a quoted value, and drops the quotes', () => {
		assert.equal(on('[ ] #tag="v a l u e"')[0].value, 'v a l u e');
		assert.equal(on("[ ] #tag='v a l u e'")[0].value, 'v a l u e');
	});

	it('treats an empty value as an absent one', () => {
		// Spec: "An empty tag value (e.g. #tag= or #tag=\"\") MUST be treated
		// the same as an absent tag value (e.g. #tag)."
		for (const line of ['[ ] #tag', '[ ] #tag=', '[ ] #tag=""', "[ ] #tag=''"]) {
			assert.equal(on(line)[0].value, null, line);
		}
	});

	it('drops an unterminated quoted value', () => {
		// Spec: "In case no matching closing quote appears on the same line,
		// the tag value MUST be treated as absent."
		assert.equal(on('[ ] #tag="v a l u e')[0].value, null);
	});
});

describe('a hash inside a URL', () => {
	it('is a fragment, not a tag', () => {
		// The format has no escaping, and says so on purpose - the guide's
		// tags/8, "Backslashes don't have special meaning". That is fine until
		// you paste a link, and then `#top` was a tag.
		assert.deepEqual(tagsOn('[ ] Read https://example.com/#top').map((tag) => tag.text), []);
		assert.deepEqual(tagsOn('[ ] Read http://a.example/x/#anchor').map((tag) => tag.text), []);
	});

	it('does not stop a real tag later on the line', () => {
		assert.deepEqual(
			tagsOn('[ ] Read https://example.com/#top and file it #later').map((tag) => tag.text),
			['#later'],
		);
	});

	it('leaves a link with no fragment alone', () => {
		assert.deepEqual(tagsOn('[ ] Read https://example.com/docs #reading').map((tag) => tag.text), ['#reading']);
	});

	it('still reads a colour as a tag, which is accepted and documented', () => {
		// The narrow fix, not the general one. `#FF8800` after a space is a
		// tag by the format's own rules, it is rare, and fixing it would mean
		// inventing an escape character everyone has to think about.
		assert.deepEqual(tagsOn('[ ] Colour is #FF8800').map((tag) => tag.text), ['#FF8800']);
	});
});

describe('case', () => {
	it('folds names, because the spec says they are case-insensitive', () => {
		assert.equal(on('[ ] #Work')[0].key, on('[ ] #work')[0].key);
		assert.equal(on('[ ] #WORK')[0].key, on('[ ] #work')[0].key);
	});

	it('keeps the name as written, as well as folded', () => {
		const [tag] = on('[ ] #Work');
		assert.equal(tag.name, 'Work');
		assert.equal(tag.key, 'work');
	});

	it('does NOT fold values, because the spec says they are case-sensitive', () => {
		// The obvious mistake here is writing one rule and applying it to both
		// halves. This is the test that catches it.
		assert.notEqual(on('[ ] #tag=Foo')[0].value, on('[ ] #tag=foo')[0].value);
		assert.equal(on('[ ] #tag=Foo')[0].value, 'Foo');
	});

	it('folds non-Latin names too', () => {
		// Tag names take any Unicode letter, so this cannot be assumed from
		// the ASCII cases passing.
		assert.equal(foldName('ΣΚΛΗΡΆ'), 'σκληρά');
		assert.equal(on('[ ] #ΣΚΛΗΡΆ')[0].key, on('[ ] #σκληρά')[0].key);
		assert.equal(on('[ ] #ÜBERMORGEN')[0].key, on('[ ] #übermorgen')[0].key);
	});

	it('does not fold a script with no case', () => {
		assert.equal(on('[ ] #今日は')[0].key, '今日は');
	});
});

describe('indexing tags', () => {
	it('gathers one entry per distinct name, however it was written', () => {
		const index = tagIndex(['[ ] #Work', '[ ] #work', '[ ] #home']);
		assert.deepEqual([...index.keys()].sort(), ['home', 'work']);
	});

	it('gathers the values seen for a name, keeping their case apart', () => {
		const index = tagIndex(['[ ] #tag=Foo', '[ ] #tag=foo', '[ ] #tag=bar']);
		assert.deepEqual([...index.get('tag')].sort(), ['Foo', 'bar', 'foo']);
	});

	it('records a name with no values at all', () => {
		const index = tagIndex(['[ ] #plain']);
		assert.deepEqual([...index.get('plain')], []);
	});
});

describe('tags inside items', () => {
	it('ignores a tag on a line that is not an item', () => {
		// The grammar reads tags only within a description, and "[ ]#invalid"
		// has no valid checkbox so it has no description.
		assert.deepEqual(tags(['[ ]#invalid']), []);
		assert.deepEqual(tags(['A title with a #tag in it']), []);
	});

	it('reads a tag on a continuation line, and attributes it to the item', () => {
		const found = tags(['[ ] Item ...', '    ... and a #tag']);
		assert.deepEqual(found.map((t) => [t.line, t.item, t.text]), [[1, 0, '#tag']]);
	});

	it('attributes a subtask tag to the subtask, not the parent', () => {
		const found = tags(['[ ] Parent #a', '\t[ ] Child #b']);
		assert.deepEqual(found.map((t) => [t.item, t.text]), [[0, '#a'], [1, '#b']]);
	});
});

describe('the TypeScript matcher and the grammar agree', () => {
	it('finds the same tags in every example in the syntax guide', async () => {
		const disagreements = [];
		let compared = 0;

		for (const aspect of corpusAspects()) {
			const lines = aspect.lines.map((line) => line.text);
			const tokenized = await tokenize(lines.join('\n'));

			// Compared through tags(), not tagsOn(): the grammar reads tags
			// only inside an item, and a line on its own cannot know whether
			// it is in one. "[ ]#invalid" has no valid checkbox, so it has no
			// description, so its "#invalid" is not a tag.
			const found = tags(lines);

			for (const [index, text] of lines.entries()) {
				const fromGrammar = scoped(tokenized[index], 'markup.other.task.tag');
				const fromCode = found.filter((tag) => tag.line === index).map((tag) => tag.text);

				compared++;
				if (JSON.stringify(fromGrammar) !== JSON.stringify(fromCode)) {
					disagreements.push(
						`  ${aspect.id}: ${JSON.stringify(text)}\n` +
						`    grammar:    ${JSON.stringify(fromGrammar)}\n` +
						`    TypeScript: ${JSON.stringify(fromCode)}`,
					);
				}
			}
		}

		assert.ok(compared > 150, `only ${compared} lines compared`);
		assert.deepEqual(disagreements, [],
			`src/tag.ts has drifted from the grammar:\n\n${disagreements.join('\n\n')}`);
	});
});

describe('what completion draws on', () => {
	it('records every spelling of a folded name', () => {
		const usage = tagUsage(['[ ] a #Work', '[ ] b #work', '[ ] c #work']);
		assert.deepEqual([...usage.keys()], ['work']);
		assert.deepEqual([...usage.get('work').spellings.entries()], [['Work', 1], ['work', 2]]);
	});

	it('offers the commonest spelling', () => {
		assert.equal(commonSpelling(tagUsage(['[ ] a #Work', '[ ] b #work', '[ ] c #work']).get('work')), 'work');
		assert.equal(commonSpelling(tagUsage(['[ ] a #Work', '[ ] b #Work', '[ ] c #work']).get('work')), 'Work');
	});

	it('breaks a tie alphabetically, not by which file was read first', () => {
		// An index built from a workspace has no meaningful order to fall back
		// on, so the answer must not depend on one.
		assert.equal(commonSpelling(tagUsage(['[ ] a #Work', '[ ] b #work']).get('work')), 'Work');
		assert.equal(commonSpelling(tagUsage(['[ ] b #work', '[ ] a #Work']).get('work')), 'Work');
	});

	it('keeps values case-sensitive, because the spec says so', () => {
		// Spec §Tag: the name is case-insensitive, the value is not.
		const usage = tagUsage(['[ ] a #size=S', '[ ] b #size=s']);
		assert.deepEqual([...usage.get('size').values].sort(), ['S', 's']);
	});

	it('gives a tag with no value an empty value set, not a missing entry', () => {
		const usage = tagUsage(['[ ] a #plain']);
		assert.deepEqual([...usage.get('plain').values], []);
	});
});

describe('an unquoted value takes almost anything, which is a fork', () => {
	// Spec §Tag allows only letters, digits, `_` and `-`, which cost two bugs
	// one character at a time - `#repeat=+7d` parsed as `#repeat=` with no
	// value, and `#est=1.5h` as `#est=1`, both in silence. Widening it a
	// character at a time was the wrong shape of fix.
	it('takes the characters that used to be silently dropped', () => {
		assert.equal(tagsOn('[ ] x #repeat=+7d')[0].value, '+7d');
		assert.equal(tagsOn('[ ] x #est=1.5h')[0].value, '1.5h');
	});

	it('takes anything else printable too', () => {
		assert.equal(tagsOn('[ ] x #tag=a/b:c@d%e')[0].value, 'a/b:c@d%e');
		assert.equal(tagsOn('[ ] x #tag=a+b!c')[0].value, 'a+b!c');
		assert.equal(tagsOn('[ ] x #v=1.2.3')[0].value, '1.2.3');
	});

	it('lets a cross-file reference go unquoted', () => {
		// A `#` inside the value is unambiguous, because a tag needs a space
		// or punctuation before its hash and a letter sits there.
		assert.equal(tagsOn('[ ] x #after=linked.xit#k3f9')[0].value, 'linked.xit#k3f9');
	});

	it('trims trailing punctuation, so a value can end a sentence', () => {
		// The same courtesy the name already gets from tags/2.
		assert.equal(tagsOn('[ ] x #tag=value.')[0].value, 'value');
		assert.equal(tagsOn('[ ] x (#tag=bar)')[0].value, 'bar');
		assert.equal(tagsOn('[ ] x #tag=urgent!')[0].value, 'urgent');
	});

	it('still drops an unterminated quoted value rather than reading it raw', () => {
		// tags/9: "the value is disregarded altogether". A leading quote is
		// excluded from the unquoted form so this rule survives the widening.
		assert.equal(tagsOn('[ ] x #tag="unterminated')[0].value, null);
	});

	it('leaves the name narrow, which the corpus requires', () => {
		// tags/2: a name that took any printable character could never end a
		// sentence.
		assert.deepEqual(tagsOn('[ ] This is a #tag.').map((tag) => tag.text), ['#tag']);
		assert.deepEqual(tagsOn('[ ] x (#tag)').map((tag) => tag.text), ['#tag']);
		assert.deepEqual(tagsOn('[ ] x #tag1/#tag2').map((tag) => tag.text), ['#tag1', '#tag2']);
		assert.deepEqual(tagsOn('[ ] x #a+b').map((tag) => tag.text), ['#a']);
	});
});

describe('a name takes more than letters, which is a fork', () => {
	it('takes a script that needs combining marks', () => {
		// The bug this fixed, and it was a bug rather than a limit. Spec §Tag
		// allows letters, digits, `_` and `-`; Devanagari vowel signs are
		// marks, so `#हिन्दी` gave `#ह`. Thai and Arabic diacritics broke the
		// same way.
		assert.deepEqual(tagsOn('[ ] x #हिन्दी').map((tag) => tag.text), ['#हिन्दी']);
		assert.deepEqual(tagsOn('[ ] x #ไทย').map((tag) => tag.text), ['#ไทย']);
	});

	it('takes emoji, including sequences held together by a joiner', () => {
		assert.deepEqual(tagsOn('[ ] x #tag\u{1F973}').map((tag) => tag.text), ['#tag\u{1F973}']);
		assert.deepEqual(tagsOn('[ ] x #❤️').map((tag) => tag.text), ['#❤️'], 'a variation selector is a mark');
		assert.deepEqual(tagsOn('[ ] x #\u{1F468}‍\u{1F469}‍\u{1F467}').map((tag) => tag.text),
			['#\u{1F468}‍\u{1F469}‍\u{1F467}']);
	});

	it('keeps the letters that always worked', () => {
		for (const name of ['σκληρά', '今日は', 'übermorgen', 'Русский']) {
			assert.deepEqual(tagsOn(`[ ] x #${name}`).map((tag) => tag.text), [`#${name}`], name);
		}
	});

	it('does not take a math symbol, or `=` would end no tag value', () => {
		// Extended_Pictographic rather than \p{S} on purpose: `=`, `+`, `<`
		// and `>` are math symbols, and a name that swallowed `=` would make
		// every `#tag=value` one long name.
		assert.equal(tagsOn('[ ] x #a=b')[0].name, 'a');
		assert.equal(tagsOn('[ ] x #a=b')[0].value, 'b');
		assert.deepEqual(tagsOn('[ ] x #a+b').map((tag) => tag.text), ['#a']);
	});

	it('does not take punctuation, so a tag can still end a sentence', () => {
		assert.deepEqual(tagsOn('[ ] This is a #tag.').map((tag) => tag.text), ['#tag']);
		assert.deepEqual(tagsOn('[ ] x (#tag)').map((tag) => tag.text), ['#tag']);
		assert.deepEqual(tagsOn('[ ] x #tag1/#tag2').map((tag) => tag.text), ['#tag1', '#tag2']);
	});
});

describe('a dot inside a name but never at its end', () => {
	it('keeps a version-like name whole', () => {
		// `#v1.2` gave `#v1` - silently, which is the shape of bug this whole
		// area kept producing.
		assert.deepEqual(tagsOn('[ ] x #v1.2').map((tag) => tag.text), ['#v1.2']);
		assert.deepEqual(tagsOn('[ ] x #a.b.c=d').map((tag) => tag.text), ['#a.b.c=d']);
	});

	it('still lets a tag end a sentence', () => {
		// The trailing dot is trimmed, exactly as it is from a value.
		assert.deepEqual(tagsOn('[ ] This is a #tag.').map((tag) => tag.text), ['#tag']);
		assert.deepEqual(tagsOn('[ ] Done #shopping..').map((tag) => tag.text), ['#shopping']);
	});
});
