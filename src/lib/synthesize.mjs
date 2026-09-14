/**
 * SYNTHESIS LAYER
 *
 * Replaces `Object.values(files).join('\n\n---\n\n')` — which was concatenation,
 * not synthesis — with:
 *
 *   1. a deterministic cross-agent contradiction checker
 *   2. a global assumption register (dedup + blast-radius ranking)
 *   3. a global source register (with a fabrication-risk read-out)
 *   4. a confidence roll-up weighted by evidence density
 *
 * Everything here is deterministic: same inputs -> byte-identical playbook.json.
 * An optional LLM narrative pass can be layered on later, but the integrity
 * checks must never depend on a model.
 */

import { AGENT_IDS, AGENT_TITLES, nowIso } from './util.mjs';

/** Normalise text for fuzzy dedup. */
function norm(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function jaccard(a, b) {
  const A = new Set(norm(a).split(' ').filter((w) => w.length > 3));
  const B = new Set(norm(b).split(' ').filter((w) => w.length > 3));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * C1 — numeric contradiction: the same metric estimated by two agents with
 * non-overlapping [low,high] ranges.
 */
function findEstimateConflicts(docs) {
  const conflicts = [];
  const byMetric = new Map();
  for (const d of docs) {
    for (const e of d.estimates ?? []) {
      const key = `${norm(e.metric)}|${e.unit}`;
      if (!byMetric.has(key)) byMetric.set(key, []);
      byMetric.get(key).push({ agent: d.agent.id, ...e });
    }
  }
  for (const [key, items] of byMetric) {
    if (items.length < 2) continue;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (a.agent === b.agent) continue;
        const overlap = a.low <= b.high && b.low <= a.high;
        if (!overlap) {
          conflicts.push({
            type: 'estimate_range_disjoint',
            severity: 'high',
            metric: key.split('|')[0],
            detail:
              `${a.agent}:${a.id} = [${a.low}, ${a.high}] ${a.unit} does not overlap ` +
              `${b.agent}:${b.id} = [${b.low}, ${b.high}] ${b.unit}`,
            agents: [a.agent, b.agent],
            ids: [a.id, b.id],
          });
        }
      }
    }
  }
  return conflicts;
}

/** C2 — an agent declared may_contradict and both sides shipped content. */
function findDeclaredContradictions(docs) {
  const present = new Set(docs.map((d) => d.agent.id));
  const out = [];
  for (const d of docs) {
    for (const dep of d.dependencies ?? []) {
      if (dep.relationship === 'may_contradict' && present.has(dep.agent_id)) {
        out.push({
          type: 'declared_may_contradict',
          severity: 'medium',
          detail: `${d.agent.id} flags possible contradiction with ${dep.agent_id}${dep.note ? `: ${dep.note}` : ''}`,
          agents: [d.agent.id, dep.agent_id],
          ids: [],
        });
      }
    }
  }
  return out;
}

/** C3 — a required upstream agent is missing from the run. */
function findMissingDependencies(docs) {
  const present = new Set(docs.map((d) => d.agent.id));
  const out = [];
  for (const d of docs) {
    for (const dep of d.dependencies ?? []) {
      if (dep.relationship === 'requires' && !present.has(dep.agent_id)) {
        out.push({
          type: 'missing_required_dependency',
          severity: 'high',
          detail: `${d.agent.id} requires ${dep.agent_id}, which produced no output in this run`,
          agents: [d.agent.id, dep.agent_id],
          ids: [],
        });
      }
    }
  }
  return out;
}

/** C4 — two agents assert contradictory facts about the same subject. */
function findFactTension(docs) {
  const out = [];
  const all = [];
  for (const d of docs) for (const f of d.facts ?? []) all.push({ agent: d.agent.id, ...f });
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (a.agent === b.agent) continue;
      if (a.value == null || b.value == null) continue;
      if (typeof a.value !== 'number' || typeof b.value !== 'number') continue;
      if (a.unit !== b.unit) continue;
      if (jaccard(a.statement, b.statement) < 0.5) continue;
      const denom = Math.max(Math.abs(a.value), Math.abs(b.value)) || 1;
      const delta = Math.abs(a.value - b.value) / denom;
      if (delta > 0.2) {
        out.push({
          type: 'fact_value_divergence',
          severity: 'high',
          detail:
            `${a.agent}:${a.id} (${a.value} ${a.unit}) vs ${b.agent}:${b.id} ` +
            `(${b.value} ${b.unit}) differ by ${(delta * 100).toFixed(0)}% on similar statements`,
          agents: [a.agent, b.agent],
          ids: [a.id, b.id],
        });
      }
    }
  }
  return out;
}

/** Deduplicated, severity-ranked global assumption register. */
function buildAssumptionRegister(docs) {
  const rank = { critical: 4, high: 3, medium: 2, low: 1 };
  const register = [];
  for (const d of docs) {
    for (const a of d.assumptions ?? []) {
      const hit = register.find((r) => jaccard(r.statement, a.statement) > 0.6);
      if (hit) {
        hit.asserted_by.push({ agent: d.agent.id, id: a.id });
        if (rank[a.impact_if_wrong] > rank[hit.impact_if_wrong]) {
          hit.impact_if_wrong = a.impact_if_wrong;
        }
      } else {
        register.push({
          statement: a.statement,
          rationale: a.rationale,
          impact_if_wrong: a.impact_if_wrong,
          validation_method: a.validation_method,
          asserted_by: [{ agent: d.agent.id, id: a.id }],
        });
      }
    }
  }
  return register.sort((x, y) => rank[y.impact_if_wrong] - rank[x.impact_if_wrong]);
}

function buildSourceRegister(docs) {
  const byKey = new Map();
  for (const d of docs) {
    for (const s of d.sources ?? []) {
      const key = `${s.publisher}|${s.title}`;
      if (!byKey.has(key)) byKey.set(key, { ...s, cited_by: [] });
      byKey.get(key).cited_by.push({ agent: d.agent.id, source_id: s.id });
    }
  }
  return [...byKey.values()];
}

/**
 * Evidence-weighted confidence. An agent that asserts a lot with little
 * evidence is penalised; the run cannot score better than its weakest link
 * on a critical assumption.
 */
function rollUpConfidence(docs, conflicts) {
  const per = docs.map((d) => {
    const f = (d.facts ?? []).length;
    const a = (d.assumptions ?? []).length;
    const e = (d.estimates ?? []).length;
    const claims = f + a + e;
    const density = claims === 0 ? 0 : f / claims;
    const stated = d.confidence?.overall ?? 0.5;
    // blend the agent's self-report with observed evidence density
    const score = Math.max(0, Math.min(1, stated * 0.6 + density * 0.4));
    return { agent: d.agent.id, stated, evidence_density: Number(density.toFixed(3)), score: Number(score.toFixed(3)) };
  });

  const base = per.length ? per.reduce((s, p) => s + p.score, 0) / per.length : 0;
  const highSev = conflicts.filter((c) => c.severity === 'high').length;
  const penalty = Math.min(0.4, highSev * 0.08);
  const overall = Number(Math.max(0, base - penalty).toFixed(3));

  return { overall, base: Number(base.toFixed(3)), conflict_penalty: Number(penalty.toFixed(3)), per_agent: per };
}

/**
 * @param {object[]} docs  validated agent outputs
 * @param {object} meta    { run_id, input, input_digest, source_pack }
 */
export function synthesize(docs, meta) {
  const ordered = [...docs].sort(
    (a, b) => AGENT_IDS.indexOf(a.agent.id) - AGENT_IDS.indexOf(b.agent.id)
  );

  const conflicts = [
    ...findEstimateConflicts(ordered),
    ...findFactTension(ordered),
    ...findDeclaredContradictions(ordered),
    ...findMissingDependencies(ordered),
  ];

  const assumption_register = buildAssumptionRegister(ordered);
  const source_register = buildSourceRegister(ordered);
  const confidence = rollUpConfidence(ordered, conflicts);

  const totals = {
    agents: ordered.length,
    agents_expected: AGENT_IDS.length,
    agents_missing: AGENT_IDS.filter((id) => !ordered.some((d) => d.agent.id === id)),
    facts: ordered.reduce((s, d) => s + (d.facts ?? []).length, 0),
    assumptions: ordered.reduce((s, d) => s + (d.assumptions ?? []).length, 0),
    estimates: ordered.reduce((s, d) => s + (d.estimates ?? []).length, 0),
    recommendations: ordered.reduce((s, d) => s + (d.recommendations ?? []).length, 0),
    risks: ordered.reduce((s, d) => s + (d.risks ?? []).length, 0),
    sources: source_register.length,
    conflicts: conflicts.length,
  };

  const p0 = [];
  for (const d of ordered) {
    for (const r of d.recommendations ?? []) {
      if (r.priority === 'P0') {
        p0.push({ agent: d.agent.id, id: r.id, action: r.action, owner_role: r.owner_role,
                  requires_professional_review: r.requires_professional_review === true });
      }
    }
  }

  const topRisks = [];
  for (const d of ordered) {
    for (const k of d.risks ?? []) {
      topRisks.push({ agent: d.agent.id, id: k.id, description: k.description,
                      category: k.category, score: k.likelihood * k.impact, mitigation: k.mitigation });
    }
  }
  topRisks.sort((a, b) => b.score - a.score);

  return {
    schema_version: '1.0.0',
    run_id: meta.run_id,
    generated_at: nowIso(),
    input: meta.input,
    input_digest: meta.input_digest,
    source_pack_mode: meta.source_pack?.mode ?? 'offline',
    totals,
    confidence,
    conflicts,
    assumption_register,
    source_register,
    priority_actions: p0,
    top_risks: topRisks.slice(0, 15),
    agents: ordered.map((d) => ({
      id: d.agent.id,
      title: AGENT_TITLES[d.agent.id] ?? d.agent.id,
      model: d.agent.model,
      prompt_sha256: d.agent.prompt_sha256,
      generated_at: d.generated_at,
      executive_summary: d.executive_summary,
      counts: {
        facts: (d.facts ?? []).length,
        assumptions: (d.assumptions ?? []).length,
        estimates: (d.estimates ?? []).length,
        recommendations: (d.recommendations ?? []).length,
        risks: (d.risks ?? []).length,
      },
      confidence: d.confidence,
      document: d,
    })),
  };
}
