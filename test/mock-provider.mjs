/**
 * Mock model server speaking both provider dialects.
 *
 * The sandbox has no outbound network, so this is how the live path is proven:
 * everything except the TLS hop runs for real — header construction, body
 * shape, retry/backoff, truncation detection, JSON extraction, contract
 * validation. Scenarios reproduce the failures that actually matter.
 */

import http from 'node:http';

/** A minimal contract-valid agent document, shaped to the real schema. */
export function validDoc(agentId = 'market_research', sourceId = 'S011') {
  return {
    schema_version: '1.0.0',
    run_id: '00000000-0000-4000-8000-000000000000',
    agent: {
      id: agentId,
      name: 'Market Research & Insights',
      version: '1.0.0',
      model: 'test/model',
      prompt_sha256: 'b'.repeat(64),
    },
    generated_at: '2025-09-14T08:00:00.000Z',
    input_digest: 'x'.repeat(64),
    executive_summary:
      'Indian manufacturing SMEs face mandatory e-invoicing thresholds under GST, which creates a compliance-driven adoption trigger for invoicing software in the target cities.',
    facts: [
      {
        id: 'F001',
        statement: 'GST registration, return filing and e-invoicing requirements are published on the official GST portal.',
        value: null,
        unit: null,
        as_of: '2026-09-14',
        source_ids: [sourceId],
        verification: 'primary_source_verified',
      },
    ],
    assumptions: [
      {
        id: 'A001',
        statement: 'Owner-operators adopt compliance software once penalty exposure exceeds switching cost.',
        rationale: 'Observed replacement cycles in adjacent compliance-software categories.',
        impact_if_wrong: 'critical',
        validation_method: 'Run 30 structured discovery interviews and measure stated replacement intent.',
      },
    ],
    estimates: [
      {
        id: 'E001',
        metric: 'average revenue per account',
        low: 1200,
        base: 2000,
        high: 3500,
        unit: 'inr_per_month',
        method: 'bottom_up',
        depends_on: ['A001'],
      },
    ],
    recommendations: [
      {
        id: 'R001',
        action: 'Validate the GST filing workflow with a design partner before building reconciliation.',
        priority: 'P0',
        owner_role: 'Founder',
        effort: 'M',
        rationale_ids: ['A001', 'E001'],
        // T6: mentions GST, a regulated domain, so this must be true.
        requires_professional_review: true,
      },
    ],
    risks: [
      {
        id: 'K001',
        description: 'Turnover-threshold changes could reset the addressable segment.',
        category: 'regulatory',
        likelihood: 3,
        impact: 4,
        mitigation: 'Track CBIC notifications quarterly and re-run sizing on change.',
        early_warning_indicator: 'A CBIC notification altering the e-invoicing turnover threshold.',
      },
    ],
    dependencies: [],
    sources: [
      {
        id: sourceId,
        type: 'primary_regulator',
        publisher: 'Goods and Services Tax Network',
        title: 'GST registration, returns and rates',
        url: 'https://www.gst.gov.in/',
        published_at: null,
        accessed_at: '2026-09-14',
        retrieval_method: 'none',
      },
    ],
    confidence: {
      overall: 0.55,
      basis: 'Regulatory mechanics trace to a primary source; demand sizing rests on an unvalidated assumption.',
      low_confidence_area_ids: ['A001', 'E001'],
    },
    coverage: { unanswered_questions: ['Actual willingness to pay is unmeasured.'] },
  };
}

/** Document that must be REJECTED: an unsourced number sitting in facts[]. */
export function fabricatedDoc(agentId = 'market_research') {
  const d = validDoc(agentId);
  d.facts.push({
    id: 'F002',
    statement: 'The Indian GST software market will reach USD 4.2 billion by 2027, growing at 18.5% CAGR.',
    value: 4.2,
    unit: 'usd_billion',
    as_of: '2026-09-14',
    source_ids: [],
    verification: 'unverified',
  });
  return d;
}

function payloadFor(scenario, agentId, dialect) {
  const wrap = (obj, stop) => {
    const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
    return dialect === 'anthropic'
      ? { content: [{ type: 'text', text }], stop_reason: stop ?? 'end_turn', usage: { input_tokens: 1200, output_tokens: 900 } }
      : { choices: [{ message: { role: 'assistant', content: text }, finish_reason: stop ?? 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 900 } };
  };

  switch (scenario) {
    case 'valid':       return wrap(validDoc(agentId));
    case 'fenced':      return wrap('```json\n' + JSON.stringify(validDoc(agentId)) + '\n```');
    case 'prose':       return wrap('Here is the analysis you requested:\n\n' + JSON.stringify(validDoc(agentId)));
    case 'fabricated':  return wrap(fabricatedDoc(agentId));
    case 'truncated':   return wrap(JSON.stringify(validDoc(agentId)).slice(0, 400), dialect === 'anthropic' ? 'max_tokens' : 'length');
    case 'notjson':     return wrap('I cannot produce that as JSON, but here is a summary in prose.');
    default:            return wrap(validDoc(agentId));
  }
}

/**
 * @param {object} opts
 * @param {string} opts.scenario  one of valid|fenced|prose|fabricated|truncated|notjson
 * @param {number} opts.failTimes  return 429/500 this many times before succeeding
 */
export async function startMock(opts = {}) {
  const { scenario = 'valid', failTimes = 0, failStatus = 429, requireAuth = true } = opts;
  const seen = [];
  let failsLeft = failTimes;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const dialect = req.url.includes('/chat/completions') ? 'openai' : 'anthropic';
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { /* record as null */ }
      seen.push({ url: req.url, headers: req.headers, body: parsed, raw: body });

      const send = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };

      if (requireAuth) {
        const hasAnthropic = typeof req.headers['x-api-key'] === 'string';
        const hasBearer = String(req.headers.authorization ?? '').startsWith('Bearer ');
        if (!hasAnthropic && !hasBearer) return send(401, { error: { message: 'missing credentials' } });
      }
      if (failsLeft > 0) {
        failsLeft--;
        return send(failStatus, { error: { message: 'rate limited' } });
      }

      const agentId = parsed?.messages
        ? 'market_research'
        : 'market_research';
      send(200, payloadFor(scenario, agentId, dialect));
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests: seen,
    close: () => new Promise((r) => server.close(r)),
  };
}
