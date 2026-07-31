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

const { tagsOn, tags, tagIndex, foldName } = createRequire(import.meta.url)('../out/tag.js');

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
