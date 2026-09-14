# Assumption register

**Run:** `f4f55222-7b89-45c0-bee1-20830875d076` · **Generated:** 2026-09-14T09:10:27.949Z

Every belief this playbook rests on, deduplicated across agents and ranked
by what breaks if it is wrong. Validate the CRITICAL rows first.

| Impact | Assumption | How to validate | Asserted by |
|---|---|---|---|
| **CRITICAL** | Roughly 12% of manufacturing SMEs in the four target cities are actively seeking to replace spreadsheet-based GST workflows within 18 months. | Run 30 structured discovery interviews across the four cities and measure stated intent plus current tooling. | market_research:A001, financial_projections:A001 |
| **HIGH** | The product will process personal data of client employees and vendor contacts, bringing it within scope of the DPDP regime. | Complete the data inventory worksheet and have counsel confirm scope against the shipped schema. | regulatory_compliance:A001 |
| **HIGH** | Monthly logo churn stabilises at or below 3% after the first 90 days of onboarding. | Measure cohort retention monthly from first paying cohort; revisit the model at 6 months. | financial_projections:A002 |
| **MEDIUM** | Finance managers, not owner-operators, are the primary economic buyer in firms above 50 employees. | Record the decision-maker role in every sales conversation for the first 40 deals. | market_research:A002 |

## Rationale detail

### Roughly 12% of manufacturing SMEs in the four target cities are actively seeking to replace spreadsheet-based GST workflows within 18 months.

- **Impact if wrong:** critical
- **Rationale:** Derived from observed replacement cycles in adjacent compliance-software categories; no primary survey has been conducted for this segment.
- **Validation:** Run 30 structured discovery interviews across the four cities and measure stated intent plus current tooling.
- **Asserted by:** market_research:A001, financial_projections:A001

### The product will process personal data of client employees and vendor contacts, bringing it within scope of the DPDP regime.

- **Impact if wrong:** high
- **Rationale:** Invoicing and reconciliation workflows normally carry named contact details; not yet confirmed against the final data model.
- **Validation:** Complete the data inventory worksheet and have counsel confirm scope against the shipped schema.
- **Asserted by:** regulatory_compliance:A001

### Monthly logo churn stabilises at or below 3% after the first 90 days of onboarding.

- **Impact if wrong:** high
- **Rationale:** Compliance tooling is sticky once filing history accumulates, but this segment has no observed retention data yet.
- **Validation:** Measure cohort retention monthly from first paying cohort; revisit the model at 6 months.
- **Asserted by:** financial_projections:A002

### Finance managers, not owner-operators, are the primary economic buyer in firms above 50 employees.

- **Impact if wrong:** medium
- **Rationale:** Larger firms typically delegate compliance tooling decisions; unverified for this segment.
- **Validation:** Record the decision-maker role in every sales conversation for the first 40 deals.
- **Asserted by:** market_research:A002
