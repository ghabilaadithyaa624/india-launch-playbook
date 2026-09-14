# India Launch Playbook

This repository contains **two related things**. Read this section before anything else.

| # | What | Status | Start at |
|---|---|---|---|
| **1** | **A human-written India launch handbook** — decision guide for launching a website or digital product in India. | ✅ **Complete and usable today.** | [`docs/00-start-here.md`](docs/00-start-here.md) |
| **2** | **An evidence-gated multi-agent generator** — turns a business idea into a sourced India launch playbook. | 🟡 **Pipeline works end to end. The n8n agent layer needs your API credentials.** | [`PIPELINE.md`](PIPELINE.md) |

> **Not legal, tax, security, financial or engineering advice.** Rules, provider pricing and timelines change. Confirm your plan with qualified Indian counsel, a chartered accountant, your payment provider and a security professional before launch.

---

## 1 · The handbook (human-written, stable)

Plan, build, protect and launch a customer-ready website or platform in India — without the usual expensive blind spots.

- Read `docs/01` through `docs/06` before choosing a build approach.
- Work through `docs/07` – `docs/11` (compliance, payments, budget, launch gates) while you build.
- Copy the files in [`templates/`](templates/) to brief a developer or agency.
- Fill in the files in [`worksheets/`](worksheets/) as living planning documents.
- For a marketplace, payments, health, finance, location tracking or children's data, treat the compliance docs as a conversation starter — not a substitute for advice.

| # | Section | File |
|---|---------|------|
| — | Start here | [`docs/00-start-here.md`](docs/00-start-here.md) |
| 01 | Choose the right website model | [`docs/01-choose-website-model.md`](docs/01-choose-website-model.md) |
| 02 | Define the offer and scope | [`docs/02-define-offer-and-scope.md`](docs/02-define-offer-and-scope.md) |
| 03 | Create the core product documents | [`docs/03-core-product-documents.md`](docs/03-core-product-documents.md) |
| 04 | Design a usable customer journey | [`docs/04-design-customer-journey.md`](docs/04-design-customer-journey.md) |
| 05 | Choose a stack and development route | [`docs/05-choose-stack-and-dev-route.md`](docs/05-choose-stack-and-dev-route.md) |
| 06 | Build securely and operate reliably | [`docs/06-build-securely-operate-reliably.md`](docs/06-build-securely-operate-reliably.md) |
| 07 | Security, privacy and trust | [`docs/07-security-privacy-trust.md`](docs/07-security-privacy-trust.md) |
| 08 | India launch readiness | [`docs/08-india-launch-readiness.md`](docs/08-india-launch-readiness.md) |
| 09 | Payments, messaging and support | [`docs/09-payments-messaging-support.md`](docs/09-payments-messaging-support.md) |
| 10 | Budget and timeline | [`docs/10-budget-and-timeline.md`](docs/10-budget-and-timeline.md) |
| 11 | Launch gates | [`docs/11-launch-gates.md`](docs/11-launch-gates.md) |

**Supporting material:** [`templates/`](templates/) · [`worksheets/`](worksheets/) · [`reference/primary-source-reference-shelf.md`](reference/primary-source-reference-shelf.md)

---

## 2 · The generator (AI, evidence-gated)

Eight specialist agents analyse a business idea, then a deterministic pipeline validates, reconciles, renders and publishes the result.

```
business idea
     ↓
validate input
     ↓
source pack        ← only whitelisted Indian primary sources may be cited
     ↓
8 agents in parallel  → structured JSON (not prose)
     ↓
validate each      ← a fact with no real source is REJECTED
     ↓
synthesis          ← cross-agent contradiction detection
     ↓
render             ← deterministic; facts / assumptions / estimates kept separate
     ↓
publish            ← writes only to runs/, always via a pull request
```

### Try it now — no API key needed

```bash
npm install
npm run demo
```

This runs the whole pipeline against bundled fixtures and writes to `runs/demo/`. Open [`runs/demo/MASTER-PLAYBOOK.md`](runs/demo/MASTER-PLAYBOOK.md).

The demo intentionally contains a **planted contradiction** (two agents disagree on revenue per account) so you can see the contradiction checker fire and the confidence score drop.

```bash
npm test              # 22 contract + trust + security tests
npm run lint:docs     # statute errors, broken links, secret scan
```

### What makes the output trustworthy

| Guarantee | How it is enforced |
|---|---|
| No invented sources | `facts[]` require a `source_id` resolving to a real entry in the source pack. Model-recall-only claims are **rejected** by the validator, not by prompt wording. |
| Assumptions can't masquerade as facts | Separate schema arrays, separately rendered, each with impact-if-wrong and a validation method. |
| No false precision | `estimates[]` require `low` / `base` / `high`. Point predictions are schema-invalid. |
| Contradictions surface | Deterministic cross-agent checks for disjoint ranges, divergent fact values and missing dependencies. |
| Regulated advice gets a human | Any recommendation touching tax, privacy, licensing or payments must set `requires_professional_review`. |
| Reproducible | Every run records `input_digest`, model id and `prompt_sha256`. Identical input ⇒ byte-identical output (CI-verified). |
| Safe writes | Publishing is path-guarded to `runs/`, branches, and opens a PR. It can never overwrite the handbook. |

Full setup, the n8n workflow and the JSON contract: **[`PIPELINE.md`](PIPELINE.md)**

---

## Repository layout

```
docs/            handbook, sections 00-11 (human-written, never auto-modified)
templates/       copy-paste briefs for a developer or agency
worksheets/      fillable planning tables
reference/       Indian primary-source reference shelf
schemas/         JSON contracts: agent output, run input
config/          source whitelist (what agents may cite)
src/lib/         validation, evidence, synthesis, render, publish, sanitise
src/cli/         pipeline and utilities
test/            contract, trust, security and reproducibility tests
examples/        illustrative sample output (clearly marked, not guidance)
runs/            generated output (git-ignored except the committed demo)
```

## Reader promise

By the end of the handbook, you should know what to build first, what to postpone, who you need, where the cost comes from and what evidence to collect before taking real customer data or payments.

---
*Handbook content: India Website & Digital Product Launch Playbook, Version 1.0, September 2026.*
