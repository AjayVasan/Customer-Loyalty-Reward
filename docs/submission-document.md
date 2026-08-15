# Submission Document — Retail Omni-Channel Customer Loyalty & Rewards

> How to use this file: this is the full text of the submission. Where a screenshot
> belongs, there is a marker like **[ATTACH S4]**. The capture list at the very end
> tells you exactly what each S-number is, how to get the screen into that state, and
> what must be visible in the frame. The text already refers to the screenshots, so
> once they are pasted in at the markers, the document reads complete.

Live application: https://9231c958trial-dev-loyalty-rewards.cfapps.us10-001.hana.ondemand.com/loyaltydashboard/index.html
CRUD test page: https://9231c958trial-dev-loyalty-rewards.cfapps.us10-001.hana.ondemand.com/apitestharness/index.html

---

## 1. Project Overview

A retailer sells through a website and through physical stores. Customers expect one
loyalty balance across both, so the system keeps a single customer record, records
purchases from either channel, converts the purchase value into points using an
admin-configurable rate per channel, and lets the customer spend those points later.
Online purchases earn more than store purchases (₹1 = 0.05 points online versus 0.03
in store by default) because the business wants to push digital adoption. That single
rule drives most of the interesting logic in the backend.

Three roles use the system. A customer looks after their own account: balance, tier,
purchase history, redemptions, and they can register a purchase themselves. Retail
staff serve customers at the counter: find the customer by email, record a purchase,
onboard someone new. An admin governs the program: reward policies, tier thresholds,
a full customer 360 lookup, and program level KPIs.

One decision worth calling out early: staff can see who a customer is, but not what
they bought. The staff search returns identity and the current balance (needed to
accept points as payment) and nothing else. Purchase history analysis belongs to the
admin role. I enforced this on the backend with `@restrict` grants, not just by
hiding UI elements, so the API refuses to hand out the data in the first place.

Points also work as payment at purchase time. A customer can put points in while a
purchase is being recorded, online or at the counter, and the system deducts them
from the balance and reduces the payable amount. One point covers ₹0.50 (configurable
via the `POINT_VALUE_INR` environment variable). This is the feature I built in the
fourth sprint and it is the part of the system with the most careful engineering,
because money and balances move in the same request.

## 2. Architecture

```
        browser
          │
   SAP approuter (XSUAA login, routes /loyaltydashboard, /apitestharness, ...)
          │
   ┌──────┴──────────────────────────────────────┐
   │  Fiori apps (html5 repo)                    │
   │  loyalty-dashboard (freestyle, all roles)   │
   │  4 generated admin apps (List Report/OPage) │
   │  apitestharness (static CRUD test page)     │
   └──────┬──────────────────────────────────────┘
          │  OData V4 ($batch, CSRF)
   LoyaltyService  /odata/v4/loyalty      srv/service.cds
          │  handlers: transaction, redemption, policy
          │  libs: policy-cache, tier, channels, point-value, ownership
   ┌──────┴──────────┐
   │ SQLite (local)  │   in-memory for dev and tests
   │ SAP HANA Cloud  │   production, HDI container, deployed by mta
   └─────────────────┘
```

The service is one CAP service with five entities (section 3). Customers,
Transactions and Redemptions come straight from the problem statement. I added
RewardPolicy and TierThreshold as configuration entities because the admin role in
the spec explicitly needs to modify earn rates and tier rules without a code change.
Two more columns on Transaction, `price` and `pointsApplied`, carry the
part-payment feature: `amount` stays in the model as the cash the customer actually
pays, which is what the spec's amount field always meant.

Everything runs in one MTA on Cloud Foundry: approuter for login and routing, six
html5 applications served from the html5-apps-repo, the CAP service with the HANA
HDI binding, XSUAA for auth, and an app-deployer that pushes the built frontends.
The same `mta.yaml` builds the CRUD harness, so the test page is part of the deployed
submission rather than a local-only tool.

## 3. Data Model Design

Full attribute-level design: [data-model.md](data-model.md). Summary:

**Customers** — `customerID` (UUID key), `name`, `email` (unique), `channel` they
registered from, `totalPoints` (spendable balance, starts 0), `lifetimePoints`
(never decreases, drives tiering), `tier`. Tier is derived, never stored from user
input: `lifetimePoints` 5,000 → Silver, 20,000 → Gold, 50,000 → Platinum, else
Bronze. When an admin edits a threshold, every existing customer's tier is re-derived
in the same request.

**Transactions** — `txnID` key, link to customer, `channel` (Online | Store),
`price` (list price, floored to the ₹0.50 grid at entry), `pointsApplied` (points put
in as payment), `amount` (cash actually payable after the points discount),
`pointsEarned`, `txnDate`. The ledger is immutable: no PATCH, no DELETE, for any
role. Fixes and reversals would be new rows, which is the normal choice for anything
financial.

**Redemptions** — `redemptionID` key, link to customer, `pointsUsed`, optional
`remark`, `redemptionDate`. Points spent at purchase time also produce a Redemption
row automatically, with a remark like "Applied to purchase (₹75 → payable ₹72)", so
part-payments and standalone redemptions share one audit trail.

**RewardPolicy** — one row per channel: `channel` (key), `pointRate` (points per ₹1),
`activeFrom` date. Seeded Online 0.05 and Store 0.03. The service caches these in
memory and invalidates the cache whenever a policy row is written, so an admin's
change applies to the very next purchase without a restart.

**TierThreshold** — `tier` (key), `minPoints`. Seeded Bronze 0, Silver 5,000, Gold
20,000. I added Platinum 50,000 through the admin UI during acceptance testing,
which is a nice demonstration that the config entities actually work as config.

## 4. Service Definition and Business Logic

The service is defined in `srv/service.cds` with role annotations on every entity
(`@requires` / `@restrict`), and the logic lives in `srv/transaction.js`,
`srv/redemption.js`, `srv/policy.js` and the `srv/lib/*` modules. Summary of the
behaviour, with the guarantees I test for:

### The point engine, with real numbers

Everything a purchase does happens inside one CREATE handler and one database
transaction, so a half-recorded purchase cannot exist. Worked example from the
deployed system: staff record a product priced ₹75.30 for Alice, and she wants to
use 6 points.

1. The price is floored to the ₹0.50 grid, so ₹75.30 becomes ₹75.00. This is why the
   payable never shows an odd fraction like ₹72.37: one point covers exactly ₹0.50,
   so both the price side and the discount side stay on the grid.
2. 6 points × ₹0.50 = ₹3.00 covered. Payable = ₹72.00.
3. Points are earned on what was actually paid: floor(72 × 0.05) = 3 points.
4. A Redemption row is written automatically (see section 3).
5. Alice's balance moves 2,248 → 2,245 in a single guarded SQL UPDATE
   (`totalPoints = totalPoints − 6 + 3 WHERE totalPoints >= 6`). Two purchases at the
   same instant cannot spend the same points twice; the loser's UPDATE matches zero
   rows and gets a clean 400 asking them to retry. There is an automated test that
   fires two full-balance redemptions in parallel and asserts exactly one succeeds.

Redemptions validate the same way: enough balance, positive integer points, and the
balance column is adjusted with the same guarded UPDATE pattern.

### Security model

Grants are on the backend first, UI second:

| Entity | Customer | Staff | Admin |
|---|---|---|---|
| Customers | create (own), read own | read all, create | full |
| Transactions | create for own account, read own | create, read none | read all |
| Redemptions | create for own, read own | create (read denied) | full |
| RewardPolicy / TierThreshold | no access | read | full |

Ownership is enforced in `srv/lib/ownership.js` and it deliberately runs **before**
field validation. If a customer tries to POST a transaction naming a foreign
customerID, they get 403 with no hint whether that account exists, so the guard
cannot be abused as an account-existence oracle. The two cross-role rows in the CRUD
matrix (section 6) test exactly this.

Anyone's first login auto-creates their loyalty account from the XSUAA identity
(name, email, Bronze, 0 points), so there is no separate signup flow and no orphaned
logins.

## 5. Agile Sprint Plan

Full plan with user stories and acceptance criteria: [sprint-plan.md](sprint-plan.md).
How it actually went:

**Sprint 1 — model and service.** Entities, associations, seed CSVs, OData V4
exposure, role matrix in `srv/service.cds`. I kept the grants tight from the start:
admin everything, staff read-and-record, customers self-service scoped to their own
rows. HANA task in this sprint was sizing the decimal columns (`Decimal(10,2)` for
money, integer points).

**Sprint 2 — logic.** Points computation with the cached policy store, redemption
validation, tier derivation, guarded balance UPDATEs. The automated suite (12 cases)
grew alongside the logic rather than after it, which caught the
tier-recompute-on-threshold-change behaviour more than once.

**Sprint 3 — UI.** Four List Report / Object Page apps generated with Build Code for
admin CRUD, then the freestyle dashboard for all three roles, which is where most of
the UI5 v4 learning happened. Two things cost me an evening each: inactive create
contexts in OData V4 (a `list.create(data, ..., true)` looks fine and silently never
sends), and surfacing backend errors that arrive inside a `$batch` envelope, which
only show up through the message manager.

**Sprint 4 — part-payment + hardening + deploy.** Price grid flooring, points-as-
payment, the auto Redemption row, concurrency guards, the ownership guard before
validation, 409s for duplicate emails, and the Cloud Foundry deployment with HANA
Cloud behind it. One review bug fixed late: users holding both admin and staff roles
only ever got the admin KPI strip filled; now both strips load in parallel.

## 6. Testing

Two layers:

**Automated: `npm test` — 12/12 green.** Points engine (7 cases: online rate, store
rate, tier thresholds crossing, part-payment arithmetic, grid flooring), concurrency
(1: parallel double-spend), role guards (4: 403s per the table in section 4). Runs on
in-memory SQLite with three mock users (alice customer, bob staff, carol admin).
Sheet: [test-cases.md](test-cases.md).

**Interactive CRUD matrix: the deployed test page.** The submission asks for a
runnable demonstration of CRUD against the service, so I built a self-contained page
(plain HTML and fetch, about 280 lines) and deployed it with the app at
/apitestharness/index.html. Pressing "Run all cases" executes 36 requests against the
live OData service: creates, reads with filters and `$apply` aggregates, updates and
deletes on every entity, plus the function import, and checks each response against
the expected contract.

**[ATTACH S9 — CRUD page after a full run]**

Expected result as the BTP admin login: **34 of 36 pass**. The two red rows are the
cross-role cases ("customer buys for a foreign account", "customer redeems a foreign
account") which are supposed to return 403 for a customer-only login; as admin the
ownership guard correctly lets them through, so they show 201. Run the same page
locally with the mock customer user and those two flip to green while the admin-only
rows flip red. The same page run locally produced 38/38 on the full local matrix
(recorded response by response in [crud-test-results.md](crud-test-results.md)).

The page also documents the negative-space rules by testing them: transactions and
redemptions refuse PATCH and DELETE with 403 for everyone, because they are an
immutable ledger; customers cannot be PATCHed or DELETEd by anyone either, so
balances only move through the validated business paths.

## 7. Deployment

Step-by-step with real outputs: [deployment.md](deployment.md). Short version:

1. `npm install` (workspaces root).
2. `cds add hana,xsuaa,approuter,html5-repo` — one time, produces `mta.yaml` and the
   service definitions in it.
3. `mbt build` — builds the CAP module, the six html5 apps and the app-deployer
   artifacts into `mta_archives/`.
4. `cf login` to the trial subaccount, then `cf deploy mta_archives/loyalty-rewards_1.0.0.mtar`.
5. One-time: create the HANA HDI container binding and the html5 runtime are part of
   the MTA; grant the XSUAA role collection to your user in the BTP cockpit.

**[ATTACH S11 — cf deploy success output, or `cf apps` showing loyalty-rewards running]**

Local: `npm run watch` serves the same app on http://localhost:4004 with mock basic
auth (alice/bob/carol, password `pass`) and the CRUD page at
/apitestharness/index.html.

## 8. Build Code Prompts

The four Fiori admin apps (Customers, Transactions, Redemptions, Policies) were
generated with SAP Build Code. The exact prompts, in order, are in
[build-code-prompts.md](build-code-prompts.md) and [prompts.md](../prompts.md).

**[ATTACH S10 — your Build Code prompt screenshots, in order of the four prompts]**

What the prompts had to get right, and why they are written the way they are: each
one pins the entity and service path (`/odata/v4/loyalty`), asks for List Report +
Object Page with the specific columns, and states the role the app is for. The
generated apps needed almost no manual repair; the real work was wiring them into
the MTA and the role model, which the prompts do not cover.

## 9. Application Showcase

The dashboard is one freestyle UI5 app with three tabs, and it opens on the tab that
matches your strongest role. Everything below is from the deployed system.

### 9.1 Customer view — My Account

**[ATTACH S2 — Customer tab with the purchase form filled]**

First login creates the loyalty account automatically and says welcome. After that
the tab shows the balance, tier and lifetime points up top, then the two forms and
the two history tables.

The purchase form is where part-payment meets the customer. Pick a channel, type the
price, optionally put points in. The grey hint line under the form recalculates on
every keystroke; in the screenshot it reads `₹1 = 0.05 pts (Online) — price ₹199.50
— 4 pts cover ₹2.00 — payable ₹197.50 — +9 pts`, which is the whole computation made
visible before anything is submitted. The points field is clamped live to what the
balance and the price allow, so typing 999 just snaps back to the maximum.

**[ATTACH S3 — same tab after submitting, history row + toast visible]**

Submitting shows a toast with the earned points, and the new row appears in the
purchase history with price, payable, points applied and points earned as columns.
The redemption form below it spends points without a purchase, with an optional
remark.

### 9.2 Retail staff view — Staff Operations

**[ATTACH S4 — Staff tab with a searched customer card and the purchase form filled]**

The KPI strip across the top is deliberately their working day: customers, total
purchases, purchases today, points issued split by channel. Below that, the find
panel: type an email, press search, get a card with name, current balance and tier.
That balance matters operationally, it is the ceiling for points the customer can
spend in the next field.

The screenshot has the flow mid-story: Alice found (2,245 pts, Bronze), a ₹75.30
purchase with 6 points applied, and the same live hint the customer sees.

**[ATTACH S5 — after recording the purchase: toast "3 points earned", balance refreshed]**

The "Add new customer" panel onboards someone on the spot and selects them for the
purchase form. The "Customer directory" button opens a plain contact list (name,
email, tier) with no drill-down, because staff do not get history.

**[ATTACH S6 — Customer directory page]**

### 9.3 Admin view — Admin Console

**[ATTACH S1 — Admin tab on login: KPI strip + policy/threshold tables]**

The admin strip answers program-level questions: customers, purchases, points issued
per channel, points redeemed, and outstanding points, the sum of all live balances,
which is the program's open liability. It reconciles: issued minus redeemed equals
outstanding (68,932 = 69,549 − 558 in the data behind the screenshot).

Nothing about an individual customer is shown until the admin actively looks someone
up, by email or by UUID.

**[ATTACH S7 — Admin lookup drill-down: full purchase + redemption history of one customer]**

The lookup opens the full 360: identity, balances, tier, the complete purchase table
and every redemption including the automatic part-payment rows. Reward policies and
tier thresholds are editable inline on the same tab; saving a rate reloads the
server-side policy cache immediately, and saving a threshold re-derives everyone's
tier. Duplicate policies (one per channel is the rule) come back as a clean 409
rather than a database error.

**[ATTACH S8 — policy table with an inline edit, or the 409 toast after adding a duplicate]**

---

## Screenshot capture list

All captures from the live app
(https://9231c958trial-dev-loyalty-rewards.cfapps.us10-001.hana.ondemand.com/loyaltydashboard/index.html),
logged in with your own account, browser window wide enough to show the full tab
(1440px or more is ideal). Take them in one session so the numbers agree with each
other.

| # | Section | What to capture | How to get that exact state |
|---|---|---|---|
| S1 | 9.3 | Admin Console tab: KPI strip + policy and threshold tables, no customer data visible | Log in (you land on Admin Console as admin). Wait for both KPI strips to load. Scroll so the KPI strip and the two config tables are in frame. |
| S2 | 9.1 | Customer tab, purchase form filled, hint line visible | Switch to the "My Account" tab. Channel Online, price `199.99`, points `4`. Make sure the grey hint line under the form is readable in the shot. |
| S3 | 9.1 | Same tab right after submitting a purchase | Submit the form from S2. Capture immediately: toast with earned points still visible, new first row in purchase history showing price / payable / points applied / points earned. |
| S4 | 9.2 | Staff tab: searched customer card + purchase form | Switch to "Staff Operations". Search `alice@example.com`. With the card showing balance and tier, enter price `75.30`, points `6`. Hint line should read price ₹75.00 / payable ₹72.00. |
| S5 | 9.2 | After recording the staff purchase | Submit the S4 form. Capture the toast ("3 points earned by ...") and the card's refreshed balance (2,245). |
| S6 | 9.2 | Customer directory | Click "Customer directory". Full table of name, email, tier. No drill-down rows. |
| S7 | 9.3 | Admin lookup drill-down | Back on Admin Console, look up `alice@example.com`. Capture the expanded view: purchase table + redemption history. |
| S8 | 9.3 | Policy inline edit or duplicate-policy 409 | Either edit the Online rate inline and show the save toast, or try adding a second Online policy and capture the 409 error message. |
| S9 | 6 | CRUD page, full run | Open /apitestharness/index.html, click "Run all cases", wait for the summary line "34 passed, 2 failed". Keep the two red rows in frame. |
| S10 | 8 | Your Build Code prompt screenshots | From your own captures of the four generation prompts, in order. |
| S11 | 7 | Deployment proof | Terminal with the successful `cf deploy` ending (or `cf apps` showing `loyalty-rewards` started). |

Notes on consistency: S2/S3 and S4/S5 change balances, so take S7 last if you want
the admin drill-down to include the newest rows. Alice's balance in S4 should be
2,245 if S3 has already run once; it becomes 2,242 after S5, and S7 will show
2,242. That is fine, the text in 9.3 does not pin her balance.
