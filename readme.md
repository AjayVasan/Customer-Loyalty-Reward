# Retail Customer Loyalty & Rewards — Project Guide

![SAP CAP](https://img.shields.io/badge/SAP-CAP%20(Node.js)-0a6ed1)
![UI5](https://img.shields.io/badge/Fiori-UI5%20OData%20v4-0a6ed1)
![HANA](https://img.shields.io/badge/DB-HANA%20Cloud%20%7C%20SQLite%20(dev)-0f8b8d)
![BTP](https://img.shields.io/badge/SAP%20BTP-Cloud%20Foundry%20%C2%B7%20XSUAA-4a4a4a)
![Tests](https://img.shields.io/badge/tests-12%2F12%20pass-brightgreen)

This repository is a **SAP BTP CAP (Node.js) + Fiori UI5** application that implements the
*Retail Industry — Omni-Channel Customer Loyalty & Rewards Management* capstone
(problem statement: `txt.md`, not tracked in this repo). It unifies online and in-store (POS) purchases
into one loyalty program: one customer record, one points balance, channel-specific earn
rates that an admin can change at runtime, and redemptions that are validated so a balance
**can never go below zero**.

This README is the **project guide**: what was asked, what was built, where everything
lives, and how to run, use, test, and deploy it. Deep-dive documents live in
[`docs/`](docs/) (see [§13 Documentation map](#13-documentation-map)).

**Quick orientation**

| I want to… | Go to |
|---|---|
| Run it locally in 2 commands | [§6 Getting started](#6-getting-started) |
| Click through the UI as customer / staff / admin | [§7 Using the app, role by role](#7-using-the-app-role-by-role) |
| Call the OData API with curl / Postman | [§8 Using the API directly](#8-using-the-api-directly) |
| Understand the business rules in the code | [§4 Business rules](#4-business-rules-handler-logic) |
| Change a policy, a rate, a role, a validation | [§9 Codebase tour](#9-codebase-tour) |
| Run the automated tests | [§10 Testing](#10-testing) |
| Deploy to SAP BTP Cloud Foundry + HANA Cloud | [§11 Deployment](#11-deployment) |
| See how each assignment deliverable is satisfied | [§12 Deliverables traceability](#12-deliverables-traceability) |

---

## 1. The assignment (`txt.md`)

The problem statement (5-day capstone, topics: SAP BTP CAPM + UI5) asks for a system that
tracks purchases from all channels, dynamically assigns loyalty points, and handles
redemptions ensuring points don't go below zero. Its key-feature matrix:

| Role | Functionality (per `txt.md`) | Where this project delivers it |
|---|---|---|
| **Customer** | View points, redeem for discounts, track purchase history | `loyaltydashboard` "My Account" tab ([§7.1](#71-customer--my-account)) |
| **Retail Staff** | Record new purchases (POS or Online) | `loyaltydashboard` "Staff Operations" tab ([§7.2](#72-retail-staff--staff-operations)) |
| **Admin** | Define and modify reward policies (e.g. ₹1 = 0.05 points) | `loyaltydashboard` "Admin Console" + `reward-policies` app ([§7.3](#73-admin--admin-console)) |

`txt.md` also specifies the three core entities (Customer, Transaction, Redemption), three
handler behaviours (channel-based point computation, sufficient-balance validation,
post-redemption deduction), an agile sprint plan, and six deliverables — the full
conformance mapping is [§12 Deliverables traceability](#12-deliverables-traceability),
and the attribute-by-attribute entity check is [`docs/data-model.md`](docs/data-model.md).

---

## 2. Solution overview

**One CAP service, five entities, three roles, six UI modules, one MTA.**

```
Fiori UIs (app/)                      CAP service (srv/)                 Persistence (db/)
├─ loyalty-dashboard  (custom)  ──►   LoyaltyService /odata/v4/loyalty   SQLite (dev/test, in-memory)
├─ customers-management       │       • points engine (channel policy)   SAP HANA Cloud HDI (prod)
├─ transactions-management    │       • redemption + part-payment       via @cap-js/hana
├─ reward-policies            │       • atomic guarded balance UPDATES
├─ tier-thresholds-management │       • role guards (@restrict + handlers)
├─ api-test-harness           │       • getUserInfo() identity/role import
└─ router (approuter)         ┘       • policy write-through cache
```

| Layer | Technology | Where |
|---|---|---|
| Domain model | CAP CDS | `db/schema.cds` (5 entities) + CSV seeds in `db/data/` |
| Service | CAP Node.js, OData v4 | `srv/service.cds`, `srv/service.js`, `srv/handlers/`, `srv/lib/` |
| UI | Fiori UI5 (freestyle dashboard + 4 generated admin apps) | `app/` |
| Auth | Basic mock users (dev/test) · XSUAA role collections (prod) | `package.json` cds config · `xs-security.json` |
| Database | SQLite in-memory (dev/test) · SAP HANA Cloud HDI (prod) | profile-driven in `package.json` |
| Platform | SAP BTP Cloud Foundry, MTA | `mta.yaml` |
| Tests | `node --test` + `@cap-js/cds-test` | `test/loyalty.test.js` |

- High-level flow (login → role → purchase engine → guarded update):
  [`docs/flow-diagram.md`](docs/flow-diagram.md)
- Handler sequence: `docs/handler-sequence.png`
- ER diagram: [`docs/er-diagram.md`](docs/er-diagram.md)

---

## 3. Domain model

Source of truth: [`db/schema.cds`](db/schema.cds), namespace `loyalty`. Every attribute
specified in `txt.md` is present with its specified type; additions exist only where a
requirement forced them (full table: [`docs/data-model.md`](docs/data-model.md)).

| Entity | Key | Purpose | Notable fields |
|---|---|---|---|
| `Customer` | `customerID : UUID` | Program member | `totalPoints` (spendable balance), `lifetimePoints` (never-decreasing earn counter), `tier` |
| `Transaction` | `txnID : UUID` | One purchase (Online/Store) | `price` (list price), `pointsApplied` (part-payment), `amount` (cash payable — **derived**), `pointsEarned` (**server-computed**) |
| `Redemption` | `redeemID : UUID` | Points converted to value | `pointsUsed`, `remarks`; also written automatically for part-payments |
| `RewardPolicy` | `policyID : UUID` | Admin-defined earn rate per channel (`channel` unique) | `pointsPerCurrencyUnit` |
| `TierThreshold` | `tier : String` | Admin-defined tier promotion rules | `minLifetimePoints` |

**Why `lifetimePoints` exists:** `totalPoints` drops on redemption and must never demote a
tier; tiers therefore derive from lifetime earning.

**Seed data** (`db/data/*.csv`, re-applied on every dev/test restart): one customer
(Alice Johnson, `alice@example.com`, Bronze, 0 points); policies **Online ₹1 = 0.05 pts,
Store ₹1 = 0.03 pts** (online earns more — the `txt.md` business reason to promote digital
adoption); tiers **Bronze 0 / Silver 5,000 / Gold 20,000** lifetime points. Each reward
point is worth **₹0.50** cash (`srv/lib/point-value.js` — single source of truth, served
to UIs via `getUserInfo().pointValueInr`).

---

## 4. Business rules (handler logic)

`txt.md` names three handler behaviours; each maps to enforced server-side code:

| `txt.md` requirement | Implementation | File |
|---|---|---|
| Automatically calculate points per channel (reward online more) | `pointsEarned = floor(amount × rate(channel))`, rates from an in-memory **write-through cache** — policy edits apply to future purchases with no restart | `srv/handlers/transaction.js`, `srv/lib/policy-cache.js` |
| Validate the user has enough points | Friendly pre-checks (400 with the offending field as target) **plus** the correctness backstop below | `srv/handlers/redemption.js`, `srv/handlers/transaction.js` |
| Deduct points post successful redemption | Balance mutation is a **single atomic guarded UPDATE** — `totalPoints = totalPoints − used + earned … WHERE totalPoints >= used` — computed by the database, not Node. The loser of a concurrent race matches zero rows and gets a clean 400. A balance can never go negative. | both handlers |

Additional rules the implementation enforces (all pinned by tests, see [§10](#10-testing)):

- **Part-payment** — a purchase may apply points at checkout: `amount = price − pointsApplied × ₹0.50`.
  Prices are floored to the ₹0.50 grid; applied points also write a matching `Redemption`
  row so part-payments and standalone redemptions share one audit trail.
- **Tier engine** — tier is re-derived from `lifetimePoints` on every earn **and** on every
  `TierThresholds` change (admin edit re-tiers all customers in one request).
- **Ownership guard first** — a customer acting on a foreign account gets **403 before any
  validation**, so error messages never leak account existence.
- **Onboarding validation** — `name` required, email pattern-checked, one account per email
  (409 on duplicates), customers may only register **their own** login email (403 otherwise).
- **Change tracking** — `@cap-js/change-tracking` on balance, tier, policies, thresholds.

---

## 5. Security model

Roles come from `@restrict` annotations in [`srv/service.cds`](srv/service.cds) (plus
handler-level guards where `$user` filters can't apply, e.g. CREATE):

| Entity | Customer | Staff | Admin |
|---|---|---|---|
| `Customers` | read/create **own row only** (`where email = $user.email`) | read all, create (onboard) | read all, create |
| `Transactions` | read own, create **for self only** (ownership guard) | read all, create | read all, create |
| `Redemptions` | read own, create own | — (part-payment rows are written internally) | read all, create |
| `RewardPolicies` | — | read | full CRUD |
| `TierThresholds` | — | — | full CRUD |

`getUserInfo()` (function import) answers "who am I and what are the rules" in one call —
identity, `isAdmin`/`isStaff`/`isCustomer` flags, and `pointValueInr` — so the dashboard
routes to the right tab and no UI hardcodes the point value. Dev/test use basic-auth mock
users; production swaps in XSUAA (`xs-security.json`, role collections `admin`/`staff`/`customer`)
with no code change.

---

## 6. Getting started

**Prerequisites:** Node.js ≥ 20; (optional) SAP CDS CLI for `cds add`-style work —
`npm run watch` uses the project's own `@sap/cds`. Deployment additionally needs the
CF CLI + MBT and a BTP subaccount (see [§11](#11-deployment)).

```bash
npm install        # root + app/* workspaces, one shot
npm run watch      # cds watch → http://localhost:4004
```

Log in with the mock users (password `pass` for all):

| User | Role | Email |
|---|---|---|
| `alice` | customer | `alice@example.com` (matches the seeded customer) |
| `bob` | staff | — |
| `carol` | admin | — |

**URLs (basic auth prompt):**

| URL | What |
|---|---|
| `http://localhost:4004/loyaltydashboard/index.html` | **The app** — role-aware dashboard |
| `http://localhost:4004/apitestharness/index.html` | Interactive CRUD test harness (38 cases) |
| `http://localhost:4004/odata/v4/loyalty` | OData v4 service root (`$metadata`, entity sets) |

The dev database is **in-memory SQLite seeded from CSVs** — every restart resets it, which
makes demos reproducible. Hot reload is on: save a file and the service reloads.

---

## 7. Using the app, role by role

Open the dashboard URL and sign in. The shell calls `getUserInfo()` at startup and opens
on the tab matching your strongest role; a role chip shows who you are.

### 7.1 Customer — "My Account"

- First login **auto-onboards**: no customer row for your email yet → a Bronze, 0-point
  account is created (that's why customer CREATE is restricted to your own email).
- **Register a purchase**: pick channel (Online/Store), enter product price, optionally
  apply points as part-payment. A live hint shows the current earn rate; on submit a toast
  reports points earned and the balance refreshes.
- **Redeem points**: enter points + remarks (reward item / offer) → validated, deducted,
  never below zero.
- Full history: purchases and redemptions, balance, tier, lifetime points.

### 7.2 Retail staff — "Staff Operations"

- **Find customer by email** — returns identity, balance, tier only.
- **Record a purchase** on behalf of that customer (POS `Store` or `Online`), with optional
  points part-payment — same engine, same guarantees.
- **Onboard new customers** (any email).
- Daily KPI tiles, including *Purchases today*.

### 7.3 Admin — "Admin Console"

- Program KPIs: customers, purchases, points issued (per channel), points redeemed,
  **outstanding points** (open liability).
- **Reward policies**: edit points-per-₹1 per channel — changes apply to future purchases
  immediately (write-through cache, no restart).
- **Tier thresholds**: edit `minLifetimePoints` — every customer's tier is re-derived
  in the same request.
- Gated **customer 360** lookup.

### 7.4 The generated admin apps

Four Fiori elements worklist apps ship alongside, also mounted under `cds watch`
(e.g. `http://localhost:4004/customersmanagement/index.html`):

```bash
npm run watch-customers-management          # or:
npm run watch-transactions-management       #   each opens its own UI directly
npm run watch-reward-policies
npm run watch-tier-thresholds-management
```

They expose standard OData v4 CRUD on the five entities (subject to the same role matrix —
sign in as `carol` for policy/threshold editing). `reward-policies` and
`tier-thresholds-management` are the admin's spreadsheet-style editors.

### 7.5 API test harness

`/apitestharness/index.html` — a self-contained page that executes the full CRUD matrix
(38 cases: role grants, ownership, validation, points math) against the running service and
shows expected vs. actual. Executed results: [`docs/crud-test-results.md`](docs/crud-test-results.md).
Deployed next to the app in production too.

---

## 8. Using the API directly

Standard OData v4 at `/odata/v4/loyalty`. Reads need basic auth (dev) or an XSUAA JWT
(prod); **writes need an `x-csrf-token`** fetched with a prior GET.

```bash
U=http://localhost:4004/odata/v4/loyalty

# who am I (the dashboard's startup call)
curl -u alice:pass "$U/getUserInfo()"

# fetch a CSRF token for writes
T=$(curl -s -u carol:pass -H "x-csrf-token: fetch" -o /dev/null -D - "$U/Customers?\$top=1" \
    | grep -i x-csrf | tr -d '\r' | awk '{print $2}')

# record a purchase — points engine computes floor(1000 × 0.05) = 50 pts
curl -X POST -u carol:pass -H "x-csrf-token: $T" -H "Content-Type: application/json" \
  -d '{"customerID_customerID":"<customer-uuid>","channel":"Online","price":1000}' "$U/Transactions"
# → 201 … "amount":1000.00,"pointsEarned":50

# part-payment: ₹500 with 20 pts → payable ₹490, 14 pts earned, auto Redemption row
curl -X POST -u carol:pass -H "x-csrf-token: $T" -H "Content-Type: application/json" \
  -d '{"customerID_customerID":"<uuid>","channel":"Store","price":500,"pointsApplied":20}' "$U/Transactions"

# standalone redemption
curl -X POST -u alice:pass -H "x-csrf-token: $T" -H "Content-Type: application/json" \
  -d '{"customerID_customerID":"<own-uuid>","pointsUsed":10,"remarks":"₹5 off voucher"}' "$U/Redemptions"

# KPI-style aggregate (what the dashboard tiles use)
curl -u carol:pass "$U/Transactions?\$apply=groupby((channel),aggregate(pointsEarned%20with%20sum%20as%20total))"
```

Failure behaviour worth knowing (all by design, field-targeted messages):

| Request | Response |
|---|---|
| anonymous GET | `401` |
| customer acting on a foreign account | `403` (before any validation — no existence leak) |
| redeem/apply more points than the balance | `400 Insufficient points: customer has N, tried to …` |
| more points than the purchase value | `400 Points exceed purchase value: at most N points …` |
| duplicate customer email | `409 An account for <email> already exists` |
| concurrent double-spend (race loser) | `400 … balance changed concurrently, retry` |

More copy-paste calls with real outputs: [`docs/commands-reference.md`](docs/commands-reference.md).

---

## 9. Codebase tour

```
db/
  schema.cds            5 entities (Customer, Transaction, Redemption, RewardPolicy, TierThreshold)
  data/*.csv            seeds: 1 customer, 2 policies, 3 thresholds
srv/
  service.cds           service + @restrict role matrix + changelog annotations
  service.js            handler registration, getUserInfo(), customer-CREATE validation,
                        policy-cache load on 'served'
  handlers/
    transaction.js      points engine: validation, ₹0.50 grid, part-payment, guarded UPDATE
    redemption.js       ownership guard, sufficient-balance checks, guarded UPDATE
    policy.js           write-through cache invalidation, re-tier on threshold change
  lib/
    policy-cache.js     channel→rate + thresholds, in-memory, write-through
    tier.js             computeTier(lifetimePoints, thresholds)
    point-value.js      POINT_VALUE_INR = 0.50 — single source of truth
    ownership.js        assertOwnCustomer — 403 before validation
    channels.js         VALID_CHANNELS = ['Online','Store']
app/
  loyalty-dashboard/    freestyle UI5 app: Shell + role tabs + CustomersList (customer 360)
  customers-management/ transactions-management/ reward-policies/ tier-thresholds-management/
                        generated Fiori elements CRUD apps (npm workspaces)
  api-test-harness/    the 38-case interactive CRUD matrix
  router/               approuter (production entry point)
test/loyalty.test.js    12 automated cases (node --test + @cap-js/cds-test)
mta.yaml                MTA: srv, db-deployer, approuter, app-deployer, 6 UI modules +
                        XSUAA / HANA / html5-repo / destination resources
docs/                   the report + all supporting documents (see §13)
```

**"Where do I change X?"**

| Change | Edit |
|---|---|
| Earn rate per channel | Admin UI at runtime, or the seed `db/data/loyalty-RewardPolicy.csv` |
| Cash value of a point | `srv/lib/point-value.js` (UIs pick it up via `getUserInfo()`) |
| Tier rules | Admin UI at runtime, or `db/data/loyalty-TierThreshold.csv` |
| Validation / business rules | `srv/handlers/*.js` (keep the ownership guard first) |
| API surface, role grants | `srv/service.cds` (`@restrict`), `db/schema.cds` |
| Roles in production | `xs-security.json` + BTP role collections |
| Dev mock users | `package.json` → `cds.requires.[development].auth.users` |

---

## 10. Testing

```bash
npm test    # 12 cases, node --test via @cap-js/cds-test, [test] profile, in-memory SQLite
```

Coverage: both channel rates, part-payment arithmetic, insufficient-balance and
over-purchase rejections, ownership 403s, tier transitions (incl. boundary), tier
recompute on threshold change, onboarding validation (400/403/409), and the
**concurrency guard** — two full-balance redemptions fired in parallel: exactly one 201,
final balance 0, never negative.

Companion artifacts:

- Test case sheet (incl. manual UI cases): [`docs/test-cases.md`](docs/test-cases.md)
- Executed CRUD matrix, 38/38: [`docs/crud-test-results.md`](docs/crud-test-results.md)
- Interactive harness: `/apitestharness/index.html` (see [§7.5](#75-api-test-harness))

---

## 11. Deployment

Target: **SAP BTP Cloud Foundry + SAP HANA Cloud**. The MTA (`mta.yaml`) provisions the
HDI container (`loyalty-rewards-db`), the db-deployer, the Node.js service, the approuter,
the HTML5 app repository for the six UIs, and XSUAA/destination resources.

```bash
cf login -a https://api.cf.<region>.hana.ondemand.com   # once per shell
npm run build      # rimraf + mbt build → mta_archives/archive.mtar
npm run deploy     # cf deploy mta_archives/archive.mtar --retries 1
```

One-time manual step: in the BTP cockpit, assign the generated role collections
(`admin`, `staff`, `customer`) to your users — the MTA creates them but cannot assign people.

Verify (as done for the recorded deployment):

```bash
cf services | grep loyalty                                  # 5 services, create succeeded
curl -o /dev/null -w "%{http_code}\n" https://<srv-host>/odata/v4/loyalty/\$metadata   # 401 — XSUAA required
curl -o /dev/null -w "%{http_code}\n" https://<approuter-host>/                           # 302 → login page
```

Then open `<approuter-host>/loyaltydashboard/index.html` and log in with a user holding the
role collections. The recorded trial deployment ran at
`9231c958trial-dev-loyalty-rewards.cfapps.us10-001.hana.ondemand.com` (trial space — may be
stopped to save quota).

Teardown: `npm run undeploy` (`cf undeploy` with `--delete-services`).
Full annotated flow with real outputs: [`docs/deployment.md`](docs/deployment.md),
commands with sample output: [`docs/commands-reference.md`](docs/commands-reference.md).

---

## 12. Deliverables traceability

Every deliverable demanded by `txt.md` maps to an artifact in this repo:

| Deliverable (`txt.md`) | Where |
|---|---|
| Project Overview Document | [`docs/capstone-report.md`](docs/capstone-report.md) §1 (overview, scope, flow) |
| Data Model Design | [`docs/data-model.md`](docs/data-model.md) (spec-conformance tables) + [`docs/er-diagram.md`](docs/er-diagram.md) + report §2 |
| Service Definition (.cds) | [`srv/service.cds`](srv/service.cds) (+ annotated copy in report §3.1) |
| Agile Sprint Plan | [`docs/sprint-plan.md`](docs/sprint-plan.md) + report §4 (5 days, 4 sprints, git-tagged demo states) |
| Test Case Sheet | [`docs/test-cases.md`](docs/test-cases.md) + executed results in [`docs/crud-test-results.md`](docs/crud-test-results.md) |
| Deployment Steps | [`docs/deployment.md`](docs/deployment.md) + report §6 |
| Build Code prompts (BAS + Build Code requirement) | [`docs/build-code-prompts.md`](docs/build-code-prompts.md) + report §8 |
| "Executed to display the output" | report §7 showcase + [`docs/screenshots/`](docs/screenshots/) + deployed URLs |

---

## 13. Documentation map

| Document | Content |
|---|---|
| [`docs/capstone-report.md`](docs/capstone-report.md) | **The capstone report** — end-to-end: overview, data model, service logic, sprints, executed tests, deployment, showcase, prompts, conclusions |
| [`docs/submission-document.md`](docs/submission-document.md) | Full submission content incl. role-by-role showcase and screenshot capture list |
| [`docs/data-model.md`](docs/data-model.md) | Spec (`txt.md`) → implementation conformance, entity by entity |
| [`docs/er-diagram.md`](docs/er-diagram.md) · [`docs/flow-diagram.md`](docs/flow-diagram.md) | ER and flow diagrams (Mermaid + rendered PNGs) |
| [`docs/sprint-plan.md`](docs/sprint-plan.md) | Agile plan, user stories, acceptance criteria |
| [`docs/test-cases.md`](docs/test-cases.md) · [`docs/crud-test-results.md`](docs/crud-test-results.md) | Test case sheet + executed 38/38 CRUD matrix |
| [`docs/deployment.md`](docs/deployment.md) | BTP CF + HANA Cloud deployment steps |
| [`docs/commands-reference.md`](docs/commands-reference.md) | Every command used, with real sample outputs |
| [`docs/build-code-prompts.md`](docs/build-code-prompts.md) | Build Code (Joule) prompt log — assignment deliverable |
| [`docs/code-appendix.md`](docs/code-appendix.md) | Code appendix for the report |
| `docs/screenshots/`, PNG/PDF exhibits | Deployment evidence, UI screenshots, prompt evidence, CRUD harness printout |

Submission bundle (report source, design artifacts, prompts, code copy): [`submission/`](submission).

---

## 14. Known limitations & future work

- Dev/test data is in-memory SQLite — every `cds watch` restart re-seeds from CSVs.
- Single currency (₹) and one i18n bundle; no per-locale files yet.
- No points expiry, campaign engine, or scheduled jobs (future work, report §9.4).
- `RewardPolicies` PATCH/DELETE key on `policyID` (surrogate), not `channel`.
