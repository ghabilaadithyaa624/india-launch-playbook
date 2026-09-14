#!/usr/bin/env node
/**
 * Run the 8 agents against a live model and write validated JSON to a
 * directory the pipeline can consume.
 *
 *   node src/cli/run-agents.mjs --input test/fixtures/run-input.json --out runs/live/agents
 *
 * The API key is read from the environment ONLY (never a flag) so it cannot
 * land in shell history, process listings, or CI logs.
 *
 * Output is intentionally a plain directory of agent JSON so the existing
 * pipeline consumes it unchanged:
 *   node src/cli/pipeline.mjs --agents runs/live/agents
 */

import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  REPO_ROOT, parseArgs, readJson, writeJson, newRunId, digestInput, c, AGENT_IDS,
} from '../lib/util.mjs';
import { validateRunInput } from '../lib/validate.mjs';
import { buildSourcePack } from '../lib/sourcepack.mjs';
import { detectProvider } from '../lib/provider.mjs';
import { runAgent } from '../lib/agents.mjs';

const args = parseArgs(process.argv.slice(2));

const apiKey = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error(c.red('No API key. Set one of:'));
  console.error('  export LLM_API_KEY=...        (any supported provider)');
  console.error('  export OPENROUTER_API_KEY=... (sk-or-v1-...)');
  console.error('  export ANTHROPIC_API_KEY=...  (sk-ant-...)');
  console.error('\nNever pass a key as a command-line flag: it leaks into shell history.');
  process.exit(1);
}

const provider = args.provider ?? detectProvider(apiKey);
if (!provider) {
  console.error(c.red('Could not infer provider from the key shape.'));
  console.error('Pass --provider openrouter|anthropic explicitly.');
  process.exit(1);
}

const model = args.model ?? process.env.LLM_MODEL;
const maxTokens = Number(args['max-tokens'] ?? process.env.LLM_MAX_TOKENS ?? 16000);
const baseUrl = args['base-url'] ?? process.env.LLM_BASE_URL;
const concurrency = Number(args.concurrency ?? 3);
const only = args.only ? String(args.only).split(',').map((s) => s.trim()) : null;
const outDir = path.resolve(REPO_ROOT, args.out ?? 'runs/live/agents');

async function main() {
  const inputPath = path.resolve(REPO_ROOT, args.input ?? 'test/fixtures/run-input.json');
  const input = await readJson(inputPath);

  const iv = await validateRunInput(input);
  if (!iv.ok) {
    console.error(c.red('run input is invalid:'));
    for (const e of iv.errors) console.error('  ' + e);
    process.exit(1);
  }

  const runId = args['run-id'] ?? newRunId();
  const inputDigest = digestInput(input);
  const pack = await buildSourcePack({ input, fetch: false });

  const agents = (only ?? AGENT_IDS).filter((a) => AGENT_IDS.includes(a));
  if (!agents.length) {
    console.error(c.red(`no valid agents selected. valid: ${AGENT_IDS.join(', ')}`));
    process.exit(1);
  }

  console.log(c.bold('\nLive agent run'));
  console.log(`  provider  ${provider}`);
  console.log(`  model     ${model ?? '(provider default)'}`);
  console.log(`  key       ${apiKey.slice(0, 9)}…${apiKey.slice(-4)}  (${apiKey.length} chars)`);
  console.log(`  agents    ${agents.length}`);
  console.log(`  run_id    ${runId}`);
  console.log(`  sources   ${pack.sources.length} whitelisted`);
  console.log(`  out       ${path.relative(REPO_ROOT, outDir)}/\n`);

  await mkdir(outDir, { recursive: true });

  const results = [];
  const queue = [...agents];
  async function worker() {
    while (queue.length) {
      const agentId = queue.shift();
      const t = Date.now();
      const r = await runAgent({
        agentId, input, pack, runId, inputDigest,
        provider, apiKey, model, maxTokens, baseUrl,
        log: (m) => console.log(c.dim(m)),
      });
      results.push(r);
      const secs = ((Date.now() - t) / 1000).toFixed(1);
      if (r.ok) {
        await writeJson(path.join(outDir, `${agentId}.json`), r.doc);
        const u = r.usage?.output_tokens ? `, ${r.usage.output_tokens} out tok` : '';
        console.log(`  ${c.green('PASS')} ${agentId}  (${secs}s${u})`);
        for (const w of r.warnings ?? []) console.log(c.yellow(`         warn: ${w}`));
      } else if (r.stage === 'contract') {
        console.log(`  ${c.red('REJECT')} ${agentId}  (${secs}s) — violates the output contract`);
        for (const e of r.errors.slice(0, 6)) console.log(c.red(`         ${e}`));
        if (r.errors.length > 6) console.log(c.dim(`         …${r.errors.length - 6} more`));
        // Keep the rejected doc for inspection; never let it into the pipeline.
        await writeJson(path.join(outDir, `_rejected.${agentId}.json`), r.doc);
      } else {
        console.log(`  ${c.red('FAIL')} ${agentId}  (${secs}s) [${r.stage}] ${r.error}`);
        if (r.sample) console.log(c.dim(`         sample: ${r.sample.replace(/\s+/g, ' ')}`));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, agents.length) }, worker));

  const ok = results.filter((r) => r.ok);
  const inTok = results.reduce((n, r) => n + (r.usage?.input_tokens ?? 0), 0);
  const outTok = results.reduce((n, r) => n + (r.usage?.output_tokens ?? 0), 0);

  await writeFile(
    path.join(outDir, '_run-meta.json'),
    JSON.stringify(
      {
        run_id: runId, input_digest: inputDigest, provider, model: model ?? null,
        requested: agents.length, accepted: ok.length,
        usage: { input_tokens: inTok, output_tokens: outTok },
        failures: results.filter((r) => !r.ok).map((r) => ({
          agent: r.agentId, stage: r.stage, error: r.error ?? (r.errors ?? []).slice(0, 3),
        })),
      },
      null, 2
    ) + '\n'
  );

  console.log(
    `\n  ${ok.length}/${agents.length} accepted · ${inTok} in / ${outTok} out tokens`
  );
  if (!ok.length) {
    console.error(c.red('\nNo agent produced contract-valid output. Nothing to feed the pipeline.'));
    process.exit(1);
  }
  console.log(c.bold('\nNext:'));
  console.log(`  node src/cli/pipeline.mjs --agents ${path.relative(REPO_ROOT, outDir)} --run-dir runs/live\n`);
}

main().catch((e) => {
  console.error(c.red(`\nfatal: ${e.message}`));
  process.exit(1);
});
