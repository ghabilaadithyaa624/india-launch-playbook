# 06 · Build securely and operate reliably

A launch is the start of operations. The website must have a safe path for updates, incidents and customer support.

## Build sequence

| Order | Deliverable | Why it comes now |
|---|---|---|
| 1 | Repository, environments, access policy | Avoid shared passwords and mystery deployments |
| 2 | Data model and core user flow | Makes scope concrete before building screens |
| 3 | Design components and content | Keeps the UI consistent and editable |
| 4 | Authentication and permissions | Protects customer and admin actions |
| 5 | Core flow + error states | Delivers value and makes failure recoverable |
| 6 | Payments / messaging / integrations | Connect after the internal workflow works |
| 7 | Tests, monitoring, backup / restore drill | Turns a demo into an operable service |
| 8 | Staging review and production release | Controls risk of customer impact |

## Non-negotiable engineering habits

- Separate development, staging and production. Never use production customer data as sample data.
- Keep secrets out of source control. Use a secret manager or environment configuration with least-privilege access.
- Use multi-factor authentication for source control, hosting, domain registrar and payment accounts.
- Log meaningful security and business events without leaking sensitive values. Test backups and restoration.
- Review third-party packages and update critical fixes. Protect admin functions with roles and audit trails.
