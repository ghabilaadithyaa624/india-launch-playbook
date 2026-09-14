# Pipeline — setup and operation

How the generator works, how to run it, and the rules that make its output trustworthy.

> **Single source of truth.** Agent configuration lives in
> [`N8N_COMPLETE_WORKFLOW.json`](N8N_COMPLETE_WORKFLOW.json) (runtime) and
> [`config/source-whitelist.yaml`](config/source-whitelist.yaml) (evidence).
> The contract lives in [`schemas/agent-output.schema.json`](schemas/agent-output.schema.json).
> Do not restate these values elsewhere — drifted copies were a real defect in v1.

---

## 1 · Run it offline first

No API key, no n8n, no network:

```bash
npm install
npm run demo          # full pipeline against bundled fixtures -> runs/demo/
npm test              # 22 contract, trust, security and reproducibility tests
npm run lint:docs     # statute errors, broken links, secret scan
```

Read [`runs/demo/MASTER-PLAYBOOK.md`](runs/demo/MASTER-PLAYBOOK.md).

The fixtures contain a **deliberate contradiction** — `market_research` estimates revenue per account at ₹1,500–4,500 while `financial_projections` says ₹6,000–11,000. The ranges do not overlap, so synthesis flags it `HIGH` and docks the confidence score. This is the behaviour you want to see before trusting any real run.

---

## 2 · The seven stages

| # | Stage | Module | What it guarantees |
|---|---|---|---|
| 1 | Validate input | `src/lib/validate.mjs` | No tokens are spent on an incomplete idea. |
| 2 | Source pack | `src/lib/sourcepack.mjs` | Agents can only cite whitelisted Indian primary sources. |
| 3 | Agents | n8n workflow | Eight specialists emit **structured JSON**, never prose. |
| 4 | Validate each | `src/lib/validate.mjs` | A fact with no real source is rejected. |
| 5 | Synthesis | `src/lib/synthesize.mjs` | Cross-agent contradictions surface deterministically. |
| 6 | Render | `src/lib/render.mjs` | Facts, assumptions and estimates stay visually separate. |
| 7 | Publish | `src/lib/publish.mjs` | Writes only to `runs/`, via a branch and a PR. |

---

## 3 · The trust rules

The JSON Schema guarantees *shape*. These rules, enforced in `src/lib/validate.mjs`, guarantee *trust*:

| Rule | Meaning | On violation |
|---|---|---|
| **T1** | Every `facts[].source_ids` entry resolves to a declared source. | reject |
| **T2** | No fact is backed **only** by `model_internal_knowledge`. | reject — demote to assumption/estimate |
| **T3** | Every cross-reference (`depends_on`, `rationale_ids`) points at a real id. | reject |
| **T4** | Ids are unique within their namespace. | reject |
| **T5** | Estimates satisfy `low <= base <= high`. | reject |
| **T6** | Recommendations touching tax, GST, DPDP/privacy, licensing, payments, labour or customs set `requires_professional_review: true`. | reject |
| **T7** | A source claiming `web_fetch` carries a URL. | reject |
| **T8** | `agent.id` and `run_id` match the slot being filled. | reject |

**T2 is the important one.** It is why the generator cannot quietly invent a "market research firm (2024)" or a "consumer survey (n = 2,400)" — the two fabrications found in the v1 sample output. An unsourced claim is not blocked from existing; it is **relabelled** as an assumption or estimate and rendered in a section the reader cannot confuse with evidence.

---

## 4 · The output contract

Every agent returns one object matching [`schemas/agent-output.schema.json`](schemas/agent-output.schema.json):

```jsonc
{
  "schema_version": "1.0.0",
  "run_id": "…", "input_digest": "…",
  "agent": { "id": "market_research", "model": "…", "prompt_sha256": "…" },
  "executive_summary": "…",

  "facts":       [{ "id": "F001", "statement": "…", "source_ids": ["S006"],
                    "as_of": "2026-09-14", "verification": "primary_source_verified" }],
  "assumptions": [{ "id": "A001", "statement": "…", "impact_if_wrong": "critical",
                    "validation_method": "…" }],
  "estimates":   [{ "id": "E001", "metric": "…", "low": 900, "base": 1800, "high": 3200,
                    "unit": "paying_firms", "method": "bottom_up", "depends_on": ["A001"] }],

  "recommendations": [{ "id": "R001", "priority": "P0", "requires_professional_review": true }],
  "risks":        [{ "id": "K001", "likelihood": 4, "impact": 4, "mitigation": "…" }],
  "dependencies": [{ "agent_id": "financial_projections", "relationship": "informs" }],
  "sources":      [{ "id": "S006", "type": "primary_regulator", "publisher": "GSTN" }],
  "confidence":   { "overall": 0.55, "basis": "…" }
}
```

### Why structured output replaced "900 lines of markdown"

v1 asked each agent for 700–1000 lines with a 3,500–4,500 token budget — about **4.4 tokens per line**. Dense markdown runs 10–25 tokens per line, so every agent was mathematically guaranteed to hit `max_tokens` and truncate mid-sentence. `examples/plant-based-protein-SAMPLE.md` is the surviving evidence: it ends mid-table.

Line counts are gone. Completeness is `coverage.required_sections_present`; honesty is `coverage.unanswered_questions`.

---

## 5 · Connecting n8n

### Credentials

1. **Anthropic** — in n8n create a **Header Auth** credential:
   - Name: `Anthropic x-api-key`
   - Header name: `x-api-key`
   - Header value: your key
2. **GitHub** — a **fine-grained** personal access token:
   - Repository access: **only** this repository
   - Permissions: `Contents: Read and write`, `Pull requests: Read and write`
   - Expiry: 90 days or less

> Never use a classic token with the broad `repo` scope — it grants access to every repository on the account.
> Never paste a key into `N8N_COMPLETE_WORKFLOW.json`. That file is tracked by git. Secrets belong in the n8n credential store or `.env` (git-ignored). Copy [`.env.example`](.env.example) to start.

### Import

1. n8n → Workflows → Import from File → `N8N_COMPLETE_WORKFLOW.json`
2. It imports **inactive** by design. Open each of the 8 agent nodes and select your `Anthropic x-api-key` credential.
3. Test **one** agent before running all eight.

### Feeding the pipeline

The workflow ends at `Handoff to Pipeline`, which emits `agent_outputs`. Write those objects to a directory and run:

```bash
npm run pipeline -- --input my-idea.json --agents ./my-agent-outputs
```

Useful flags:

| Flag | Effect |
|---|---|
| `--input <file>` | Run input JSON (default: `test/fixtures/run-input.json`) |
| `--agents <dir>` | Directory of agent JSON files |
| `--run-dir <dir>` | Output directory (default: `runs/<run_id>`) |
| `--run-id <uuid>` | Pin the run id |
| `--fetch` | Let the evidence layer fetch whitelisted domains (off by default) |
| `--force` | Overwrite an existing run directory |
| `--allow-invalid` | Continue past a failing agent (diagnostics only) |

---

## 6 · Publishing safely

Dry run by default. To publish for real:

```bash
export PUBLISH_ENABLED=1
export GITHUB_TOKEN=github_pat_…
export GITHUB_REPO=ghabilaadithyaa624/india-launch-playbook
npm run pipeline -- --agents ./my-agent-outputs
```

What it does — and refuses to do:

- ✅ Writes **only** under `runs/`. Any other path aborts the publish.
- ✅ Creates branch `run/<run_id>` and opens a **pull request**.
- ✅ One atomic commit via the Git Trees API (no per-file `sha` races).
- ❌ Never commits to `main`.
- ❌ Never touches `README.md`, `docs/**`, `templates/**`, `worksheets/**`, `reference/**`.

The v1 node did `POST /contents/docs` with an empty body on the default branch: wrong verb, directory URL, no base64, no `sha`, no review. It could not work, and had it worked it would have overwritten the handbook.

---

## 7 · Prompt-injection posture

Retrieved pages and operator-uploaded documents are **untrusted data**. Because agent output eventually drives a git write, `src/lib/sanitize.mjs`:

1. strips control characters,
2. neutralises code fences that could break out of a delimiter,
3. redacts instruction-injection patterns (`ignore previous instructions`, `reveal your system prompt`, forged `system:` turns, credential-shaped strings),
4. caps length,
5. wraps content in a **nonce-delimited** `<untrusted-source>` envelope so injected text cannot forge the closing tag.

Agent system prompts state that text inside those blocks is data and must never be obeyed. The model is also never allowed to choose file paths, branches or commit messages — the publisher decides those.

---

## 8 · Reproducibility

Every run writes `manifest.json` recording `run_id`, `input_digest`, model id, `prompt_sha256` per agent, and a sha256 for each rendered file.

Set `SOURCE_DATE_EPOCH` to pin timestamps and the same input produces **byte-identical** output. CI asserts this on every push.

```bash
SOURCE_DATE_EPOCH=1757836800 npm run pipeline -- \
  --run-id 11111111-2222-4333-8444-555555555555 --run-dir runs/a --force
```

---

## 9 · Status

| Layer | State |
|---|---|
| Output contract + trust rules | ✅ Implemented, 22 tests |
| Evidence layer (whitelist, offline + opt-in fetch) | ✅ Implemented |
| Input validation | ✅ Implemented |
| Synthesis + contradiction detection | ✅ Implemented |
| Deterministic rendering | ✅ Implemented, reproducibility CI-verified |
| Guarded GitHub publishing | ✅ Implemented (dry-run default) |
| n8n workflow | ✅ Repaired — imports connected and inactive; **needs your credentials** |
| Live agent run | 🟡 Requires an Anthropic key — untested against the live API |
| PDF / ZIP export | 🔴 Not built (deliberately deferred) |
| Dashboard UI | 🔴 Not built (deliberately deferred) |

### Suggested next steps

1. Add your Anthropic credential and run **one** agent (`market_research`) end to end.
2. Compare the returned JSON against the schema with `npm run validate:agent -- <file>`.
3. Enable the remaining seven once one passes cleanly.
4. Only then set `PUBLISH_ENABLED=1`.
