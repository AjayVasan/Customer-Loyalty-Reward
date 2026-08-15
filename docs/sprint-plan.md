# Agile Sprint Plan

Retail Omni-Channel Customer Loyalty & Rewards Management — SAP BTP CAPM + UI5, 5-day delivery.

## Sprint 1 — Foundation (data model, service, mock data)

| User story | Acceptance criteria |
|---|---|
| As an admin I define the domain model so purchases and redemptions can be recorded | `db/schema.cds` contains Customer, Transaction, Redemption (+ RewardPolicy, TierThreshold extension); see [data-model.md](data-model.md) |
| As a developer I expose the model as an OData V4 service | `srv/service.cds` serves `/odata/v4/loyalty`; `$metadata` lists all entities |
| As a developer I have seed data for local runs | CSV seeds load: 1 customer, 2 channel policies, 3 tier thresholds |
| As an operator the API is role-protected | Service requires `authenticated-user`; `@restrict` grants per role (admin/staff/customer) |

## Sprint 2 — Business logic (points engine, redemption)

| User story | Acceptance criteria |
|---|---|
| As the system I compute points per channel policy (₹1 = 0.05 online example) | `pointsEarned = floor(amount × rate)`; Online > Store rate promotes digital adoption |
| As a customer I can pay partly with points | `amount = price − pointsApplied × ₹0.50`; a Redemption row is written for applied points |
| As the system I prevent over-redemption | Redemption with `pointsUsed > totalPoints` → 400; balance never negative — enforced by an atomic guarded UPDATE (HANA row-lock safe) |
| As a customer my tier reflects my lifetime earning | Tier derived from `lifetimePoints`; re-derived for ALL customers when an admin changes thresholds |
| As a developer I can prove all of the above | `npm test` — 12 automated cases green ([test-cases.md](test-cases.md)) |

## Sprint 3 — Fiori dashboards (customer, staff, admin)

| User story | Acceptance criteria |
|---|---|
| As a customer I view my points, tier, purchase & redemption history | "My Account" tab: balance, tier, lifetime points, both histories, self-registration on first login |
| As a customer I redeem points and register my own purchases | Redeem form + purchase form with live earn-rate preview (server-provided point value) |
| As retail staff I record POS/Online purchases for a customer | Email lookup (identity only — no purchase history exposed), purchase form, new-customer onboarding |
| As staff I see my daily workload at a glance | KPI tiles: Customers, Purchases, **Purchases today**, Points issued (total/Online/Store) |
| As an admin I govern the program | Policies + tier thresholds editable; gated customer 360 lookup; KPI tiles: Customers, Points issued per channel, Points redeemed, Purchases, **Outstanding points** (open liability) |
| As any user the UI is fully internationalized | Single `i18n.properties` bundle; no hardcoded strings; zero missing keys |

## Sprint 4 — Hardening & deployment on SAP BTP (HANA Cloud)

| User story | Acceptance criteria |
|---|---|
| As an operator the app runs on BTP Cloud Foundry against **SAP HANA Cloud** | `mbt build` → `cf deploy`; HDI container `loyalty-rewards-db` holds the deployed schema; XSUAA replaces mock auth ([deployment.md](deployment.md)) |
| As an operator point mutations are safe under production concurrency | Atomic guarded balance UPDATEs verified by the concurrency test — exactly one of two parallel full-balance redemptions succeeds |
| As a developer role separation works end-to-end | `kind: basic` mock users (alice/bob/carol) exercise the real `@restrict` matrix in tests — no silent privileged fallback |
| As a team the repo stays clean | Build artifacts, dev databases and deploy logs untracked; `npm test` is the CI gate |

## HANA usage summary

- **Runtime database in production**: SAP HANA Cloud through `@cap-js/hana` (profile `[production]`), provisioned as HDI shared/no-shared container in `mta.yaml`.
- **Schema deployment**: `cds build --for hana` emits design-time artifacts; `loyalty-rewards-db-deployer` pushes them on `cf deploy`.
- **Correctness under HANA**: balance mutations rely on single-statement guarded UPDATEs (row locks + re-evaluated predicates under read-committed isolation), not read-modify-write sequences.
- **Dev/test**: in-memory SQLite keeps local runs disposable; the same CQN runs on both databases.
