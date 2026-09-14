/**
 * Model provider abstraction.
 *
 * The repo previously hard-coded api.anthropic.com into the n8n workflow. That
 * makes the key type part of the architecture: an OpenRouter key
 * (sk-or-v1-...) cannot authenticate against Anthropic's endpoint, and the
 * request/response shapes differ. This module isolates those differences so
 * the pipeline is provider-agnostic and the key you hold determines the route.
 *
 * Providers must return a normalised result:
 *   { text, stop_reason, usage:{input_tokens,output_tokens}, raw }
 *
 * `stop_reason` is normalised because truncation detection is a correctness
 * requirement: a JSON object cut off at max_tokens parses as invalid and must
 * be reported as truncation, not as a model failure.
 */

const TRUNCATED = new Set(['max_tokens', 'length', 'MAX_TOKENS']);

/** Detect provider from key shape so the wrong endpoint can't be selected. */
export function detectProvider(apiKey) {
  if (!apiKey) return null;
  if (apiKey.startsWith('sk-or-')) return 'openrouter';
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  return null;
}

export function isTruncated(stopReason) {
  return TRUNCATED.has(String(stopReason));
}

/* ------------------------------------------------------------------ */
/* Anthropic Messages API                                              */
/* ------------------------------------------------------------------ */
const anthropic = {
  id: 'anthropic',
  defaultBase: 'https://api.anthropic.com',
  defaultModel: 'claude-sonnet-4-5',
  path: '/v1/messages',
  headers(key, extra = {}) {
    return {
      // x-api-key is Anthropic's documented auth header. Bearer is accepted on
      // some paths but x-api-key is the one consistently documented.
      'x-api-key': key,
      'anthropic-version': extra.version ?? '2023-06-01',
      'content-type': 'application/json',
    };
  },
  body({ model, system, user, maxTokens }) {
    return {
      model,
      max_tokens: maxTokens,
      // Anthropic takes `system` as a top-level field, not a message role.
      system,
      messages: [{ role: 'user', content: user }],
    };
  },
  parse(json) {
    const text = (json.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return {
      text,
      stop_reason: json.stop_reason,
      usage: {
        input_tokens: json.usage?.input_tokens ?? null,
        output_tokens: json.usage?.output_tokens ?? null,
      },
      raw: json,
    };
  },
};

/* ------------------------------------------------------------------ */
/* OpenRouter (OpenAI-compatible chat completions)                     */
/* ------------------------------------------------------------------ */
const openrouter = {
  id: 'openrouter',
  defaultBase: 'https://openrouter.ai/api',
  defaultModel: 'anthropic/claude-sonnet-4.5',
  path: '/v1/chat/completions',
  headers(key, extra = {}) {
    const h = {
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    };
    // Optional attribution headers OpenRouter uses for rankings.
    if (extra.referer) h['HTTP-Referer'] = extra.referer;
    if (extra.title) h['X-Title'] = extra.title;
    return h;
  },
  body({ model, system, user, maxTokens }) {
    return {
      model,
      max_tokens: maxTokens,
      // OpenAI shape: system is a message, not a top-level field.
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      // Ask for JSON back. Harmless if a model ignores it; the validator is
      // still the real gate.
      response_format: { type: 'json_object' },
    };
  },
  parse(json) {
    const choice = (json.choices ?? [])[0] ?? {};
    return {
      text: choice.message?.content ?? '',
      stop_reason: choice.finish_reason,
      usage: {
        input_tokens: json.usage?.prompt_tokens ?? null,
        output_tokens: json.usage?.completion_tokens ?? null,
      },
      raw: json,
    };
  },
};

const PROVIDERS = { anthropic, openrouter };

export function getProvider(name) {
  const p = PROVIDERS[name];
  if (!p) {
    throw new Error(
      `unknown provider "${name}" (expected: ${Object.keys(PROVIDERS).join(', ')})`
    );
  }
  return p;
}

/**
 * Single model call with timeout and bounded retry.
 *
 * Retries only on 429 and 5xx — the transient classes. A 401 or 400 is a
 * configuration error and retrying it just burns quota and obscures the cause.
 */
export async function callModel({
  provider,
  apiKey,
  model,
  system,
  user,
  maxTokens = 8000,
  baseUrl,
  timeoutMs = 120000,
  maxRetries = 3,
  extraHeaders = {},
  fetchImpl = globalThis.fetch,
  onRetry = () => {},
}) {
  const p = getProvider(provider);
  const url = (baseUrl ?? p.defaultBase) + p.path;
  const headers = p.headers(apiKey, extraHeaders);
  const payload = p.body({ model: model ?? p.defaultModel, system, user, maxTokens });

  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: ac.signal,
      });

      if (res.status === 429 || res.status >= 500) {
        const retryable = attempt < maxRetries;
        const bodyText = await res.text().catch(() => '');
        lastErr = new Error(`HTTP ${res.status} from ${p.id}: ${bodyText.slice(0, 300)}`);
        if (!retryable) throw lastErr;
        // Honour Retry-After when present, else exponential backoff.
        const ra = Number(res.headers.get('retry-after'));
        const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2 ** attempt * 1000;
        onRetry({ attempt: attempt + 1, status: res.status, waitMs });
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        // Non-retryable: surface immediately with the provider's message.
        throw new Error(`HTTP ${res.status} from ${p.id}: ${bodyText.slice(0, 500)}`);
      }

      const json = await res.json();
      if (json.error) {
        throw new Error(`${p.id} error: ${JSON.stringify(json.error).slice(0, 300)}`);
      }
      return p.parse(json);
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        lastErr = new Error(`timeout after ${timeoutMs}ms calling ${p.id}`);
        if (attempt < maxRetries) {
          onRetry({ attempt: attempt + 1, status: 'timeout', waitMs: 2 ** attempt * 1000 });
          await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
          continue;
        }
        throw lastErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error('model call failed');
}
