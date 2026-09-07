# 07 · Security, privacy and trust

Security is not a badge at the end. It is a set of choices about what data exists, who can access it and how quickly you can contain a failure.

## Practical baseline

| Area | Baseline control |
|---|---|
| Data minimisation | Collect only what the product needs; document purpose before collecting. |
| Access | Role-based permissions, MFA, staff offboarding and periodic access review. |
| Transport / storage | TLS in transit; encryption and tested access controls at rest where supported. |
| Application | Input validation, parameterised queries, output encoding, rate limits and secure session handling. |
| Suppliers | Document providers, data shared, contract terms, incident contacts and exit route. |
| Incident response | Named owner, severity guide, contact list, evidence preservation and rehearsal. |
| Independent review | Risk-proportionate security test before production; remediate verified findings. |

> **Privacy by design**
> Create a data inventory: for each field, record source, purpose, retention period, system location, people / vendors with access and deletion method. This one worksheet makes legal review, engineering work and customer communication dramatically easier.
>
> A fillable copy lives in [`worksheets/data-inventory.md`](../worksheets/data-inventory.md).
