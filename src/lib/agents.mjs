/**
 * Live agent execution: prompt -> model -> parse -> validate.
 *
 * The trust rules are enforced here exactly as they are for fixture files. A
 * live model gets no special dispensation: if it invents a source or puts an
 * unsourced number in facts[], the output is rejected. That is the whole point
 * of the contract, and it is the reason a live run can be trusted at all.
 */

import { loadPrompt, fillTemplate } from './prompts.mjs';
import { callModel, isTruncated } from './provider.mjs';
import { packForAgent, renderPackForPrompt } from './sourcepack.mjs';
import { validateAgentOutput } from './validate.mjs';
import { nowIso } from './util.mjs';

/**
 * Extract a JSON object from model text.
 *
 * Models wrap JSON in fences or add a sentence before it even when told not
 * to. Recover where it is unambiguous, but never "repair" malformed JSON —
 * silently patching a truncated object would fabricate data.
 */
export function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('empty model response');
  }
  let s = text.trim();

  // Strip a leading ```json fence if present.
  const fence = s.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/);
  if (fence) s = fence[1].trim();

  try {
    return JSON.parse(s);
  } catch {
    // Fall back to the outermost balanced {...} span.
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start !== -1 && end > start) {
      const span = s.slice(start, end + 1);
      try {
        return JSON.parse(span);
      } catch {
        /* fall through */
      }
    }
    throw new Error('model did not return parseable JSON');
  }
}

/** Run one agent. Never throws for model/validation failure; returns a result. */
export async function runAgent({
  agentId,
  input,
  pack,
  runId,
  inputDigest,
  provider,
  apiKey,
  model,
  maxTokens,
  baseUrl,
  fetchImpl,
  log = () => {},
}) {
  const prompt = await loadPrompt(agentId);
  const sources = packForAgent(pack, agentId);
  const sourceBlock = renderPackForPrompt(sources);

  const user = fillTemplate(prompt.userTemplate, {
    business_idea: input.business_idea,
    sector: input.sector,
    target_customer: input.target_customer,
    geography: input.geography,
    stage: input.stage,
    budget_band: input.budget_band,
    run_id: runId,
    input_digest: inputDigest,
    source_block: sourceBlock,
  });

  const started = Date.now();
  let res;
  try {
    res = await callModel({
      provider,
      apiKey,
      model,
      system: prompt.system,
      user,
      maxTokens,
      baseUrl,
      fetchImpl,
      onRetry: ({ attempt, status, waitMs }) =>
        log(`    retry ${attempt} after ${status} (waiting ${waitMs}ms)`),
    });
  } catch (err) {
    return {
      ok: false, agentId, stage: 'transport', error: err.message,
      ms: Date.now() - started,
    };
  }

  // Truncation must be detected before parsing: a cut-off object is invalid
  // JSON, and reporting that as "bad JSON" hides the real cause (max_tokens).
  if (isTruncated(res.stop_reason)) {
    return {
      ok: false, agentId, stage: 'truncated',
      error: `response hit the token ceiling (stop_reason=${res.stop_reason}); raise --max-tokens`,
      usage: res.usage, ms: Date.now() - started,
    };
  }

  let doc;
  try {
    doc = extractJson(res.text);
  } catch (err) {
    return {
      ok: false, agentId, stage: 'parse', error: err.message,
      sample: String(res.text).slice(0, 300), usage: res.usage, ms: Date.now() - started,
    };
  }

  // Stamp run identity server-side. The model is not trusted to echo these
  // correctly, and a wrong run_id would misfile the output.
  doc.run_id = runId;
  doc.input_digest = inputDigest;
  doc.generated_at = doc.generated_at ?? nowIso();
  doc.agent = { ...(doc.agent ?? {}), id: agentId, prompt_sha256: prompt.sha256 };

  const allowedSourceIds = new Set(sources.map((s) => s.id));
  const verdict = await validateAgentOutput(doc, { allowedSourceIds });
  if (!verdict.ok) {
    return {
      ok: false, agentId, stage: 'contract', errors: verdict.errors,
      doc, usage: res.usage, ms: Date.now() - started,
    };
  }

  return {
    ok: true, agentId, doc,
    warnings: verdict.warnings, usage: res.usage, ms: Date.now() - started,
  };
}
