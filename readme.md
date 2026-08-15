# Retail Omni-Channel Customer Loyalty & Rewards

SAP BTP CAP (Node.js) + Fiori UI5 application that unifies online and in-store
(POS) purchases, computes loyalty points dynamically per channel policy, and
handles redemptions with a guaranteed-never-negative balance. Problem statement:
[`txt.md`](txt.md).

## Roles (per txt.md)

| Role | Capability in this app |
|---|---|
| **Customer** | Points balance, tier, purchase history, redemption history; redeem points; register own purchases (with optional points part-payment); self-onboards on first login |
| **Retail Staff** | Find customer by email (identity only), record POS/Online purchases, onboard customers; daily KPI tiles incl. *Purchases today* |
| **Admin** | Reward policies (₹1 = X points, per channel), tier thresholds, gated customer-360 lookup, program KPIs incl. *Outstanding points* (open liability) |

## Architecture

```
Fiori UIs (app/)                      CAP service (srv/)                 Persistence (db/)
├─ loyalty-dashboard  (custom)  ──►   LoyaltyService /odata/v4/loyalty   SQLite (dev/test, in-memory)
├─ customers-management       │       • points engine (channel policy)   SAP HANA Cloud HDI (prod)
├─ transactions-management    │       • redemption + part-payment       via @cap-js/hana
├─ reward-policies            │       • atomic guarded balance UPDATES
└─ tier-thresholds-management ┘       • role guards (@restrict + handlers)
```

- **Domain model** — spec-conformance mapping: [docs/data-model.md](docs/data-model.md)
- **Business rules** — `srv/handlers/` (transaction, redemption, policy); policy rates cached,
  tier recompute on threshold change, `pointValueInr` (₹0.50/point) exposed via `getUserInfo()`.
- **Security** — `@restrict` matrix per entity/role; ownership guards for customer self-service;
  XSUAA in production (`xs-security.json`), basic-auth mock users in dev/test.
- **Change tracking** — `@cap-js/change-tracking` on balance, tier, policies, thresholds.

## Run locally

```bash
npm install
npm run watch        # cds watch; login as alice (customer) / bob (staff) / carol (admin), password "pass"
```

Dashboard: `http://localhost:4004/loyaltydashboard/index.html` — the browser will prompt
for basic-auth credentials. Data lives in memory (CSV-seeded); restart resets it.

## Test

```bash
npm test             # 12 cases: points math, part-payment, validation, tier transitions,
                     # concurrency guard, role guards — node --test + @cap-js/cds-test
```

Test case sheet (incl. manual UI cases): [docs/test-cases.md](docs/test-cases.md).

## Deploy to SAP BTP Cloud Foundry (SAP HANA Cloud)

```bash
npm run build && npm run deploy
```

Full flow, MTA modules, and verification steps: [docs/deployment.md](docs/deployment.md).

## Project docs

| Document | Content |
|---|---|
| [docs/project-overview.md](docs/project-overview.md) | Project Overview — objective, flow, role-by-role showcase with screenshots, sprint log, deliverables map |
| [docs/sprint-plan.md](docs/sprint-plan.md) | Agile delivery plan, user stories, acceptance criteria, HANA tasks |
| [docs/test-cases.md](docs/test-cases.md) | Test Case Sheet |
| [docs/deployment.md](docs/deployment.md) | Deployment Steps (BTP CF + HANA Cloud) |
| [docs/build-code-prompts.md](docs/build-code-prompts.md) | Build Code (Joule) prompt log — assignment deliverable |
| [docs/commands-reference.md](docs/commands-reference.md) | Commands used + real sample outputs (dev, test, build, deploy) |
| [docs/crud-test-results.md](docs/crud-test-results.md) | Executed CRUD matrix — 38/38 cases with actual responses |
