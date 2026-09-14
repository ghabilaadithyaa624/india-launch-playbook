/**
 * Agent-output validation: JSON Schema + the trust rules that a schema alone
 * cannot express.
 *
 * The schema guarantees SHAPE. These semantic rules guarantee TRUST:
 *   T1  every fact resolves to a declared source
 *   T2  no fact is backed only by model_internal_knowledge  (the anti-hallucination rule)
 *   T3  every referenced id (depends_on / rationale_ids / low_confidence_area_ids) exists
 *   T4  ids are unique within their namespace
 *   T5  estimates are ordered low <= base <= high
 *   T6  regulated-domain recommendations must flag professional review
 *   T7  sources claiming web_fetch must carry a url
 *   T8  agent.id must match the file/slot it was produced for
 */

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

/** Domains where an AI recommendation must never stand alone. */
const REGULATED_PATTERNS = [
  /\bgst\b/i, /\btax\b/i, /\btds\b/i, /\bincome[- ]tax\b/i,
  /\bdpdp\b/i, /\bprivacy\b/i, /\bpersonal data\b/i, /\bconsent\b/i,
  /\bfssai\b/i, /\blicen[cs]e\b/i, /\bregistration\b/i, /\bincorporat/i,
  /\brbi\b/i, /\bpayment aggregator\b/i, /\bkyc\b/i,
  /\btrai\b/i, /\bdlt\b/i, /\bcert-?in\b/i,
  /\bcompliance\b/i, /\blegal\b/i, /\blabour\b/i, /\blabor\b/i,
  /\bcustoms\b/i, /\bdgft\b/i, /\bimport\b/i, /\bhaccp\b/i,
];

let _ajv = null;
async function getAjv() {
  if (_ajv) return _ajv;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  _ajv = ajv;
  return ajv;
}

async function loadSchema(name) {
  const raw = await readFile(path.join(REPO_ROOT, 'schemas', name), 'utf8');
  return JSON.parse(raw);
}

/**
 * Compile once per schema and reuse. Ajv rejects re-adding the same $id, and
 * recompiling per call would be wasteful on an 8-agent run.
 */
const _validators = new Map();
async function getValidator(name) {
  if (_validators.has(name)) return _validators.get(name);
  const ajv = await getAjv();
  const schema = await loadSchema(name);
  const fn = ajv.getSchema(schema.$id) ?? ajv.compile(schema);
  _validators.set(name, fn);
  return fn;
}

export async function validateRunInput(input) {
  const validate = await getValidator('run-input.schema.json');
  const ok = validate(input);
  return {
    ok,
    errors: ok ? [] : validate.errors.map(formatAjvError),
  };
}

function formatAjvError(e) {
  const where = e.instancePath || '(root)';
  return `${where} ${e.message}${e.params ? ' ' + JSON.stringify(e.params) : ''}`;
}

/**
 * Validate a single agent output.
 * @param {object} doc            parsed agent JSON
 * @param {object} [opts]
 * @param {string} [opts.expectedAgentId]
 * @param {string} [opts.expectedRunId]
 * @returns {Promise<{ok:boolean, errors:string[], warnings:string[]}>}
 */
export async function validateAgentOutput(doc, opts = {}) {
  const errors = [];
  const warnings = [];

  const validate = await getValidator('agent-output.schema.json');

  if (!validate(doc)) {
    for (const e of validate.errors) errors.push(`SCHEMA ${formatAjvError(e)}`);
    // Shape is wrong; semantic checks would just produce noise.
    return { ok: false, errors, warnings };
  }

  const sourceById = new Map((doc.sources ?? []).map((s) => [s.id, s]));

  // T4 — id uniqueness per namespace
  for (const [label, arr] of [
    ['facts', doc.facts], ['assumptions', doc.assumptions],
    ['estimates', doc.estimates], ['recommendations', doc.recommendations],
    ['risks', doc.risks], ['sources', doc.sources],
  ]) {
    const seen = new Set();
    for (const item of arr ?? []) {
      if (seen.has(item.id)) errors.push(`T4 duplicate id "${item.id}" in ${label}`);
      seen.add(item.id);
    }
  }

  // T1 + T2 — the core anti-fabrication rules
  for (const f of doc.facts ?? []) {
    let backedByReal = false;
    for (const sid of f.source_ids) {
      const src = sourceById.get(sid);
      if (!src) {
        errors.push(`T1 fact ${f.id} cites unknown source "${sid}"`);
        continue;
      }
      if (src.type !== 'model_internal_knowledge') backedByReal = true;
    }
    if (!backedByReal) {
      errors.push(
        `T2 fact ${f.id} is backed only by model_internal_knowledge — ` +
        `it must be demoted to assumptions[] or estimates[]`
      );
    }
    if (f.verification === 'unverified') {
      warnings.push(`T2 fact ${f.id} is marked unverified; consider demoting to an assumption`);
    }
  }

  // T3 — referential integrity across id namespaces
  const knownIds = new Set([
    ...(doc.facts ?? []).map((x) => x.id),
    ...(doc.assumptions ?? []).map((x) => x.id),
    ...(doc.estimates ?? []).map((x) => x.id),
    ...(doc.risks ?? []).map((x) => x.id),
    ...(doc.recommendations ?? []).map((x) => x.id),
  ]);
  const checkRefs = (ids, label) => {
    for (const id of ids ?? []) {
      if (!knownIds.has(id)) errors.push(`T3 ${label} references unknown id "${id}"`);
    }
  };
  for (const e of doc.estimates ?? []) checkRefs(e.depends_on, `estimate ${e.id}.depends_on`);
  for (const r of doc.recommendations ?? []) checkRefs(r.rationale_ids, `recommendation ${r.id}.rationale_ids`);
  checkRefs(doc.confidence?.low_confidence_area_ids, 'confidence.low_confidence_area_ids');

  // T5 — estimate ordering
  for (const e of doc.estimates ?? []) {
    if (!(e.low <= e.base && e.base <= e.high)) {
      errors.push(`T5 estimate ${e.id} violates low<=base<=high (${e.low}/${e.base}/${e.high})`);
    }
  }

  // T6 — regulated recommendations need a human
  for (const r of doc.recommendations ?? []) {
    const hit = REGULATED_PATTERNS.find((re) => re.test(r.action));
    if (hit && r.requires_professional_review !== true) {
      errors.push(
        `T6 recommendation ${r.id} touches a regulated domain (${hit}) ` +
        `and must set requires_professional_review: true`
      );
    }
  }

  // T7 — web_fetch sources must have a url
  for (const s of doc.sources ?? []) {
    if (s.retrieval_method === 'web_fetch' && !s.url) {
      errors.push(`T7 source ${s.id} claims web_fetch but has no url`);
    }
    if (s.type !== 'model_internal_knowledge' && s.retrieval_method === 'none' && !s.url) {
      warnings.push(`T7 source ${s.id} has no url and no retrieval method — provenance is weak`);
    }
  }

  // T8 — identity checks
  if (opts.expectedAgentId && doc.agent?.id !== opts.expectedAgentId) {
    errors.push(`T8 agent.id "${doc.agent?.id}" does not match expected "${opts.expectedAgentId}"`);
  }
  if (opts.expectedRunId && doc.run_id !== opts.expectedRunId) {
    errors.push(`T8 run_id "${doc.run_id}" does not match run "${opts.expectedRunId}"`);
  }

  // Advisory signals
  if ((doc.facts ?? []).length === 0) {
    warnings.push('no facts[] — output rests entirely on assumptions and estimates');
  }
  if ((doc.assumptions ?? []).length === 0 && (doc.estimates ?? []).length > 0) {
    warnings.push('estimates[] present but assumptions[] empty — estimates usually rest on assumptions');
  }

  return { ok: errors.length === 0, errors, warnings };
}

export { REGULATED_PATTERNS };
