# Project Submission: Retail Omni-Channel Customer Loyalty & Rewards

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
from the balance and reduces the payable amount. One point covers ₹0.50. The value
lives in exactly one place on the server (`srv/lib/point-value.js`), and the server
hands it to every UI through the `getUserInfo()` function import, so no client keeps
its own copy that could drift. This is the feature I built in the fourth sprint and
it is the part of the system with the most careful engineering, because money and
balances move in the same request.

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

Rendered high-level flow diagram (Mermaid, end-to-end request flow through purchase
engine and cache): [flow-diagram.md](flow-diagram.md).

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

Full attribute-level design: [data-model.md](data-model.md), ER diagram in Mermaid:
[er-diagram.md](er-diagram.md). Summary:

**Customers**: `customerID` (UUID key), `name`, `email` (unique), `totalPoints`
(spendable balance, starts 0), `lifetimePoints` (never decreases, drives tiering),
`tier`. Tier is derived, never stored from user input: `lifetimePoints` 5,000 →
Silver, 20,000 → Gold, 50,000 → Platinum, else Bronze. When an admin edits a
threshold, every existing customer's tier is re-derived in the same request.


**Transactions**: `txnID` key, link to customer, `channel` (Online | Store),
`price` (list price, floored to the ₹0.50 grid at entry), `pointsApplied` (points put
in as payment), `amount` (cash actually payable after the points discount),
`pointsEarned`, `txnDate`. The ledger is immutable: no PATCH, no DELETE, for any
role. Fixes and reversals would be new rows, which is the normal choice for anything
financial.

**Redemptions**: `redemptionID` key, link to customer, `pointsUsed`, optional
`remark`, `redemptionDate`. Points spent at purchase time also produce a Redemption
row automatically, with a remark like "Applied to purchase (₹75 → payable ₹72)", so
part-payments and standalone redemptions share one audit trail.

**RewardPolicy**: one row per channel: `channel` (key), `pointRate` (points per
₹1), `activeFrom` date. Seeded Online 0.05 and Store 0.03. Purchases never read
this table directly; they read the write-through cache described in section 4, so an
admin's change applies to the very next purchase without a restart.

**TierThreshold**: `tier` (key), `minPoints`. Seeded Bronze 0, Silver 5,000, Gold
20,000. I added Platinum 50,000 through the admin UI during acceptance testing,
which is a nice demonstration that the config entities actually work as config.


## 4. Service Definition and Business Logic

The service is defined in `srv/service.cds` with role annotations on every entity
(`@requires` / `@restrict`), and the logic lives in `srv/handlers/` (transaction,
redemption, policy) plus small single-purpose modules in `srv/lib/` (policy-cache,
point-value, tier, channels, ownership). Summary of the behaviour, with the
guarantees I test for:

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

### Write-through configuration cache

Reward policies and tier thresholds are read on every purchase and redemption, but
they change once a month at most, so hitting the database for them on the hot path
would be wasted work. `srv/lib/policy-cache.js` holds both in memory: the rates as a
channel → rate map, the thresholds as an array. It is a write-through cache, not a
TTL cache: the service loads it once at boot, and `srv/handlers/policy.js` registers
after-hooks on CREATE, UPDATE and DELETE of both config entities that reload the
cache in the same request as the admin's write. So the database row and the cache
the very next purchase reads are updated together, and there is no stale window and
no restart needed. A missing policy for a channel is a hard error at read time
(`rateFor` throws), so a typo'd channel can never silently earn zero points.

Two implementation details that mattered. The reload uses bare `SELECT` rather than
`srv.run`, so it joins whatever transaction is already active instead of opening a
nested one (which deadlocks on SQLite's single connection when called mid-request),
and it bypasses `@restrict`, which is correct because this is trusted system config
loading, not a user-facing read. And when a threshold changes, the same after-hook
re-derives every customer's tier immediately, otherwise tiers would stay stale until
each customer's next purchase.

### getUserInfo(): the client's single source of truth

The one function import answers "who am I and what are the rules" in a single
request: identity (email, customerID after auto-onboarding), role flags
(`isAdmin`, `isStaff`, `isCustomer`) and `pointValueInr`. The dashboard calls it
once at startup to pick the default tab per role and to gate the UI, and every
earn-rate hint uses the served point value rather than a hardcoded number. Changing
the point value is a one-line server change; no UI ships a copy of it.

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

**Sprint 1: model and service.** Entities, associations, seed CSVs, OData V4
exposure, role matrix in `srv/service.cds`. I kept the grants tight from the start:
admin everything, staff read-and-record, customers self-service scoped to their own
rows. HANA task in this sprint was sizing the decimal columns (`Decimal(10,2)` for
money, integer points).

**Sprint 2: logic.** Points computation with the cached policy store, redemption
validation, tier derivation, guarded balance UPDATEs. The automated suite (12 cases)
grew alongside the logic rather than after it, which caught the
tier-recompute-on-threshold-change behaviour more than once.

**Sprint 3: UI.** Four List Report / Object Page apps generated with Build Code for
admin CRUD, then the freestyle dashboard for all three roles, which is where most of
the UI5 v4 learning happened. Two things cost me an evening each: inactive create
contexts in OData V4 (a `list.create(data, ..., true)` looks fine and silently never
sends), and surfacing backend errors that arrive inside a `$batch` envelope, which
only show up through the message manager.

All dashboard text went into one complete `i18n.properties` bundle rather than
per-locale files, so any browser locale renders fully with no raw `kpiXxx` keys
showing up, and the earn-rate hint text is a parameterised format string the
controller fills with the server-provided numbers.

**Sprint 4: part-payment, hardening, deploy.** Price grid flooring, points-as-
payment, the auto Redemption row, concurrency guards, the ownership guard before
validation, 409s for duplicate emails, and the Cloud Foundry deployment with HANA
Cloud behind it. One review bug fixed late: users holding both admin and staff roles
only ever got the admin KPI strip filled; now both strips load in parallel. Each
working state was snapshotted as a lightweight git tag (v1-working through
v5-staff-card), so every demoed version is reproducible with one checkout.

## 6. Testing

Two layers:

**Automated: `npm test`, 12/12 green.** Points engine (7 cases: online rate, store
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

The full printout of this run (all 36 case rows with status codes) is attached as
the exhibit `Loyalty Service, CRUD API Test Harness.pdf` in the design artifacts.

**[ATTACH S9: the CRUD harness PDF printout]**

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
2. `cds add hana,xsuaa,approuter,html5-repo` (one time), produces `mta.yaml` and the
   service definitions in it.
3. `mbt build` builds the CAP module, the six html5 apps and the app-deployer
   artifacts into `mta_archives/`.
4. `cf login` to the trial subaccount, then `cf deploy mta_archives/loyalty-rewards_1.0.0.mtar`.
5. One-time: create the HANA HDI container binding and the html5 runtime are part of
   the MTA; grant the XSUAA role collection to your user in the BTP cockpit.

The database schema is owned by an HDI container (`loyalty-rewards-db` with its
db-deployer module), and every `cf deploy` runs the deploy task that applies the
current `.cds`-derived schema. Adding `price` and `pointsApplied` to Transactions
mid-project was a real schema evolution shipped through exactly this pipeline: change
the model, build, deploy, and HANA applies the additive column without touching
existing rows. Every command with sample output is logged in
[commands-reference.md](commands-reference.md).

**[ATTACH S17: `S17-mbt-build.png`]** (mbt build producing the mtar),
**[ATTACH S11: `S11-cf-deploy.png`]** (the full cf deploy output ending in
"Process finished.") and **[ATTACH S18: `S18-cf-apps.png`]** (cf apps showing
loyalty-rewards and loyalty-rewards-srv started, with their live URLs) document the
pipeline end to end.

Local: `npm run watch` serves the same app on http://localhost:4004 with mock basic
auth (alice/bob/carol, password `pass`) and the CRUD page at
/apitestharness/index.html.

## 8. Build Code Prompts

The four Fiori admin apps (Customers, Transactions, Redemptions, Policies) were
generated with SAP Build Code. The exact prompts, in order, are in
[build-code-prompts.md](build-code-prompts.md) and [prompts.md](../prompts.md).

**[ATTACH S10: your Build Code prompt screenshots, in order of the four prompts]**

What the prompts had to get right, and why they are written the way they are: each
one pins the entity and service path (`/odata/v4/loyalty`), asks for List Report +
Object Page with the specific columns, and states the role the app is for. The
generated apps needed almost no manual repair; the real work was wiring them into
the MTA and the role model, which the prompts do not cover.

## 9. Application Showcase

The dashboard is one freestyle UI5 app with three tabs, and it opens on the tab that
matches your strongest role. Everything below is from the deployed system.

### 9.1 Customer view: My Account

**[ATTACH S2: `S2-customer-form-hint.png`]**

First login creates the loyalty account automatically and says welcome. After that
the tab shows the balance, tier and lifetime points up top, then the two forms and
the two history tables.

The purchase form is where part-payment meets the customer. Pick a channel, type the
price, optionally put points in. The grey hint line under the form recalculates on
every keystroke; in the screenshot it reads `₹1 = 0.05 pts (Online) — price ₹199.00
— 6 pts cover ₹3.00 — payable ₹196.00 — +9 pts`, which is the whole computation made
visible before anything is submitted. The points field is clamped live to what the
balance and the price allow, so typing 999 just snaps back to the maximum.

**[ATTACH S3: `S3-customer-purchase-result.png`]**

Submitting shows a toast (`Purchase recorded: 9 points earned by
mrajayvasan@gmail.com` in the screenshot, ₹199 at the online rate) and the new row
appears in the purchase history with date, channel, price, points used and points
earned as columns.

**[ATTACH S12: `S12-customer-redeem.png`]**

The redeem form spends points without a purchase. In the screenshot 5 points go out
against the remark "Gift Card", the balance drops from 12 to 7, and the redemptions
table shows both this entry and the earlier 6-point row that was applied to a
purchase. Lifetime points stays untouched at 18, redeeming never costs a tier.

### 9.2 Retail staff view: Staff Operations

**[ATTACH S4: `S4-staff-find-purchase-form.png`]**

The KPI strip across the top is deliberately their working day: customers, total
purchases, purchases today, points issued split by channel. Below that, the find
panel: type an email, press search, get a card with name, current balance and tier.
That balance matters operationally, it is the ceiling for points the customer can
spend in the next field.

The screenshot has the flow mid-story: Ajay found (4,676 pts, Silver), a ₹1,599
purchase with 100 points applied, and the live hint reading `price ₹1,599.00 — 100
pts cover ₹50.00 — payable ₹1,549.00 — +77 pts`.

**[ATTACH S5: `S5-staff-purchase-result.png`]**

Recording it confirms with `Purchase recorded: 77 points earned by Ajay`, exactly
the previewed number: floor(1,549 × 0.05) = 77. The program counters tick up as the
counter team works (38 purchases, 2 today at that point).

**[ATTACH S13: `S13-staff-add-customer-form.png`]** and
**[ATTACH S14: `S14-staff-customer-created.png`]**

The "Add new customer" panel onboards someone on the spot: in the screenshot staff
type "Test Customer Entry" / test@gmail.com, click create, and the toast confirms
the customer is ready for purchase entry. The customer count moves from 9 to 10 and
the finder selects the new account (0 pts, Bronze) so the very next action can be
their first purchase.

The "Customer directory" button opens a plain contact list (name, email, tier) with
no drill-down and no balances, because staff do not get history or financial data.

**[ATTACH S6: `S6-staff-directory.png`]**


### 9.3 Admin view: Admin Console

**[ATTACH S1: `S1-admin-console.png`]**

The admin strip answers program-level questions: in the screenshot, 8 customers,
36 purchases, 7,680 points issued online and 1,017 in store, 3,026 redeemed, and
7,479 outstanding, the program's open liability of earned-but-unspent points. Below
it the two config tables show the live rules: Online 0.05 and Store 0.03 points per
₹1, and tier thresholds where Bronze is the 0-point entry level and the higher tiers
are configured through the same form (Platinum pre-filled at 50,000 in the shot).

Nothing about an individual customer is shown until the admin actively looks someone
up, by email or by UUID.

**[ATTACH S7: `S7-admin-lookup.png`]**

The lookup opens the full 360: in the screenshot it is test@gmail.com with 248
current and 248 lifetime points, the two recorded purchases (₹1,999 → 99 pts,
₹2,999 → 149 pts) and the redemptions section, still empty at that point in the
walkthrough.

**[ATTACH S16: `S16-admin-lookup-partpayment.png`]**

The same customer after a part-paid purchase is the best single exhibit of the
points-as-payment feature: a ₹12 purchase with 22 points applied shows up as one
transaction (payable ₹1, 0 pts earned) plus one automatic redemption row with the
remark `Applied to purchase (₹12 → payable ₹1)`, and the balance moves 248 → 226
while lifetime points stays 248.

Reward policies and tier thresholds are editable inline on the same tab; saving a
rate reloads the server-side policy cache immediately, and saving a threshold
re-derives everyone's tier. Duplicate policies (one per channel is the rule) come
back as a clean 409 rather than a database error.

**[ATTACH S8: `S8-policy-edit.png`]** and **[ATTACH S15: `S15-policy-5-55.png`]**

The policy screenshots show the Online rate being edited twice in a row during
testing (0.50, then 5.55 points per ₹1), each save confirmed by toast and each
change applying only to future purchases. The 5.55 experiment is also the honest
explanation for the very large balances some test accounts accumulated, like the
66,742-point Platinum account in the master list below.

The "Customer master list" button opens the whole customer base with balances and
tiers, the admin counterpart of the staff directory. It is the one place that shows
everyone side by side; per-customer analysis still only happens through the lookup,
which keeps the default admin screen free of personal data, matching the requirement
that no customer details appear unless an id or email is actively searched.

**[ATTACH S19: `S19-admin-master-list.png`]**


---

## Requirements coverage

Every requirement from the problem statement, and where it landed:

| Requirement from txt.md | Where it is satisfied |
|---|---|
| Track purchases from Online and Store in one system | `channel` on Transaction, one customer balance, section 3 |
| Points computed dynamically per channel policy | Point engine + write-through policy cache, section 4 |
| Online earns more (₹1 = 0.05) to promote digital adoption | Seeded RewardPolicy rates, editable by admin |
| Redemption validates enough points (never below zero) | Guarded `UPDATE ... WHERE totalPoints >= pts`, 400 on shortfall |
| Points deducted after successful redemption | Same guarded UPDATE inside the request's transaction |
| Customer: view points, redeem, track history | My Account tab, section 9.1 |
| Retail staff: record purchases (POS or Online) | Staff Operations tab, section 9.2 |
| Admin: define and modify reward policies | Inline-editable tables on Admin Console, section 9.3 |
| Entities Customer / Transaction / Redemption as specified | Section 3, all specified attributes kept |
| Agile sprint plan | Section 5 + [sprint-plan.md](sprint-plan.md) |
| Deployed and executed to display output | Live URLs at the top, deployment section 7, CRUD run section 6 |
| Build Code prompts submitted | Section 8 + [prompts.md](../prompts.md) |
| CRUD test via file.html | Deployed at /apitestharness/index.html, section 6 |

Beyond the spec: points as part-payment on the ₹0.50 grid, tier thresholds with
lifetime points, the ownership guard, auto-onboarding at first login, and the
program-level KPI strip.

---

## Screenshot manifest

All screenshots are taken, named and placed. Files live in `submission/screenshots/`;
each marker above names its file. For the final PDF, paste each file at its marker.

| File | Marker | Section | What it shows |
|---|---|---|---|
| S1-admin-console.png | S1 | 9.3 | Admin Console: KPI strip (8 customers, 36 purchases, 7,680 online / 1,017 store issued, 3,026 redeemed, 7,479 outstanding), policy and threshold tables |
| S2-customer-form-hint.png | S2 | 9.1 | My Account purchase form, ₹199 with 6 pts, hint: payable ₹196.00, +9 pts |
| S3-customer-purchase-result.png | S3 | 9.1 | Toast "9 points earned", first purchase row in history |
| S12-customer-redeem.png | S12 | 9.1 | Redeem 5 pts for a Gift Card, balance 12 → 7, lifetime unchanged at 18 |
| S4-staff-find-purchase-form.png | S4 | 9.2 | Ajay found (4,676 pts, Silver), ₹1,599 with 100 pts, payable ₹1,549, +77 |
| S5-staff-purchase-result.png | S5 | 9.2 | Toast "77 points earned by Ajay", counters updated |
| S13-staff-add-customer-form.png | S13 | 9.2 | Add new customer form filled (Test Customer Entry / test@gmail.com) |
| S14-staff-customer-created.png | S14 | 9.2 | Customer created toast, count 9 → 10, finder selects new account |
| S6-staff-directory.png | S6 | 9.2 | Staff customer list: name, email, tier only, no balances |
| S7-admin-lookup.png | S7 | 9.3 | Admin lookup: test@gmail.com, 248 pts, two purchases, no redemptions yet |
| S16-admin-lookup-partpayment.png | S16 | 9.3 | ₹12 purchase with 22 pts applied: payable ₹1 + auto redemption row, 248 → 226 |
| S8-policy-edit.png | S8 | 9.3 | Online rate edited to 0.50, save toast |
| S15-policy-5-55.png | S15 | 9.3 | Online rate at 5.55 during testing (explains the large test balances) |
| S19-admin-master-list.png | S19 | 9.3 | Admin master list: all customers with tiers and balances |
| S17-mbt-build.png | S17 | 7 | mbt build output, mtar generated |
| S11-cf-deploy.png | S11 | 7 | Full cf deploy output, "Process finished." |
| S18-cf-apps.png | S18 | 7 | cf apps: loyalty-rewards and loyalty-rewards-srv started with URLs |
| S10-prompt-1/2/3.png | S10 | 8 | Build Code prompt screenshots |
| S9 (design artifacts) | S9 | 6 | CRUD harness full-run printout (PDF) |

Optional extras if the reviewer wants more walkthrough depth: EX-1/EX-2 (staff
recording a ₹2,999 purchase for the new test customer, +99 then +149 pts), EX-3
(admin stats mid-testing). Attach them after section 9.2 or leave them out.

## Appendix: original design artifacts

Three working documents from the design phase ship with the report as-is:

- `Customer Reward Policy Flow` (PNG): the planning sketch of how a purchase flows
  through the channel policy to issued points, drawn before the handler code.
- `Customer Identity and Role` (PDF): the identity and role mapping worked out when
  deciding what each role may read and write; the `@restrict` matrix in section 4 is
  the codified version of it.
- `Loyalty Service, CRUD API Test Harness` (PDF): a printout of the CRUD test page
  run, companion to the screenshot in section 6.

They show the design-to-code trail: sketch first, then the enforced version of the
same decisions in the service.
