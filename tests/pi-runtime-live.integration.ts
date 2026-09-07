// Authorized PI3 Flash sample. Never part of pnpm test / CI.
// Run: PI_RUNTIME_LIVE=true pnpm test:pi-runtime:live
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { decryptCredential } from '../src/lib/crypto/credentials.ts';
import { createBridgeAStreamFn, type BridgeAWire } from '../src/server/runtime/pi/bridge-a.ts';
import { toPiProtocolStreamFn } from '../src/server/runtime/pi/protocol.ts';
import { loadPiCoreModule } from '../src/server/runtime/pi/load.ts';
import { PI_PLACEHOLDER_MODEL } from '../src/server/runtime/pi/package.ts';

const here = dirname(fileURLToPath(import.meta.url));
const live = process.env.PI_RUNTIME_LIVE === 'true';

function envFromDotenv(): Record<string, string> {
  const text = readFileSync(join(here, '../.env'), 'utf8');
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    env[line.slice(0, index)] = line.slice(index + 1);
  }
  return env;
}

test('PI3 authorized Flash sample through Bridge A', async (t) => {
  if (!live) {
    t.skip('Set PI_RUNTIME_LIVE=true to run the authorized Flash sample.');
    return;
  }

  const env = envFromDotenv();
  const sql = postgres(env.DATABASE_URL, { max: 1, connect_timeout: 8 });
  let key = '';
  let credentialName = '';
  try {
    const rows = await sql`
      SELECT id, user_id, name, base_url, model_id, ciphertext
      FROM provider_credentials
      WHERE model_id = 'deepseek-v4-flash'
      LIMIT 1
    `;
    assert.equal(rows.length, 1, 'local Flash credential is missing');
    const row = rows[0];
    credentialName = String(row.name);
    key = decryptCredential(
      String(row.ciphertext),
      env.CREDENTIAL_ENCRYPTION_KEY,
      String(row.user_id),
      String(row.id)
    );
  } finally {
    await sql.end({ timeout: 2 });
  }

  const wires: BridgeAWire[] = [];
  const streamFn = createBridgeAStreamFn({
    apiKey: key,
    baseUrl: 'https://api.deepseek.com',
    modelId: 'deepseek-v4-flash',
    maxTokens: 128,
    onWire: (wire) => wires.push(wire)
  });

  const chunks: Array<{ type: string; text?: string; inputTokens?: number; outputTokens?: number }> = [];
  const started = Date.now();
  for await (const chunk of await streamFn(
    { id: 'deepseek-v4-flash' },
    {
      systemPrompt: 'Reply with a single word: ok',
      messages: [{ role: 'user', content: 'Say ok.', timestamp: Date.now() }]
    }
  )) {
    chunks.push(chunk);
  }
  const elapsedMs = Date.now() - started;
  const text = chunks.filter((chunk) => chunk.type === 'text_delta').map((chunk) => chunk.text ?? '').join('');
  const usage = chunks.find((chunk) => chunk.type === 'usage');
  assert.equal(wires.length, 1);
  assert.equal(wires[0].model, 'deepseek-v4-flash');
  assert.deepEqual(wires[0].thinking, { type: 'disabled' });
  assert.equal(wires[0].maxTokens, 128);
  assert.equal(wires[0].toolCount, 0);
  assert.equal(typeof usage?.inputTokens, 'number');
  assert.equal(typeof usage?.outputTokens, 'number');
  assert.ok((usage?.outputTokens ?? 0) <= 128);
  assert.ok(text.length > 0);
  assert.equal(JSON.stringify({ wires, chunks, text }).includes(key), false);

  const loaded = await loadPiCoreModule({
    env: { PI_RUNTIME_ENABLED: 'true' },
    nodeVersion: process.version
  });
  const protocol = toPiProtocolStreamFn(streamFn);
  const agent = new loaded.Agent({
    initialState: {
      systemPrompt: 'Reply with a single word: ok',
      model: PI_PLACEHOLDER_MODEL,
      tools: [],
      messages: []
    },
    streamFn: protocol,
    toolExecution: 'sequential'
  });
  // Second live call is avoided: the sample above is the billed Bridge A wire.
  assert.equal(typeof agent.abort, 'function');

  const report = [
    '# PI3 Flash sample — AgentForge optional Pi Runtime',
    '',
    `- Date: ${new Date().toISOString()}`,
    '- Authorization: local test token already stored as BYOK credential; one Bridge A sample.',
    '- Not a production, Verified, or leaderboard acceptance.',
    '',
    '## Wire (redacted)',
    '',
    `- Credential name: ${credentialName}`,
    `- Endpoint: POST https://api.deepseek.com${wires[0].pathname}`,
    `- Model: ${String(wires[0].model)}`,
    `- thinking: ${JSON.stringify(wires[0].thinking)}`,
    `- max_tokens: ${String(wires[0].maxTokens)}`,
    `- stream: ${String(wires[0].stream)}`,
    `- tools: ${String(wires[0].toolCount)}`,
    '- Authorization header: redacted',
    '',
    '## Result',
    '',
    `- Output chars: ${text.length}`,
    `- Input tokens: ${String(usage?.inputTokens)}`,
    `- Output tokens: ${String(usage?.outputTokens)}`,
    `- Elapsed ms: ${elapsedMs}`,
    '- Retry: none',
    '- Competitive submission: none',
    ''
  ].join('\n');
  writeFileSync(join(here, '../specs/pi-runtime/pi3-flash-sample.md'), report);
});
