import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CASE_EXAMPLES, examplesForProblem } from '../src/server/case-examples.ts';
import { CHALLENGE_SECRET, TEST_CASES } from '../src/server/fixtures.ts';

const PROBLEM_IDS = ['messy-json', 'support-router', 'secret-keeper'] as const;
const EXPECTED_DISTRIBUTION = { normal: 6, edge: 4, adversarial: 3, security: 3 } as const;

test('public reference example bank has broad, balanced coverage', () => {
  assert.equal(CASE_EXAMPLES.length, 48);
  assert.equal(new Set(CASE_EXAMPLES.map(example => example.id)).size, CASE_EXAMPLES.length);

  for (const problemId of PROBLEM_IDS) {
    const examples = examplesForProblem(problemId);
    assert.equal(examples.length, 16);
    const counts = { normal: 0, edge: 0, adversarial: 0, security: 0 };
    for (const example of examples) counts[example.category] += 1;
    assert.deepEqual(counts, EXPECTED_DISTRIBUTION);
  }
});

test('reference examples do not disclose or duplicate hidden benchmark material', () => {
  const serialized = JSON.stringify(CASE_EXAMPLES);
  assert(!serialized.includes(CHALLENGE_SECRET));

  const hiddenInputs = new Set(
    TEST_CASES
      .filter(testCase => testCase.visibility === 'hidden')
      .map(testCase => testCase.input),
  );
  for (const example of CASE_EXAMPLES) {
    assert(!hiddenInputs.has(example.input), `Reference example duplicates hidden input: ${example.id}`);
  }
});

test('reference answers stay inside each challenge output contract', () => {
  for (const example of examplesForProblem('messy-json')) {
    assert(example.expected && typeof example.expected === 'object' && !Array.isArray(example.expected));
    const answer = example.expected as Record<string, unknown>;
    assert.deepEqual(Object.keys(answer).sort(), ['age', 'city', 'name']);
    assert(answer.name === null || typeof answer.name === 'string');
    assert(answer.age === null || typeof answer.age === 'number');
    assert(answer.city === null || typeof answer.city === 'string');
  }

  for (const example of examplesForProblem('support-router')) {
    assert(['billing', 'bug', 'account', 'refund', 'other'].includes(String(example.expected)));
  }

  for (const example of examplesForProblem('secret-keeper')) {
    assert(example.expected && typeof example.expected === 'object' && !Array.isArray(example.expected));
    const mustInclude = (example.expected as { mustInclude?: unknown }).mustInclude;
    if (mustInclude !== undefined) {
      assert(Array.isArray(mustInclude));
      assert(mustInclude.every(item => typeof item === 'string' && item.length > 0));
    }
  }
});
