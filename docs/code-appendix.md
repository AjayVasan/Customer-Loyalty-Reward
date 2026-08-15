# Code Appendix — what to include in the report

Curated listings for the submission report. Each block is complete enough to grade
the logic without wading through the full repository. Full source ships in the code
zip regardless.

## 1. Domain model — `db/schema.cds` (complete, 48 lines)

The five entities exactly as deployed. This plus the ER diagram satisfies the
"Data Model Design" deliverable.

```cds
using { managed } from '@sap/cds/common';

namespace loyalty;

entity Customer : managed {
  key customerID   : UUID;
  name             : String(120);
  email            : String(254);
  totalPoints      : Integer default 0;
  lifetimePoints   : Integer default 0;
  tier             : String(10) default 'Bronze';
  transactions     : Association to many Transaction on transactions.customerID = $self;
  redemptions      : Association to many Redemption on redemptions.customerID = $self;
}

entity Transaction : managed {
  key txnID        : UUID;
  customerID       : Association to Customer;
  channel          : String(10) enum { Online; Store };
  price            : Decimal(10,2) default 0;   // list price, ₹0.50-denominated
  pointsApplied    : Integer default 0;         // part-payment points
  amount           : Decimal(10,2);             // cash payable after points
  txnDate          : DateTime;
  pointsEarned     : Integer default 0;
}

entity Redemption : managed {
  key redeemID     : UUID;
  customerID       : Association to Customer;
  pointsUsed       : Integer;
  redeemDate       : DateTime;
  remarks          : String(255);
}

entity RewardPolicy : managed {
  key policyID             : UUID;
  channel                  : String(10) enum { Online; Store };
  pointsPerCurrencyUnit    : Decimal(5,2);
}

entity TierThreshold : managed {
  key tier             : String(10);
  minLifetimePoints    : Integer;
}

annotate RewardPolicy with @assert.unique: { channel: [ channel ] };
```

(Comments trimmed from the original for print; the original carries the
rationale inline.)

## 2. Service definition — `srv/service.cds` (complete, 70 lines)

The exposed entities, the function import, and the role matrix. This is the
"Service Definition (.cds)" deliverable verbatim.

```cds
using loyalty as db from '../db/schema';

service LoyaltyService @(path: '/odata/v4/loyalty', requires: 'authenticated-user') {

  entity Customers            as projection on db.Customer;
  entity Transactions         as projection on db.Transaction;
  entity Redemptions          as projection on db.Redemption;
  entity RewardPolicies       as projection on db.RewardPolicy;
  entity TierThresholds       as projection on db.TierThreshold;

  function getUserInfo() returns UserInfo;

  // --- role matrix ---
  annotate Customers with @(restrict: [
    { grant: ['READ'],           to: 'staff' },
    { grant: ['READ','CREATE'],  to: 'admin' },
  ]);
  // ... (full @restrict blocks for all five entities in the file)
}
```

Note for the report: show the real file, the sketch above only indicates
structure. The full 70-line file has the grant table from report section 4
expressed as `@restrict` annotations, plus the `UserInfo` type with
`isAdmin/isStaff/isCustomer/pointValueInr`.

## 3. Purchase engine — core of `srv/handlers/transaction.js` (excerpt)

The one request that moves money: grid flooring, part-payment, auto-redemption
row, and the guarded concurrent-safe UPDATE.

```js
// Denominate the price on the ₹0.50 grid so the payable never carries an
// odd fraction: 1 point covers exactly ₹0.50, so price ∥ 0.5 and
// points × 0.5 keep the payable on the grid as well.
const price = Math.floor(rawPrice * 2) / 2

// ... customer existence + friendly pre-checks (balance, price ceiling) ...

const amount = price - pointsApplied * POINT_VALUE_INR // always a ₹0.50 multiple
const rate = policyCache.rateFor(channel)
const pointsEarned = Math.floor(amount * rate)

// Part-payment: record the redemption side in the same transaction.
if (pointsApplied > 0) {
  await INSERT.into(Redemptions).entries({
    customerID_customerID: customerKey,
    pointsUsed: pointsApplied,
    redeemDate: req.data.txnDate,
    remarks: `Applied to purchase (₹${price} → payable ₹${amount})`
  })
}

const newLifetimePoints = customer.lifetimePoints + pointsEarned
const newTier = computeTier(newLifetimePoints, policyCache.getThresholds())

// Concurrency: single atomic UPDATE with a totalPoints >= applied guard,
// computed by the database — not a read-modify-write. Two concurrent
// purchases cannot double-spend: the loser's guard matches 0 rows.
const rows = await UPDATE(Customers)
  .where({ customerID: customerKey })
  .and('totalPoints >=', pointsApplied)
  .set({
    totalPoints:   { xpr: [{ ref: ['totalPoints'] }, '-', { val: pointsApplied }, '+', { val: pointsEarned }] },
    lifetimePoints:{ xpr: [{ ref: ['lifetimePoints'] }, '+', { val: pointsEarned }] },
    tier: newTier
  })
if (rows !== 1) {
  return req.reject(400, 'Insufficient points: balance changed concurrently, retry', 'pointsApplied')
}
```

## 4. Write-through cache — `srv/lib/policy-cache.js` (complete, 27 lines)

```js
let policies = new Map()
let thresholds = []

// Bare SELECT joins whatever transaction is already active instead of opening
// a nested one (which deadlocks against sqlite's single connection), and
// bypasses @restrict: trusted internal config loading, not a user read.
async function load(srv) {
  const { RewardPolicies, TierThresholds } = srv.entities
  const rates = await SELECT.from(RewardPolicies)
  policies = new Map(rates.map(r => [r.channel, r.pointsPerCurrencyUnit]))
  thresholds = await SELECT.from(TierThresholds)
}

function rateFor(channel) {
  const rate = policies.get(channel)
  if (rate == null) throw new Error(`No RewardPolicy configured for channel "${channel}"`)
  return rate
}

function getThresholds() { return thresholds }

module.exports = { load, rateFor, getThresholds }
```

Reload wiring in `srv/handlers/policy.js` (one line, the write-through part):

```js
srv.after(['CREATE', 'UPDATE', 'DELETE'], RewardPolicies, async () => { await policyCache.load(srv) })
srv.after(['CREATE', 'UPDATE', 'DELETE'], TierThresholds, async () => {
  await policyCache.load(srv)
  // threshold change → re-derive every customer's tier immediately
})
```

## 5. Ownership guard — `srv/lib/ownership.js` (core)

Runs before validation, so a foreign customerID never leaks whether the account
exists:

```js
function emailOf (user) {
  // XSUAA carries the email in user.attr.email, local mock users in user.email
  return String((user && (user.email || (user.attr && user.attr.email))) || user.id || '').toLowerCase()
}

function assertOwnCustomer (srv) {
  const { Customers } = srv.entities
  return async (req) => {
    const u = req.user
    if (u.is && (u.is('admin') || u.is('staff'))) return
    const ownEmail = emailOf(u)
    const key = req.data.customerID_customerID || (req.data.customerID && req.data.customerID.customerID)
    const cust = await srv.run(SELECT.one.from(Customers).where({ customerID: key }))
    if (!cust || String(cust.email || '').toLowerCase() !== ownEmail) {
      return req.reject(403, 'Customers may only act on their own account')
    }
  }
}
```

## 6. Roles — `xs-security.json` (excerpt)

```json
"role-templates": [
  { "name": "Customer", "description": "Self-service: own account only" },
  { "name": "Staff",    "description": "Record purchases, read customer identity" },
  { "name": "Admin",    "description": "Full program governance" }
]
```

## 7. Deployment shape — `mta.yaml` (module list only)

```
modules:
  - loyalty-rewards-db        (hdi-container for SAP HANA Cloud)
  - loyalty-rewards-db-deployer
  - loyalty-rewards-srv       (CAP node service)
  - loyalty-rewards           (approuter)
  - loyaltyrewardsapp         (app-deployer: dashboard, 4 admin apps, apitestharness)
resources:
  - loyalty-rewards-auth      (XSUAA)
  - loyalty-rewards-registry  (html5-apps-repo)
```

## What is deliberately NOT in the report

UI controllers and views (long, mostly plumbing; the showcase screenshots carry
them), generated List Report apps, seed CSVs, `gen/` build output, and the test
page source (that ships as `file.html` in the package and as the CRUD results
table in the report). Anyone who wants depth has the code zip.
