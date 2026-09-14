/**
 * Prompt specialisation tests.
 *
 * Background: the loader originally read only the two fenced blocks, so the
 * "## Focus areas" and "## Self-check before returning" sections never reached
 * the model. With those sections dropped, 64 of the 66 system-prompt lines were
 * identical across all eight agents — the only differentiator was the job title
 * in the opening sentence and the trailing `Set agent.id to "..."`. Eight
 * "specialists" were one prompt run eight times.
 *
 * These tests make that failure mode loud. They assert that the guidance
 * actually reaches the system prompt, that each agent carries a substantial
 * body of guidance no other agent has, and that the guidance does not smuggle
 * in fabricated figures — a number stated in a prompt comes back out of the
 * model looking like a sourced fact.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { loadPrompt } from '../src/lib/prompts.mjs';
import { AGENT_IDS, REPO_ROOT } from '../src/lib/util.mjs';

const all = async () => {
  const out = {};
  for (const id of AGENT_IDS) out[id] = await loadPrompt(id);
  return out;
};

/** Meaningful prose lines: ignore blank lines and markdown bullet scaffolding. */
const contentLines = (text) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 8);

test('focus areas and self-check actually reach the system prompt', async () => {
  const prompts = await all();
  for (const id of AGENT_IDS) {
    const p = prompts[id];
    assert.ok(p.focus, `${id}: focus areas not parsed`);
    assert.ok(p.selfCheck, `${id}: self-check not parsed`);

    // The guidance must be present in the string that is sent to the model,
    // not merely parsed out of the file.
    assert.ok(
      p.system.includes(p.focus),
      `${id}: focus areas parsed but missing from the system prompt`
    );
    assert.ok(
      p.system.includes(p.selfCheck),
      `${id}: self-check parsed but missing from the system prompt`
    );
    // And it must genuinely extend the contract, not replace it.
    assert.ok(p.system.startsWith(p.contract), `${id}: contract must lead the system prompt`);
    assert.ok(
      p.system.length > p.contract.length,
      `${id}: system prompt adds nothing beyond the contract`
    );
  }
});

test('each agent carries substantial guidance no other agent has', async () => {
  const prompts = await all();
  const sets = Object.fromEntries(
    AGENT_IDS.map((id) => [id, new Set(contentLines(prompts[id].system))])
  );

  for (const id of AGENT_IDS) {
    const others = AGENT_IDS.filter((o) => o !== id);
    const unique = [...sets[id]].filter((line) => !others.some((o) => sets[o].has(line)));
    // The regression this guards against produced exactly 2 unique lines.
    assert.ok(
      unique.length >= 10,
      `${id}: only ${unique.length} unique prompt line(s) — this agent has regressed ` +
        'towards boilerplate and is not meaningfully specialised'
    );
  }
});

test('no two agents share an identical system prompt', async () => {
  const prompts = await all();
  const seen = new Map();
  for (const id of AGENT_IDS) {
    const prev = seen.get(prompts[id].system);
    assert.equal(prev, undefined, `${id} and ${prev} have byte-identical system prompts`);
    seen.set(prompts[id].system, id);
  }
});

test('every agent keeps the shared evidence contract', async () => {
  const prompts = await all();
  for (const id of AGENT_IDS) {
    const s = prompts[id].system;
    assert.match(s, /NEVER invent a statistic/, `${id}: lost the fabrication prohibition`);
    assert.match(s, /low\/base\/high/, `${id}: lost the estimate-range rule`);
    assert.match(s, /requires_professional_review/, `${id}: lost the professional-review rule`);
    assert.match(s, new RegExp(`Set agent\\.id to "${id}"`), `${id}: wrong or missing agent id`);
  }
});

test('guidance states no figures that could resurface as fabricated facts', async () => {
  // A statistic written into a prompt is laundered into the output as a
  // source-looking claim. Guidance may name regulators and ask questions; it
  // may not assert numbers. Permitted: statute years, the 1-5 scoring scale,
  // and tier-N segment labels.
  const allowed = [
    /Data Protection Act, 2023/,
    /\b1-5\b/,
    /tier-\d/i,
    /\bAgent \d\b/,
  ];

  for (const id of AGENT_IDS) {
    const md = await readFile(path.join(REPO_ROOT, 'prompts', `${id}.md`), 'utf8');
    const focus = md.slice(md.indexOf('## Focus areas'), md.indexOf('\n## Self-check'));

    for (const line of focus.split('\n')) {
      if (!/\d/.test(line)) continue;
      const cleaned = allowed.reduce((acc, re) => acc.replace(new RegExp(re, 'g'), ''), line);
      assert.ok(
        !/\d/.test(cleaned),
        `${id}: focus areas assert a figure, which the model will echo as a fact:\n  ${line.trim()}`
      );
    }
  }
});

test('the n8n workflow embeds the current prompts', async () => {
  // The workflow carries an inline copy of each system prompt because an HTTP
  // Request node cannot read the repo. The copy had already drifted once,
  // losing the OUTPUT SHAPE block, so an n8n run and a CLI run issued
  // different instructions under the same recorded prompt sha.
  const wf = JSON.parse(
    await readFile(path.join(REPO_ROOT, 'N8N_COMPLETE_WORKFLOW.json'), 'utf8')
  );
  const nodes = wf.nodes.filter((n) => /^Agent \d/.test(n.name));
  assert.equal(nodes.length, AGENT_IDS.length, 'expected one workflow node per agent');

  for (const node of nodes) {
    const agentId = node.id.slice('node_'.length);
    assert.ok(AGENT_IDS.includes(agentId), `unknown agent node id: ${node.id}`);

    const body = node.parameters.jsonBody;
    const start = body.indexOf('JSON.stringify(') + 'JSON.stringify('.length;
    const end = body.lastIndexOf(') }}');
    const payload = JSON.parse(body.slice(start, end));

    const prompt = await loadPrompt(agentId);
    assert.equal(
      payload.system,
      prompt.system,
      `${node.name}: embedded prompt is stale — run: npm run sync:workflow`
    );
  }
});
