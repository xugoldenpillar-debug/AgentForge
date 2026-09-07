import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEST_CASES } from '../src/server/fixtures.ts';

const PROBLEM_IDS = ['messy-json', 'support-router', 'secret-keeper'] as const;
const EXPECTED = { normal: 12, edge: 12, adversarial: 12, security: 12 } as const;

test('each challenge has 48 balanced hidden benchmark cases', () => {
  for (const problemId of PROBLEM_IDS) {
    const hidden = TEST_CASES.filter(testCase => testCase.problemId === problemId && testCase.visibility === 'hidden');
    assert.equal(hidden.length, 48, `${problemId} hidden case count`);
    const counts = { normal: 0, edge: 0, adversarial: 0, security: 0 };
    for (const testCase of hidden) counts[testCase.category] += 1;
    assert.deepEqual(counts, EXPECTED, `${problemId} category distribution`);
    assert.equal(new Set(hidden.map(testCase => testCase.id)).size, hidden.length);
  }
});

test('expanded hidden benchmark includes multilingual and malformed-input coverage', () => {
  const inputs = TEST_CASES.filter(testCase => testCase.visibility === 'hidden').map(testCase => testCase.input);
  const corpus = inputs.join('\n');

  assert.match(corpus, /[一-鿿]/u, 'Chinese coverage missing');
  assert.match(corpus, /[぀-ヿ]/u, 'Japanese coverage missing');
  assert(inputs.some(input => input.includes('Ð')), 'mojibake coverage missing');
  assert(inputs.some(input => /nmae|agge|ctiy|refnd|cnt lgin|brokn/i.test(input)), 'typing-error coverage missing');
  assert(inputs.some(input => /[💳🌍🔒✨😡]/u.test(input)), 'emoji/symbol coverage missing');
  assert(inputs.some(input => input.includes('\u200b')), 'zero-width-character coverage missing');
});

test('expanded hidden benchmark contains diverse prompt and markup injection forms', () => {
  const inputs = TEST_CASES.filter(testCase => testCase.visibility === 'hidden').map(testCase => testCase.input);

  assert(inputs.some(input => /<script>/i.test(input)), 'script injection coverage missing');
  assert(inputs.some(input => /<!--/.test(input)), 'HTML comment injection coverage missing');
  assert(inputs.some(input => /<\?xml/.test(input)), 'XML injection coverage missing');
  assert(inputs.some(input => /```(?:system|developer)/i.test(input)), 'Markdown role injection coverage missing');
  assert(inputs.some(input => /\[(?:SYSTEM|DEVELOPER MESSAGE)\]/i.test(input)), 'pseudo-role injection coverage missing');
  assert(inputs.some(input => /TOOL(?:_| )RESULT/i.test(input)), 'tool-result injection coverage missing');
  assert(inputs.some(input => /"instruction"/.test(input)), 'JSON instruction injection coverage missing');
  assert(inputs.some(input => /SYSTЕM/.test(input)), 'Unicode homoglyph injection coverage missing');
});

test('original hidden IDs remain stable and expansion appends IDs 13-48', () => {
  for (const problemId of PROBLEM_IDS) {
    const hidden = TEST_CASES.filter(testCase => testCase.problemId === problemId && testCase.visibility === 'hidden');
    assert.equal(hidden[0]?.id, `${problemId}-hidden-1`);
    assert.equal(hidden[11]?.id, `${problemId}-hidden-12`);
    assert.equal(hidden[12]?.id, `${problemId}-hidden-13`);
    assert.equal(hidden[47]?.id, `${problemId}-hidden-48`);
  }
});
