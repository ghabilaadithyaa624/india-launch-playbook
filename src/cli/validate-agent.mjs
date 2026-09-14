#!/usr/bin/env node
/** Validate one or more agent JSON files against the contract + trust rules. */
import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { REPO_ROOT, parseArgs, readJson, listJson, c } from '../lib/util.mjs';
import { validateAgentOutput } from '../lib/validate.mjs';

const args = parseArgs(process.argv.slice(2));
const target = args._[0] ?? args.dir ?? 'test/fixtures/agents';
const abs = path.resolve(REPO_ROOT, target);

if (!existsSync(abs)) { console.error(c.red(`not found: ${abs}`)); process.exit(1); }

const files = statSync(abs).isDirectory()
  ? (await listJson(abs)).map((f) => path.join(abs, f))
  : [abs];

let failed = 0;
for (const f of files) {
  const doc = await readJson(f);
  const res = await validateAgentOutput(doc);
  const name = path.basename(f);
  if (res.ok) {
    console.log(`${c.green('PASS')} ${name}`);
  } else {
    failed++;
    console.log(`${c.red('FAIL')} ${name}`);
    for (const e of res.errors) console.log(c.red(`     ${e}`));
  }
  for (const w of res.warnings) console.log(c.yellow(`     warn: ${w}`));
}
console.log(`\n${files.length - failed}/${files.length} passed`);
process.exit(failed ? 1 : 0);
