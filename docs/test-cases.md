# Test Case Sheet

Automated suite: `npm test` (`test/loyalty.test.js`, node --test + @cap-js/cds-test,
in-memory SQLite, basic-auth mock users **alice**=customer, **bob**=staff, **carol**=admin — all password `pass`).
Interactive CRUD matrix (browser): `http://localhost:4004/apitestharness/index.html`
(`app/api-test-harness`, dev-only — not part of the MTA). Executed results with
actual responses: [crud-test-results.md](crud-test-results.md) (38/38).

## Automated cases

| # | Area | Scenario | Expected | Test |
|---|---|---|---|---|
| 1 | Points | Online purchase ₹1,000 | pointsEarned 50 (×0.05); balance 50; lifetime 50; tier Bronze | `points engine › earns online…` |
| 2 | Points | Store purchase ₹500 | pointsEarned 15 (×0.03) | `points engine › earns store…` |
| 3 | Points | Purchase ₹500 applying 20 pts | amount 490; earned 14; balance 50−20+14=44; Redemption row (20 pts) auto-written | `points engine › applies points…` |
| 4 | Validation | channel "Phone" / unknown customer / overspending pointsApplied | 400 with field error | `points engine › rejects invalid…` |
| 5 | Redemption | Redeem 51 of 50 / redeem 30 of 50 | 400 rejection / balance 20 | `points engine › rejects redemptions…` |
| 6 | Tier | Lifetime crosses 5,000 | tier Silver | `points engine › promotes tier…` |
| 7 | Tier | Admin adds/removes threshold above a customer's lifetime | all tiers recomputed immediately, and restored | `points engine › recomputes existing tiers…` |
| 8 | Concurrency | Two parallel full-balance redemptions | exactly one 201; balance 0, never negative | `concurrency guard › …` |
| 9 | API | getUserInfo | role flags correct; `pointValueInr` 0.5 from server | `role guards › returns role flags…` |
| 10 | AuthZ | Customer posts purchase for another customer | 400/403 rejected; own account accepted | `role guards › forbids customers…` |
| 11 | AuthZ | Customer onboards foreign/duplicate email | 403 / 409 rejected | `role guards › forbids customers from onboarding…` |
| 12 | AuthZ | Staff reads/writes Redemptions and Policies | read Redemptions 403; read Policies 200; write Policies 403 | `role guards › hides redemptions…` |

## Manual UI cases (dashboard, `cds watch` → login alice / bob / carol)

| # | Role | Scenario | Expected |
|---|---|---|---|
| M1 | customer | First login | Loyalty account auto-created; welcome toast; My Account tab active |
| M2 | customer | Purchase form: enter price, tweak points | Live hint shows rate, ₹0.50-grid price, covered amount, payable, earned pts |
| M3 | customer | Redeem points | Balance drops; redemption appears in history; toast confirms |
| M4 | staff | Search customer by email | Identity card shown; no purchase history; unknown email → message |
| M5 | staff | Record purchase for searched customer | Points toast; customer balance refreshes; KPI tiles update incl. **Purchases today** |
| M6 | staff | Add new customer | Created, selected for purchase entry, KPI Customers +1 |
| M7 | admin | Lookup by UUID or email | Full 360: purchases + redemptions tables |
| M8 | admin | Change policy rate / thresholds | Saved; rate hints re-derive; existing tiers recompute (test 7 automates the backend part) |
| M9 | admin | KPI strip | Customers, Issued Online/Store, Redeemed, Purchases, **Outstanding points** = Σ balances |
| M10 | any | Locale ≠ en | No raw `kpiXxx` keys anywhere (single complete i18n bundle) |
