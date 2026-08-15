# Build Code — Prompt Log

Prompts used in **SAP Build Code (Joule / guided development)** while building this
project, in order, with the artifact each one produced. Kept as the assignment
deliverable *"Submit the prompts used in Build Code"*.

> Tool: SAP Build Code in SAP Business Application Studio (BAS),
> CAP generator + Joule AI assist, Node.js runtime.

---

## Sprint 1 — Foundation

### Prompt 1 — project scaffold
```
Create a CAP Node.js project "loyalty-rewards" for a Retail Omni-Channel
Customer Loyalty & Rewards Management system. Use MTA deployment with an
approuter, XSUAA with roles admin, staff and customer, and SAP HANA (hdi-shared)
as the production database with SQLite for local development.
```
**Produced:** `mta.yaml`, `xs-security.json`, `app/router/`, package.json profiles
(`[development]` sqlite + basic mock users, `[test]` in-memory sqlite + mock users,
`[production]` hana), `.cdsrc.json` build tasks.

### Prompt 2 — domain model
```
In db/schema.cds model entity Customer (customerID UUID key, name, email,
totalPoints, tier), Transaction (txnID UUID key, customerID association to
Customer, channel Online|Store, amount Decimal(10,2), txnDate, pointsEarned),
and Redemption (redeemID UUID key, customerID association, pointsUsed,
redeemDate, remarks). All managed. Add totalPoints default 0 and tier
default 'Bronze'.
```
**Produced:** `db/schema.cds` — exactly the txt.md entities.

### Prompt 3 — model extensions
```
Extend the model: Customer gets lifetimePoints (never decreases, drives tier
promotion). Transaction gets price (product list price) and pointsApplied
(reward points used as part-payment, 1 point = 0.50 INR). Add configuration
entities RewardPolicy (channel-unique points per currency unit, e.g. Online
0.05, Store 0.03) and TierThreshold (tier, minLifetimePoints; Bronze 0,
Silver 5000, Gold 20000). Seed them with CSV files.
```
**Produced:** extensions in `db/schema.cds`, `db/data/*.csv`.

### Prompt 4 — service exposure
```
Expose all entities in srv/service.cds as LoyaltyService at /odata/v4/loyalty,
requires authenticated-user. Add @restrict grants: Customers — read for
admin/staff, read+create for customer where email = $user.email, create for
staff/admin; Transactions — read+create for admin/staff, read for customer
where customerID.email = $user.email, create for customer (own account,
enforced in a handler); Redemptions — read+create for admin and for customer
(own); RewardPolicies — all for admin, read for staff; TierThresholds —
admin only. Add a getUserInfo() function returning id, email, name, role
flags and pointValueInr.
```
**Produced:** `srv/service.cds`.

## Sprint 2 — business logic

### Prompt 5 — points engine
```
On CREATE of Transaction validate channel and customer, denominate the price
on the 0.50 INR grid, compute amount = price − pointsApplied × 0.50 and
pointsEarned = floor(amount × channel policy rate) from a cached policy
store. If pointsApplied > 0 also insert a Redemption row and adjust the
customer balance. Update totalPoints and lifetimePoints and recompute the
tier from tier thresholds. Make the balance update a single atomic guarded
UPDATE (totalPoints = totalPoints − applied + earned WHERE
totalPoints >= applied) so concurrent purchases can never overspend — this
must also be safe on SAP HANA row locks.
```
**Produced:** `srv/handlers/transaction.js`, `srv/lib/{policy-cache,tier,channels,point-value}.js`.

### Prompt 6 — redemption logic
```
On CREATE of Redemption validate a positive integer pointsUsed, reject when
it exceeds the customer's totalPoints, and deduct atomically like the
transaction handler. Points must never go below zero.
```
**Produced:** `srv/handlers/redemption.js`.

### Prompt 7 — policy admin + guards
```
Validate RewardPolicy channel values against the same channel list as
transactions. Reload the policy cache on any RewardPolicy or TierThreshold
change, and when thresholds change recompute every existing customer's tier
immediately. Also add before-CREATE guards on Customers and Transactions:
customers may only onboard with their own login email (reject duplicates
with 409) and may only register purchases for their own account. Resolve
emails from either user.email or user.attr.email so XSUAA and mock users
both work.
```
**Produced:** `srv/handlers/policy.js`, guards + getUserInfo in `srv/service.js`.

## Sprint 3 — Fiori UI

### Prompt 8 — generated admin apps
```
Generate Fiori List Report Object Page apps on LoyaltyService for
customers-management, transactions-management, reward-policies and
tier-thresholds-management with OData V4 and annotations for line items and
value helps (customer name/email on transactions).
```
**Produced:** `app/customers-management`, `app/transactions-management`,
`app/reward-policies`, `app/tier-thresholds-management`, `srv/ui-annotations.cds`.

### Prompt 9 — role-based dashboard
```
Build a custom Freestyle UI5 dashboard "loyalty-dashboard" with an IconTabBar
per role. Customer tab: balance/tier header, register-purchase form with live
earn-rate preview, redeem form, purchase + redemption history, self-onboarding
on first login. Staff tab: KPI tiles (Customers, Purchases, Purchases today,
Points issued total/Online/Store), find-customer-by-email (identity only),
record purchase with rate hint, add customer, customer directory. Admin tab:
KPI tiles (Customers, Points issued Online/Store, Points redeemed, Purchases,
Outstanding points = sum of customer balances), gated customer lookup by UUID
or email with full history, editable reward policies and tier thresholds,
add threshold. Everything internationalized via a single i18n bundle; the
point value must come from getUserInfo, not a client constant.
```
**Produced:** `app/loyalty-dashboard` (views, controllers, i18n, css, manifest).

## Sprint 4 — tests & deployment

### Prompt 10 — backend tests
```
Create a node --test suite with @cap-js/cds-test under the [test] profile
(basic mock users alice=customer, bob=staff, carol=admin): per-channel points
math, part-payment arithmetic, invalid channel/customer/overspend rejections,
redemption beyond balance, tier promotion at threshold, tier recompute on
threshold change, two concurrent full-balance redemptions where exactly one
wins, and role-guard checks including getUserInfo pointValueInr.
```
**Produced:** `test/loyalty.test.js`.

### Prompt 11 — deployment
```
Assemble the MTA: db-deployer for the HANA HDI container, nodejs srv bound
to the HDI container and XSUAA, html5 repo host + deployer for the five UIs,
destination and connectivity for the approuter. Provide npm scripts build
(mbt build) and deploy (cf deploy).
```
**Produced:** final `mta.yaml`, npm scripts, `docs/deployment.md`.
