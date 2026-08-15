# CRUD Test Results — LoyaltyService

Every CRUD case executed against the running service (`cds watch`, in-memory
SQLite, basic-auth mock users) on **2026-08-15**. The same cases can be re-run
in the browser with the interactive harness at
`http://localhost:4004/apitestharness/index.html` (log in as **carol** for the
main matrix, then as **alice** for the cross-role section).

- Endpoint: `http://localhost:4004/odata/v4/loyalty`
- Users: `carol` (admin) · `bob` (staff) · `alice` (customer) — password `pass`
- Writes carry `x-csrf-token` from a prior `fetch` GET.
- **38 / 38 cases matched the expected contract.**

## Customers

| # | Operation | Request | Expected | Actual |
|---|-----------|---------|----------|--------|
| C-01 | CREATE | `POST /Customers {name, email}` (admin) | 201 created | ✅ 201 — entity returned with `tier: Bronze`, `totalPoints: 0` |
| C-02 | CREATE (invalid) | `POST /Customers {name:"", email:"x"}` | 400 validation | ✅ 400 — `name is required` (target `name`) |
| C-03 | READ | `GET /Customers?$top=5&$select=…` | 200 list | ✅ 200 — array value |
| C-04 | READ (by key) | `GET /Customers(customerID=…)` | 200 entity | ✅ 200 |
| C-05 | UPDATE | `PATCH /Customers(…) {name}` | 403 — no role has UPDATE (balances are system-owned) | ✅ 403 Forbidden |
| C-06 | DELETE | `DELETE /Customers(…)` | 403 — no role has DELETE | ✅ 403 Forbidden |

## Transactions

| # | Operation | Request | Expected | Actual |
|---|-----------|---------|----------|--------|
| T-01 | CREATE | `POST /Transactions {Online, price 1000}` | 201 — 50 pts (0.05/₹) | ✅ 201 — `pointsEarned 50`, `amount 1000` |
| T-02 | CREATE | `POST /Transactions {Store, price 500, pointsApplied 20}` | 201 — payable 490, 14 pts | ✅ 201 — `amount 490`, `pointsEarned 14`, part-payment Redemption row created |
| T-03 | CREATE (invalid) | `{channel:"Phone"}` | 400 | ✅ 400 — `channel must be one of Online, Store` |
| T-04 | CREATE (invalid) | unknown customerID | 400 | ✅ 400 — `No customer found for …` |
| T-05 | CREATE (invalid) | `pointsApplied 9999 > balance` | 400 | ✅ 400 — `Insufficient points: customer has 44, tried to apply 9999` |
| T-06 | READ | filter by customer | 200 — rows above | ✅ 200 — Online 1000/50, Store 490/14 |
| T-07 | READ | `$apply=groupby((channel),aggregate(pointsEarned with sum as total))` | 200 — per-channel totals | ✅ 200 — `[{Online:60},{Store:14}]` |
| T-08 | UPDATE | `PATCH /Transactions(…) {amount}` | 403 — immutable ledger | ✅ 403 Forbidden |
| T-09 | DELETE | `DELETE /Transactions(…)` | 403 — immutable ledger | ✅ 403 Forbidden |

## Redemptions

| # | Operation | Request | Expected | Actual |
|---|-----------|---------|----------|--------|
| R-01 | CREATE | `POST /Redemptions {pointsUsed:10, remarks}` (admin) | 201 — balance −10 | ✅ 201 |
| R-02 | CREATE (invalid) | `pointsUsed 99999 > balance` | 400 | ✅ 400 — `Insufficient points: customer has 34, tried to redeem 99999` |
| R-03 | CREATE (invalid) | `pointsUsed: 0` | 400 | ✅ 400 — `pointsUsed must be a positive integer` |
| R-04 | READ | filter by customer | 200 — part-payment + standalone rows | ✅ 200 |
| R-05 | UPDATE | `PATCH /Redemptions(…)` | 403 | ✅ 403 Forbidden |
| R-06 | DELETE | `DELETE /Redemptions(…)` | 403 | ✅ 403 Forbidden |

## RewardPolicies (admin-managed)

| # | Operation | Request | Expected | Actual |
|---|-----------|---------|----------|--------|
| P-01 | READ | `GET /RewardPolicies` (admin) | 200 — Online 0.05, Store 0.03 | ✅ 200 |
| P-02 | CREATE (conflict) | duplicate `channel:"Online"` | 409 — one policy per channel | ✅ 409 — `A reward policy for channel Online already exists` |
| P-03 | CREATE (invalid) | `channel:"Catalog"` | 400 | ✅ 400 — `channel must be one of Online, Store` |
| P-04 | UPDATE | `PATCH /RewardPolicies(policyID=…) {rate:0.04}` | 200 — cache reloaded | ✅ 200 — subsequent purchases earn at 0.04 (rate restored to 0.03 after) |
| P-05 | READ (staff) | `GET /RewardPolicies` (bob) | 200 — staff read-only | ✅ 200 |
| P-06 | CREATE (staff) | `POST` as bob | 403 | ✅ 403 Forbidden |

## TierThresholds (admin-only)

| # | Operation | Request | Expected | Actual |
|---|-----------|---------|----------|--------|
| H-01 | READ | `GET /TierThresholds` (admin) | 200 — Bronze/Silver/Gold | ✅ 200 |
| H-02 | CREATE | `{tier:"Harness", minLifetimePoints:10}` | 201 + tier recompute | ✅ 201 — customer with lifetime ≥ 10 became tier `Harness` |
| H-03 | READ (verify) | customer by key | tier `Harness` | ✅ 200 — `"tier":"Harness"` |
| H-04 | UPDATE | `{minLifetimePoints:500000}` | 200 + recompute | ✅ 200 |
| H-05 | READ (verify) | customer by key | tier back to `Bronze` | ✅ 200 — `"tier":"Bronze"` |
| H-06 | DELETE | `DELETE /TierThresholds(tier='Harness')` | 204 cleanup | ✅ 204 |
| H-07 | READ (staff) | as bob | 403 | ✅ 403 Forbidden |

## Function

| # | Operation | Request | Expected | Actual |
|---|-----------|---------|----------|--------|
| U-01 | FUNCTION | `GET /getUserInfo()` as alice | 200 — flags + pointValueInr | ✅ 200 — `email:"alice@example.com"`, `pointValueInr:0.5` |

## Cross-role (customer context — alice)

| # | Operation | Request | Expected | Actual |
|---|-----------|---------|----------|--------|
| X-01 | CREATE (foreign) | purchase for another customer | 403 — ownership precedes validation | ✅ 403 — `Customers may only act on their own account` |
| X-02 | CREATE (duplicate) | re-register `alice@example.com` | 409 | ✅ 409 — `An account for alice@example.com already exists` |
| X-03 | CREATE (foreign) | redemption for another customer | 403 | ✅ 403 |
| X-04 | CREATE (own) | purchase for own seeded account | 201 | ✅ 201 — 5 pts for ₹100 Online |

## Issues found by this matrix (fixed during the run)

1. **Ownership guard ordering** — a customer posting a purchase/redemption for a
   foreign account received the handler's `400 No customer found` instead of
   `403`: the validation hook in `handlers/transaction.js` ran before the role
   guard in `service.js` (two competing `before CREATE` hooks). Fixed by moving
   the guard into `srv/lib/ownership.js` and invoking it **first** in both
   handler hooks; also covers Redemptions now.
2. **No field validation on Customer CREATE** — `{name:"", email:"x"}` was
   accepted (201). Fixed: `srv/service.js` rejects empty name (400) and
   invalid email (400); staff/admin onboarding also gets the 409 duplicate
   check now.
3. **Duplicate policy channel surfaced a raw 500** (`SQLITE_CONSTRAINT_UNIQUE`;
   would be an HANA constraint error in production). Fixed: explicit 409 in
   `handlers/policy.js`.
4. `RewardPolicies` PATCH/DELETE are keyed by surrogate `policyID` (channel is
   unique but not the key) — corrected in the harness and documented here.
