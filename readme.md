# Retail Omni-Channel Customer Loyalty & Rewards

![SAP CAP](https://img.shields.io/badge/SAP-CAP%20(Node.js)-0a6ed1)
![UI5](https://img.shields.io/badge/Fiori-UI5%20OData%20v4-0a6ed1)
![HANA](https://img.shields.io/badge/DB-HANA%20Cloud%20%7C%20SQLite%20(dev)-0f8b8d)
![BTP](https://img.shields.io/badge/SAP%20BTP-Cloud%20Foundry%20%C2%B7%20XSUAA-4a4a4a)
![Tests](https://img.shields.io/badge/tests-12%2F12%20pass-brightgreen)

SAP BTP CAP (Node.js) + Fiori UI5 application that unifies online and in-store
(POS) purchases, computes loyalty points dynamically per channel policy, and
handles redemptions with a guaranteed-never-negative balance. Problem statement:
[`txt.md`](txt.md). Full write-up: [docs/capstone-report.md](docs/capstone-report.md).

## Prerequisites

| Tool | Version / note |
|---|---|
| Node.js | ≥ 20 (workspaces root install covers everything) |
| SAP CDS CLI | optional locally — `npm run watch` uses the project's `@sap/cds`; needed only for `cds add`-style work |
| SAP BTP | trial subaccount with Cloud Foundry; entitlements: SAP HANA Cloud, XSUAA, HTML5 App Repository, Destination (production only) |
| CF CLI + MBT | for deployment (`npm run build` / `npm run deploy` wrap them) |

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

## Project structure

```
db/          schema.cds (5 entities) + CSV seeds (1 customer, 2 policies, 3 thresholds)
srv/         service.cds (@restrict matrix) · service.js · handlers/ (transaction, redemption, policy) · lib/ (policy-cache, tier, point-value, ownership, channels)
app/         loyalty-dashboard (freestyle) · 4 generated admin apps · api-test-harness · router
test/        loyalty.test.js — 12 automated cases
mta.yaml     MTA: srv, db-deployer, approuter, app-deployer, 6 html5 modules + XSUAA/HANA/html5-repo/destination resources
docs/        capstone-report.md (the report) + supporting docs + screenshots + rendered diagrams
```

## Test

```bash
npm test             # 12 cases: points math, part-payment, validation, tier transitions,
                     # concurrency guard, role guards — node --test + @cap-js/cds-test
```

Test case sheet (incl. manual UI cases): [docs/test-cases.md](docs/test-cases.md).

The interactive CRUD matrix (38 cases, also runnable in Postman/curl — standard OData v4, writes need an `x-csrf-token`): deployed at `/apitestharness/index.html`, executed results in [docs/crud-test-results.md](docs/crud-test-results.md).

## Deploy to SAP BTP Cloud Foundry (SAP HANA Cloud)

```bash
npm run build && npm run deploy
```

Full flow, MTA modules, and verification steps: [docs/deployment.md](docs/deployment.md).

## Known limitations

- Dev/test data is in-memory SQLite — every `cds watch` restart re-seeds from CSVs.
- Single currency (₹) and a single complete i18n bundle; no per-locale files yet.
- No points expiry, campaign engine, or scheduled jobs (future work, see report §9.4).
- RewardPolicies PATCH/DELETE key on `policyID` (surrogate), not `channel`.

## Project docs

| Document | Content |
|---|---|
| [docs/capstone-report.md](docs/capstone-report.md) | **The capstone report** — overview, data model, service logic, sprints, executed tests, deployment, showcase, Build Code prompts, conclusions |
| [docs/submission-document.md](docs/submission-document.md) | Full submission content: overview, architecture, data model, logic, sprints, testing, deployment, prompts, role-by-role showcase, with screenshot capture list |
| [docs/flow-diagram.md](docs/flow-diagram.md) | High-level flow diagram (Mermaid): login → role → purchase engine → guarded update |
| [docs/er-diagram.md](docs/er-diagram.md) | Data model / ER diagram (Mermaid) with attribute-level notes |
| [docs/sprint-plan.md](docs/sprint-plan.md) | Agile delivery plan, user stories, acceptance criteria, HANA tasks |
| [docs/test-cases.md](docs/test-cases.md) | Test Case Sheet |
| [docs/deployment.md](docs/deployment.md) | Deployment Steps (BTP CF + HANA Cloud) |
| [docs/build-code-prompts.md](docs/build-code-prompts.md) | Build Code (Joule) prompt log — assignment deliverable |
| [docs/commands-reference.md](docs/commands-reference.md) | Commands used + real sample outputs (dev, test, build, deploy) |
| [docs/crud-test-results.md](docs/crud-test-results.md) | Executed CRUD matrix — 38/38 cases with actual responses |
