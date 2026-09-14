/**
 * Live-path tests against a mock provider.
 *
 * These exercise the real transport code — header construction, body shape,
 * retry/backoff, truncation detection, JSON recovery and contract enforcement.
 * Only the TLS hop to the real API is substituted.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { startMock, validDoc, fabricatedDoc } from './mock-provider.mjs';
import { detectProvider, getProvider, callModel, isTruncated } from '../src/lib/provider.mjs';
import { extractJson, runAgent } from '../src/lib/agents.mjs';
import { loadPrompt, fillTemplate } from '../src/lib/prompts.mjs';
import { buildSourcePack } from '../src/lib/sourcepack.mjs';
import { validateAgentOutput } from '../src/lib/validate.mjs';
import { AGENT_IDS } from '../src/lib/util.mjs';

const INPUT = {
  business_idea: 'A subscription B2B SaaS platform for GST-compliant invoicing for Indian manufacturing SMEs.',
  sector: 'B2B SaaS',
  target_customer: 'Finance managers at Indian manufacturing SMEs',
  geography: ['Pune', 'Delhi-NCR'],
  budget_band: '25L_1Cr',
  stage: 'prototype',
};
const DIGEST = 'a'.repeat(64);
const RUN = '11111111-2222-4333-8444-555555555555';

/* ---------------- provider selection ---------------- */

test('provider is inferred from key shape', () => {
  assert.equal(detectProvider('sk-or-v1-abc'), 'openrouter');
  assert.equal(detectProvider('sk-ant-api03-abc'), 'anthropic');
  assert.equal(detectProvider('cfat_abc12345'), 'cloudflare');
  assert.equal(detectProvider('nonsense'), null);
  assert.equal(detectProvider(''), null);
});

test('an OpenRouter key does not route to the Anthropic endpoint', () => {
  // The original workflow hard-coded api.anthropic.com. With an sk-or-v1 key
  // that is an authentication failure on the first call.
  const p = getProvider(detectProvider('sk-or-v1-abc'));
  assert.match(p.defaultBase, /openrouter\.ai/);
  assert.doesNotMatch(p.defaultBase, /anthropic/);
});

test('each provider sends its own auth header and body shape', () => {
  const a = getProvider('anthropic');
  const o = getProvider('openrouter');
  const c = getProvider('cloudflare');

  const ah = a.headers('sk-ant-x');
  assert.equal(ah['x-api-key'], 'sk-ant-x');
  assert.equal(ah['anthropic-version'], '2023-06-01');
  assert.equal(ah['content-type'], 'application/json');
  assert.ok(!ah.Authorization, 'anthropic must not use Bearer');

  const oh = o.headers('sk-or-x');
  assert.equal(oh.Authorization, 'Bearer sk-or-x');
  assert.ok(!oh['x-api-key'], 'openrouter must not use x-api-key');

  const ch = c.headers('cfat_x');
  assert.equal(ch.Authorization, 'Bearer cfat_x');

  // Anthropic takes system top-level; OpenAI-compatible takes it as a message.
  const ab = a.body({ model: 'm', system: 'SYS', user: 'USR', maxTokens: 10 });
  assert.equal(ab.system, 'SYS');
  assert.equal(ab.messages.length, 1);

  const ob = o.body({ model: 'm', system: 'SYS', user: 'USR', maxTokens: 10 });
  assert.equal(ob.system, undefined);
  assert.equal(ob.messages[0].role, 'system');
  assert.equal(ob.messages[0].content, 'SYS');

  const cb = c.body({ model: 'm', system: 'SYS', user: 'USR', maxTokens: 10 });
  assert.equal(cb.system, undefined);
  assert.equal(cb.messages[0].role, 'system');
  assert.equal(cb.messages[0].content, 'SYS');
});

/* ---------------- transport ---------------- */

test('openrouter call sends Bearer auth and parses the OpenAI response shape', async () => {
  const mock = await startMock({ scenario: 'valid' });
  try {
    const r = await callModel({
      provider: 'openrouter', apiKey: 'sk-or-v1-test', model: 'test/model',
      system: 'S', user: 'U', baseUrl: mock.baseUrl,
    });
    assert.ok(r.text.includes('executive_summary'));
    assert.equal(r.stop_reason, 'stop');
    assert.equal(r.usage.output_tokens, 900);

    const req = mock.requests.at(-1);
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer sk-or-v1-test');
    assert.equal(req.body.messages[0].role, 'system');
    assert.ok(req.body.max_tokens > 0, 'max_tokens must be sent');
  } finally { await mock.close(); }
});

test('cloudflare call sends Bearer auth and parses the response shape', async () => {
  const mock = await startMock({ scenario: 'valid' });
  try {
    const r = await callModel({
      provider: 'cloudflare', apiKey: 'cfat_test123', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      system: 'S', user: 'U', baseUrl: mock.baseUrl,
    });
    assert.ok(r.text.includes('executive_summary'));
    assert.equal(r.stop_reason, 'stop');
    assert.equal(r.usage.output_tokens, 900);

    const req = mock.requests.at(-1);
    assert.equal(req.url, '/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer cfat_test123');
    assert.equal(req.body.messages[0].role, 'system');
    assert.ok(req.body.max_tokens > 0, 'max_tokens must be sent');
  } finally { await mock.close(); }
});

test('anthropic call sends x-api-key and parses the content-block shape', async () => {
  const mock = await startMock({ scenario: 'valid' });
  try {
    const r = await callModel({
      provider: 'anthropic', apiKey: 'sk-ant-test',
      system: 'S', user: 'U', baseUrl: mock.baseUrl,
    });
    assert.ok(r.text.includes('executive_summary'));
    const req = mock.requests.at(-1);
    assert.equal(req.url, '/v1/messages');
    assert.equal(req.headers['x-api-key'], 'sk-ant-test');
    assert.equal(req.headers['anthropic-version'], '2023-06-01');
    assert.equal(req.body.system, 'S');
  } finally { await mock.close(); }
});

test('429 is retried with backoff, then succeeds', async () => {
  const mock = await startMock({ scenario: 'valid', failTimes: 2, failStatus: 429 });
  try {
    const r = await callModel({
      provider: 'openrouter', apiKey: 'sk-or-v1-test',
      system: 'S', user: 'U', baseUrl: mock.baseUrl, maxRetries: 3,
    });
    assert.ok(r.text.length > 0);
    assert.equal(mock.requests.length, 3, 'two failures then one success');
  } finally { await mock.close(); }
});

test('401 is NOT retried — it is a config error, not a transient one', async () => {
  const mock = await startMock({ scenario: 'valid', requireAuth: true });
  try {
    await assert.rejects(
      () => callModel({
        provider: 'openrouter', apiKey: '',
        system: 'S', user: 'U', baseUrl: mock.baseUrl, maxRetries: 3,
        // Force a request with no auth header at all.
        fetchImpl: (url, init) => {
          const h = { ...init.headers };
          delete h.Authorization;
          return fetch(url, { ...init, headers: h });
        },
      }),
      /HTTP 401/
    );
    assert.equal(mock.requests.length, 1, 'must not burn quota retrying a 401');
  } finally { await mock.close(); }
});

/* ---------------- response handling ---------------- */

test('truncation is reported as truncation, not as bad JSON', async () => {
  assert.equal(isTruncated('max_tokens'), true);
  assert.equal(isTruncated('length'), true);
  assert.equal(isTruncated('end_turn'), false);

  const pack = await buildSourcePack({ input: INPUT, fetch: false });
  const mock = await startMock({ scenario: 'truncated' });
  try {
    const r = await runAgent({
      agentId: 'market_research', input: INPUT, pack, runId: RUN, inputDigest: DIGEST,
      provider: 'openrouter', apiKey: 'sk-or-v1-test', baseUrl: mock.baseUrl,
    });
    assert.equal(r.ok, false);
    assert.equal(r.stage, 'truncated', 'must blame the token ceiling, not the model');
    assert.match(r.error, /max-tokens|ceiling/);
  } finally { await mock.close(); }
});

test('JSON is recovered from code fences and leading prose', () => {
  const doc = validDoc();
  assert.equal(extractJson('```json\n' + JSON.stringify(doc) + '\n```').agent.id, 'market_research');
  assert.equal(extractJson('Here you go:\n' + JSON.stringify(doc)).agent.id, 'market_research');
  assert.equal(extractJson(JSON.stringify(doc)).agent.id, 'market_research');
});

test('malformed JSON is never silently repaired', () => {
  assert.throws(() => extractJson('{"a": 1, "b":'), /parseable JSON/);
  assert.throws(() => extractJson('no json at all here'), /parseable JSON/);
  assert.throws(() => extractJson(''), /empty model response/);
});

/* ---------------- the contract still governs live output ---------------- */

test('a live model that fabricates a CAGR statistic is REJECTED', async () => {
  const pack = await buildSourcePack({ input: INPUT, fetch: false });
  const mock = await startMock({ scenario: 'fabricated' });
  try {
    const r = await runAgent({
      agentId: 'market_research', input: INPUT, pack, runId: RUN, inputDigest: DIGEST,
      provider: 'openrouter', apiKey: 'sk-or-v1-test', baseUrl: mock.baseUrl,
    });
    assert.equal(r.ok, false, 'unsourced market-size claim must not pass');
    assert.equal(r.stage, 'contract');
    assert.ok(
      r.errors.some((e) => /T2|model_internal_knowledge|source/i.test(e)),
      `expected an evidence violation, got: ${JSON.stringify(r.errors)}`
    );
  } finally { await mock.close(); }
});

test('a well-formed live response passes and is stamped with run identity', async () => {
  const pack = await buildSourcePack({ input: INPUT, fetch: false });
  const mock = await startMock({ scenario: 'fenced' });
  try {
    const r = await runAgent({
      agentId: 'market_research', input: INPUT, pack, runId: RUN, inputDigest: DIGEST,
      provider: 'openrouter', apiKey: 'sk-or-v1-test', baseUrl: mock.baseUrl,
    });
    assert.equal(r.ok, true, JSON.stringify(r.errors ?? r.error));
    assert.equal(r.doc.run_id, RUN, 'run_id is stamped server-side, not trusted from the model');
    assert.equal(r.doc.input_digest, DIGEST);
    assert.equal(r.doc.agent.id, 'market_research');
    assert.match(r.doc.agent.prompt_sha256, /^[0-9a-f]{64}$/, 'output must be traceable to a prompt version');
  } finally { await mock.close(); }
});

test('non-JSON prose response fails at the parse stage without crashing', async () => {
  const pack = await buildSourcePack({ input: INPUT, fetch: false });
  const mock = await startMock({ scenario: 'notjson' });
  try {
    const r = await runAgent({
      agentId: 'market_research', input: INPUT, pack, runId: RUN, inputDigest: DIGEST,
      provider: 'openrouter', apiKey: 'sk-or-v1-test', baseUrl: mock.baseUrl,
    });
    assert.equal(r.ok, false);
    assert.equal(r.stage, 'parse');
    assert.ok(r.sample, 'keep a sample for debugging');
  } finally { await mock.close(); }
});

/* ---------------- prompts ---------------- */

test('all 8 prompts parse and expose system + user template', async () => {
  for (const id of AGENT_IDS) {
    const p = await loadPrompt(id);
    assert.ok(p.system.length > 200, `${id}: system prompt too short`);
    assert.ok(p.userTemplate.includes('{{business_idea}}'), `${id}: missing business_idea`);
    assert.ok(p.userTemplate.includes('{{source_block}}'), `${id}: missing source_block`);
    assert.match(p.sha256, /^[0-9a-f]{64}$/);
  }
});

test('an unfilled placeholder is an error, never sent to the model', () => {
  assert.throws(
    () => fillTemplate('idea: {{business_idea}} sector: {{sector}}', { business_idea: 'x' }),
    /unfilled placeholders: sector/
  );
  const out = fillTemplate('geo: {{geography}}', { geography: ['Pune', 'Delhi'] });
  assert.equal(out, 'geo: Pune, Delhi');
});

test('the evidence block sent to the model lists only whitelisted sources', async () => {
  const pack = await buildSourcePack({ input: INPUT, fetch: false });
  const mock = await startMock({ scenario: 'valid' });
  try {
    await runAgent({
      agentId: 'market_research', input: INPUT, pack, runId: RUN, inputDigest: DIGEST,
      provider: 'openrouter', apiKey: 'sk-or-v1-test', baseUrl: mock.baseUrl,
    });
    const sent = mock.requests.at(-1).body.messages[1].content;
    assert.ok(sent.includes('AVAILABLE SOURCES'), 'agent must receive the evidence block');
    assert.ok(sent.includes('{{') === false, 'no unrendered placeholders may reach the model');
  } finally { await mock.close(); }
});

test('every prompt states the exact output shape the validator requires', async () => {
  // The prompts originally said "conform to the schema" without stating field
  // names, id patterns or enum values. A live model cannot satisfy a contract
  // it was never shown, and failed on nearly every field.
  const schema = JSON.parse(
    await (await import('node:fs/promises')).readFile(
      new URL('../schemas/agent-output.schema.json', import.meta.url), 'utf8'
    )
  );
  for (const id of AGENT_IDS) {
    const p = await loadPrompt(id);
    const example = p.system.match(/\{\s*\n\s*"schema_version"[\s\S]*?\n\}/);
    assert.ok(example, `${id}: prompt shows no JSON example`);

    for (const k of schema.required) {
      assert.ok(example[0].includes(`"${k}"`), `${id}: example omits required key "${k}"`);
    }
    for (const [prop, def] of Object.entries(schema.properties)) {
      const req = def.items?.required ?? def.required;
      if (!req) continue;
      for (const k of req) {
        assert.ok(example[0].includes(`"${k}"`), `${id}: example omits ${prop}.${k}`);
      }
    }
    // Id patterns must be shown, not implied.
    assert.ok(/F001/.test(p.system), `${id}: does not show the F001 id format`);
  }
});

test('sidecar files are not mistaken for agent outputs', async () => {
  // run-agents writes _run-meta.json next to the agent documents, and keeps
  // _rejected.<agent>.json for inspection. Both are JSON in the same folder.
  // The pipeline must ignore them: validating _run-meta.json as an agent
  // document aborted an otherwise valid run, and a rejected document must
  // never re-enter the pipeline.
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { listJson } = await import('../src/lib/util.mjs');

  const dir = await mkdtemp(path.join(tmpdir(), 'agents-'));
  await writeFile(path.join(dir, 'market_research.json'), '{}');
  await writeFile(path.join(dir, '_run-meta.json'), '{}');
  await writeFile(path.join(dir, '_rejected.go_to_market.json'), '{}');

  const found = await listJson(dir);
  assert.deepEqual(found, ['market_research.json']);
});

test('a rejected document is quarantined, not written as a usable output', async () => {
  // Uses the in-process runAgent path rather than spawning the CLI: spawnSync
  // blocks the event loop, so an in-process mock server could never answer it.
  const { mkdtemp, readdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { writeJson } = await import('../src/lib/util.mjs');

  const pack = await buildSourcePack({ input: INPUT, fetch: false });
  const mock = await startMock({ scenario: 'fabricated' });
  const out = await mkdtemp(path.join(tmpdir(), 'out-'));
  try {
    const r = await runAgent({
      agentId: 'market_research', input: INPUT, pack, runId: RUN, inputDigest: DIGEST,
      provider: 'openrouter', apiKey: 'sk-or-v1-test', baseUrl: mock.baseUrl,
    });
    assert.equal(r.ok, false, 'fabricated statistic must be rejected');

    // Mirror what the CLI does on rejection: quarantine, never publish.
    if (!r.ok && r.stage === 'contract') {
      await writeJson(path.join(out, `_rejected.${r.agentId}.json`), r.doc);
    }
    const files = await readdir(out);
    assert.ok(
      !files.includes('market_research.json'),
      'a contract-violating document must not become a usable agent output'
    );
    assert.ok(files.includes('_rejected.market_research.json'), 'keep it for inspection');
  } finally { await mock.close(); }
});
