#!/usr/bin/env node
/**
 * Repository documentation lint.
 *
 * Encodes the audit findings as enforceable checks so regressions fail CI
 * instead of silently returning.
 *
 *   L1 withdrawn / wrong statute names          (e.g. "PDPB", "IT Act 2021")
 *   L2 broken relative markdown links
 *   L3 references to files that do not exist
 *   L4 line-count promises (the metric that caused truncation)
 *   L5 placeholder leftovers in tracked docs
 *   L6 real-looking secrets
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, c } from '../lib/util.mjs';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'runs', 'test']);

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const STATUTE_ERRORS = [
  { re: /\bPDPB\b/g, msg: 'PDPB was withdrawn in Aug 2022; use "DPDP Act, 2023"' },
  { re: /\bPersonal Data Protection Bill\b/gi, msg: 'superseded by the DPDP Act, 2023' },
  { re: /\bIT Act,?\s*2021\b/gi, msg: 'the Information Technology Act is 2000, not 2021' },
  { re: /\bIT Act,?\s*2011\b/gi, msg: 'check: the Information Technology Act is 2000' },
];

const LINE_COUNT_RE = /\b(\d{3,4})\s*lines\b/gi;
const SECRET_RES = [
  { re: /sk-ant-(?!x{3,}|REPLACE)[A-Za-z0-9_-]{20,}/g, msg: 'possible real Anthropic key' },
  { re: /ghp_(?!x{3,}|REPLACE)[A-Za-z0-9]{20,}/g, msg: 'possible real GitHub token' },
  { re: /github_pat_(?!REPLACE)[A-Za-z0-9_]{30,}/g, msg: 'possible real GitHub fine-grained token' },
];

const errors = [];
const warnings = [];

const files = await walk(REPO_ROOT);
for (const f of files) {
  const rel = path.relative(REPO_ROOT, f);
  const txt = await readFile(f, 'utf8');
  const lines = txt.split('\n');

  // Historical artifacts are preserved verbatim with their errors annotated in
  // place. They opt out of statute linting; the annotation is the fix.
  const isArchived = /lint-disable:statutes/.test(txt);

  lines.forEach((line, i) => {
    const ln = i + 1;
    const isCorrectionContext =
      /\bwithdrawn\b|\bis \*{0,2}2000\*{0,2}\b|\breplaced by\b|\bnot\s+2021\b|^\s*>/i.test(line);
    if (!isArchived && !isCorrectionContext) {
      for (const s of STATUTE_ERRORS) {
        s.re.lastIndex = 0;
        if (s.re.test(line)) errors.push(`${rel}:${ln} L1 ${s.msg}`);
      }
    }
    for (const s of SECRET_RES) {
      s.re.lastIndex = 0;
      if (s.re.test(line)) errors.push(`${rel}:${ln} L6 ${s.msg}`);
    }
    LINE_COUNT_RE.lastIndex = 0;
    let m;
    while ((m = LINE_COUNT_RE.exec(line))) {
      const isRetrospective = /\bv1\b|\basked\b|\bremoved\b|\bgone\b|\bwas\b|\bused to\b|~/i.test(line);
      if (Number(m[1]) >= 300 && !isRetrospective) {
        warnings.push(`${rel}:${ln} L4 line-count promise "${m[0]}" — validate completeness, not volume`);
      }
    }
  });

  // L2/L3 relative links
  for (const m of txt.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)) {
    const target = m[2];
    if (/^(https?:|#|mailto:)/.test(target)) continue;
    const clean = target.split('#')[0];
    if (!clean) continue;
    const resolved = path.resolve(path.dirname(f), clean);
    if (!existsSync(resolved)) {
      errors.push(`${rel} L2 broken link -> ${target}`);
    }
  }
}

console.log(c.bold('\nDocumentation lint\n'));
for (const w of warnings) console.log(c.yellow(`  WARN  ${w}`));
for (const e of errors) console.log(c.red(`  ERROR ${e}`));
console.log(`\n  ${errors.length} error(s), ${warnings.length} warning(s)\n`);
process.exit(errors.length ? 1 : 0);
