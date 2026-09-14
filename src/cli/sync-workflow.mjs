#!/usr/bin/env node
/**
 * Regenerate the system prompt embedded in each n8n agent node from
 * prompts/<agent_id>.md.
 *
 * The n8n workflow carries a copy of each system prompt inline, because an
 * HTTP Request node cannot read a file from the repository. A copy drifts:
 * the embedded prompts had already lost the OUTPUT SHAPE block that the
 * markdown prompts carry, so an n8n run and a CLI run were issuing different
 * instructions under the same prompt sha.
 *
 * This makes the workflow a derived artifact. Edit prompts/*.md, run
 *     npm run sync:workflow
 * and CI's --check mode fails if the committed workflow is out of date.
 */

import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { REPO_ROOT, c } from '../lib/util.mjs';
import { loadPrompt } from '../lib/prompts.mjs';

const WORKFLOW = path.join(REPO_ROOT, 'N8N_COMPLETE_WORKFLOW.json');
const check = process.argv.includes('--check');

/** node id -> agent id, e.g. "node_market_research" -> "market_research". */
const agentIdFor = (node) =>
  typeof node.id === 'string' && node.id.startsWith('node_') ? node.id.slice(5) : null;

const raw = await readFile(WORKFLOW, 'utf8');
const wf = JSON.parse(raw);

const problems = [];
let changed = 0;

for (const node of wf.nodes) {
  if (!/^Agent \d/.test(node.name)) continue;

  const agentId = agentIdFor(node);
  if (!agentId) {
    problems.push(`${node.name}: node id "${node.id}" does not follow node_<agent_id>`);
    continue;
  }

  const body = node.parameters?.jsonBody;
  if (typeof body !== 'string') {
    problems.push(`${node.name}: missing jsonBody`);
    continue;
  }

  let prompt;
  try {
    prompt = await loadPrompt(agentId);
  } catch (err) {
    problems.push(`${node.name}: ${err.message}`);
    continue;
  }

  // jsonBody is an n8n expression wrapping a JSON literal:
  //   ={{ JSON.stringify({"model":...,"system":"...","messages":[...]}) }}
  // Replace only the "system" string value, leaving the expression intact.
  const open = '"system":"';
  const start = body.indexOf(open);
  if (start === -1) {
    problems.push(`${node.name}: no "system" key in jsonBody`);
    continue;
  }
  const valueStart = start + open.length;

  // Walk to the closing quote of the JSON string, respecting backslash escapes.
  let i = valueStart;
  for (; i < body.length; i += 1) {
    if (body[i] === '\\') {
      i += 1;
      continue;
    }
    if (body[i] === '"') break;
  }
  if (i >= body.length) {
    problems.push(`${node.name}: unterminated "system" string`);
    continue;
  }

  // `body` is the decoded expression text, inside which the prompt is a JSON
  // string literal — one level of escaping. The second level (escaping for the
  // workflow file itself) is applied by JSON.stringify when the file is
  // written, so do not pre-apply it here or newlines become literal "\n".
  const encoded = JSON.stringify(prompt.system).slice(1, -1);

  if (body.slice(valueStart, i) === encoded) continue;

  node.parameters.jsonBody = body.slice(0, valueStart) + encoded + body.slice(i);
  changed += 1;
  console.log(`  ${check ? 'STALE' : 'synced'}  ${node.name}  <- prompts/${agentId}.md`);
}

if (problems.length) {
  console.error(c.red('\n' + problems.join('\n') + '\n'));
  process.exit(1);
}

if (check) {
  if (changed) {
    console.error(
      c.red(`\n${changed} node(s) out of sync with prompts/. Run: npm run sync:workflow\n`)
    );
    process.exit(1);
  }
  console.log(c.green('\nWorkflow prompts match prompts/*.md\n'));
  process.exit(0);
}

if (changed) {
  await writeFile(WORKFLOW, `${JSON.stringify(wf, null, 2)}\n`);
  console.log(c.green(`\nUpdated ${changed} node(s) in N8N_COMPLETE_WORKFLOW.json\n`));
} else {
  console.log(c.green('\nAlready up to date\n'));
}
