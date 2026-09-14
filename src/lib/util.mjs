import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..'
);

/**
 * Deterministic clock. When SOURCE_DATE_EPOCH is set (seconds since epoch),
 * every generated timestamp is pinned to it. This makes byte-for-byte
 * reproducibility verifiable in CI without freezing wall-clock time in prod.
 */
export function nowIso() {
  const e = process.env.SOURCE_DATE_EPOCH;
  if (e && /^\d+$/.test(e)) return new Date(Number(e) * 1000).toISOString();
  return new Date().toISOString();
}

export function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export function newRunId() {
  return randomUUID();
}

/**
 * Canonical JSON: key-sorted, so the same logical input always digests
 * to the same value regardless of key order. Required for reproducibility.
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

export function digestInput(input) {
  return sha256(canonicalJson(input));
}

export async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}

export async function writeJson(p, obj) {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

export async function writeText(p, text) {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, text, 'utf8');
}

export async function listJson(dir) {
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  return names.filter((n) => n.endsWith('.json')).sort();
}

/** Minimal arg parser: --key value  and  --flag */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

export const AGENT_IDS = [
  'market_research',
  'regulatory_compliance',
  'market_entry',
  'competitive_landscape',
  'go_to_market',
  'financial_projections',
  'risk_management',
  'implementation_roadmap',
];

export const AGENT_TITLES = {
  market_research: 'Market Research & Insights',
  regulatory_compliance: 'Regulatory & Compliance Framework',
  market_entry: 'Market Entry Strategy',
  competitive_landscape: 'Competitive Landscape Analysis',
  go_to_market: 'Go-To-Market Plan',
  financial_projections: 'Financial Projections & Pricing',
  risk_management: 'Risk Management & Contingencies',
  implementation_roadmap: 'Implementation Roadmap',
};

/** Stable doc number (01..08) used in generated filenames. */
export function agentDocNumber(agentId) {
  return String(AGENT_IDS.indexOf(agentId) + 1).padStart(2, '0');
}

export const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
