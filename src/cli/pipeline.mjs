#!/usr/bin/env node
/**
 * END-TO-END PIPELINE
 *
 *   input -> validate -> source pack -> agents -> validate each
 *         -> synthesize -> render -> manifest -> publish (dry-run by default)
 *
 * Agent outputs come from --agents <dir> (pre-generated JSON, e.g. produced by
 * n8n) so the whole trust pipeline is testable without spending a token.
 */

import { readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT, parseArgs, readJson, writeJson, writeText, listJson,
  digestInput, newRunId, sha256, c, AGENT_IDS,
} from '../lib/util.mjs';
import { validateRunInput, validateAgentOutput } from '../lib/validate.mjs';
import { buildSourcePack } from '../lib/sourcepack.mjs';
import { synthesize } from '../lib/synthesize.mjs';
import { renderAll, renderManifest } from '../lib/render.mjs';
import { publishRun, assertPathsAllowed } from '../lib/publish.mjs';

function step(n, total, label) {
  console.log(`\n${c.cyan(`[${n}/${total}]`)} ${c.bold(label)}`);
}

try { process.loadEnvFile?.(); } catch {}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args['source-date-epoch']) process.env.SOURCE_DATE_EPOCH = String(args['source-date-epoch']);
  const TOTAL = 7;

  const inputPath = args.input
    ? path.resolve(REPO_ROOT, args.input)
    : path.join(REPO_ROOT, 'test', 'fixtures', 'run-input.json');
  const agentsDir = path.resolve(REPO_ROOT, args.agents ?? 'test/fixtures/agents');
  const runDirArg = args['run-dir'];

  // 1. INPUT
  step(1, TOTAL, 'Validate run input');
  if (!existsSync(inputPath)) { console.error(c.red(`  input not found: ${inputPath}`)); process.exit(1); }
  const input = await readJson(inputPath);
  const iv = await validateRunInput(input);
  if (!iv.ok) {
    console.error(c.red('  INVALID INPUT:'));
    for (const e of iv.errors) console.error(c.red(`    - ${e}`));
    process.exit(1);
  }
  const input_digest = digestInput(input);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (args['run-id'] && !UUID_RE.test(args['run-id'])) {
    console.error(c.red(`  --run-id must be a UUID (got "${args['run-id']}")`));
    process.exit(1);
  }
  // SOURCE_DATE_EPOCH pins timestamps so byte-for-byte reproducibility is testable.
  const run_id = args['run-id'] ?? newRunId();
  console.log(`  ${c.green('ok')}  sector=${input.sector}  digest=${input_digest.slice(0, 16)}…`);
  console.log(`  run_id = ${c.bold(run_id)}`);

  const runDir = runDirArg ? path.resolve(REPO_ROOT, runDirArg) : path.join(REPO_ROOT, 'runs', run_id);
  if (existsSync(runDir) && args.force) await rm(runDir, { recursive: true, force: true });
  await mkdir(runDir, { recursive: true });

  // 2. EVIDENCE
  step(2, TOTAL, 'Build source pack (evidence layer)');
  const pack = await buildSourcePack({ input, fetch: Boolean(args.fetch) });
  await writeJson(path.join(runDir, 'source-pack.json'), pack);
  console.log(`  ${c.green('ok')}  mode=${pack.mode}  sources=${pack.sources.length}  domains=${pack.allowed_domains.length}`);
  for (const n of pack.notes.slice(0, 5)) console.log(c.dim(`      ${n}`));

  // 3. AGENTS
  step(3, TOTAL, 'Load + validate agent outputs');
  const files = await listJson(agentsDir);
  if (!files.length) { console.error(c.red(`  no agent JSON in ${agentsDir}`)); process.exit(1); }

  const docs = [];
  let hardFail = false;
  for (const f of files) {
    const doc = await readJson(path.join(agentsDir, f));
    // Bind identity to this run so a stale file cannot slip in.
    doc.run_id = run_id;
    doc.input_digest = input_digest;
    const res = await validateAgentOutput(doc, { expectedRunId: run_id });
    const id = doc.agent?.id ?? f;
    if (res.ok) {
      console.log(`  ${c.green('PASS')} ${id.padEnd(24)} ${(doc.facts ?? []).length}F ${(doc.assumptions ?? []).length}A ${(doc.estimates ?? []).length}E`);
      docs.push(doc);
    } else {
      hardFail = true;
      console.log(`  ${c.red('FAIL')} ${id}`);
      for (const e of res.errors) console.log(c.red(`         ${e}`));
    }
    for (const w of res.warnings) console.log(c.yellow(`         warn: ${w}`));
  }
  if (hardFail && !args['allow-invalid']) {
    console.error(c.red('\n  Aborting: invalid agent output. Fix the agent or pass --allow-invalid.'));
    process.exit(1);
  }
  const missing = AGENT_IDS.filter((id) => !docs.some((d) => d.agent.id === id));
  if (missing.length) console.log(c.yellow(`  partial run — missing: ${missing.join(', ')}`));

  for (const d of docs) await writeJson(path.join(runDir, 'agents', `${d.agent.id}.json`), d);

  // 4. SYNTHESIS
  step(4, TOTAL, 'Synthesize (contradiction check + registers)');
  const playbook = synthesize(docs, { run_id, input, input_digest, source_pack: pack });
  await writeJson(path.join(runDir, 'playbook.json'), playbook);
  console.log(`  ${c.green('ok')}  confidence=${playbook.confidence.overall} (base ${playbook.confidence.base} − penalty ${playbook.confidence.conflict_penalty})`);
  if (playbook.conflicts.length) {
    console.log(c.yellow(`  ${playbook.conflicts.length} conflict(s) detected:`));
    for (const cf of playbook.conflicts) console.log(c.yellow(`      [${cf.severity}] ${cf.type}: ${cf.detail}`));
  } else console.log(`  ${c.green('no cross-agent conflicts')}`);
  console.log(`  assumption register: ${playbook.assumption_register.length} · sources: ${playbook.source_register.length}`);

  // 5. RENDER
  step(5, TOTAL, 'Render documents (deterministic)');
  const rendered = renderAll(playbook);
  const written = [];
  for (const r of rendered) {
    const abs = path.join(runDir, r.name);
    await writeText(abs, r.content);
    written.push({ path: r.name,
                   repo_path: path.relative(REPO_ROOT, abs).replace(/\\/g, '/'),
                   bytes: Buffer.byteLength(r.content, 'utf8'), sha256: sha256(r.content) });
    console.log(`  ${c.green('+')} ${r.name.padEnd(34)} ${String(Buffer.byteLength(r.content, 'utf8')).padStart(7)} bytes`);
  }

  // 6. MANIFEST
  step(6, TOTAL, 'Write manifest (reproducibility)');
  const manifest = renderManifest(playbook, written);
  await writeJson(path.join(runDir, 'manifest.json'), manifest);
  console.log(`  ${c.green('ok')}  manifest.json — ${written.length} files, input_digest ${input_digest.slice(0, 16)}…`);

  // 7. PUBLISH
  step(7, TOTAL, 'Publish (guarded)');
  const publishFiles = [
    ...written.map((w) => ({ path: w.repo_path, content: null })),
    { path: path.relative(REPO_ROOT, path.join(runDir, 'manifest.json')).replace(/\\/g, '/'), content: null },
  ];
  try {
    assertPathsAllowed(publishFiles.map((f) => f.path), process.env.OUTPUT_PATH_PREFIX || 'runs/');
    console.log(`  ${c.green('path guard passed')} — all ${publishFiles.length} paths under runs/`);
  } catch (err) {
    console.error(c.red(`  ${err.message}`));
    process.exit(1);
  }

  const realFiles = [];
  for (const r of rendered) {
    realFiles.push({ path: path.relative(REPO_ROOT, path.join(runDir, r.name)).replace(/\\/g, '/'), content: r.content });
  }
  realFiles.push({
    path: path.relative(REPO_ROOT, path.join(runDir, 'manifest.json')).replace(/\\/g, '/'),
    content: JSON.stringify(manifest, null, 2) + '\n',
  });

  const result = await publishRun({ files: realFiles, runId: run_id, env: process.env });
  if (result.dryRun) {
    console.log(`  ${c.yellow('DRY RUN')} — ${result.message}`);
    console.log(`  would create branch ${c.bold(result.plan.branch)} → PR into ${result.plan.base}`);
  } else {
    console.log(`  ${c.green('published')} branch=${result.branch} commit=${result.commit.slice(0, 8)}`);
    console.log(`  PR: ${result.pr}`);
  }

  console.log(`\n${c.green(c.bold('PIPELINE COMPLETE'))}`);
  console.log(`  output: ${c.bold(path.relative(REPO_ROOT, runDir))}/`);
  console.log(`  read:   ${path.relative(REPO_ROOT, runDir)}/MASTER-PLAYBOOK.md\n`);
}

main().catch((err) => { console.error(c.red(`\nPIPELINE ERROR: ${err.stack ?? err.message}`)); process.exit(1); });
