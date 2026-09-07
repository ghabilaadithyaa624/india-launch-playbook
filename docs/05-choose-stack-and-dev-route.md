# 05 · Choose a stack and development route

Technology should serve the team you can realistically hire and maintain. Pick boring, supported tools for the core transaction path.

| Route | Best for | Watch-outs |
|---|---|---|
| No-code / low-code | Validation, internal operations, simple marketing | Limits on custom workflows, portability and cost at scale |
| CMS / template | Content, brochure, simple shops | Plugin quality, performance, update discipline |
| Managed full-stack | Small teams shipping web apps quickly | Vendor limits, review security and data export |
| Custom full-stack | Differentiated workflow or complex product | Needs tests, monitoring, ownership and runway |
| Agency / freelancer | Bounded scope with strong brief | Acceptance criteria, access ownership, handover |
| In-house team | Core product with ongoing iteration | Hiring, leadership, operating cost |

## A sensible modern default

For a web application, a common fit is a TypeScript front end, a server/API layer, PostgreSQL, object storage, managed authentication or a carefully built auth layer, automated deployments and error monitoring. Prefer one deployment platform and a managed database at first. Add queues, caches, realtime infrastructure and microservices only when measurements show a need.

> **Decision filter**
> Choose tools that have: a clear owner, current support, an exit path, predictable billing, sensible observability, secure defaults and enough India-relevant payment / messaging / tax integrations for your workflow.
