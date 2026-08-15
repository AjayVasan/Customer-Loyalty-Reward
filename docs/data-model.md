# Data Model Design

Source of truth for the persistence model: [`db/schema.cds`](../db/schema.cds), namespace `loyalty`.
This document maps the **specification (txt.md) to the implementation** — every specified
attribute is present; additions are marked as extensions.

## Spec conformance — Customer

| Spec attribute (txt.md) | Type (spec) | Implementation (`loyalty.Customer`) | Status |
|---|---|---|---|
| customerID | UUID, PK | `key customerID : UUID` | ✅ as specified |
| name | String | `name : String(120)` | ✅ as specified (length-bound) |
| email | String | `email : String(254)` | ✅ as specified (RFC 5321 max length) |
| totalPoints | Integer | `totalPoints : Integer default 0` | ✅ as specified |
| tier | String | `tier : String(10) default 'Bronze'` | ✅ as specified |

**Extensions:** `lifetimePoints : Integer` (never-decreasing earn counter — drives tier
promotion, since `totalPoints` drops on redemption and must not demote tiers),
`transactions`/`redemptions` associations, `managed` aspect (createdAt/… audit columns).

## Spec conformance — Transaction

| Spec attribute (txt.md) | Type (spec) | Implementation (`loyalty.Transaction`) | Status |
|---|---|---|---|
| txnID | UUID, PK | `key txnID : UUID` | ✅ as specified |
| customerID | Association to Customer | `customerID : Association to Customer` | ✅ as specified |
| channel | String ("Online"/"Store") | `channel : String(10) enum { Online; Store }` | ✅ as specified (+ runtime validation) |
| amount | Decimal(10,2) | `amount : Decimal(10,2)` | ✅ as specified — **derived**: cash payable after points |
| txnDate | DateTime | `txnDate : DateTime` | ✅ as specified (server-stamped) |
| pointsEarned | Integer | `pointsEarned : Integer default 0` | ✅ as specified — server-computed |

**Extensions:** `price : Decimal(10,2)` (product list price — `amount = price − pointsApplied × point value`),
`pointsApplied : Integer` (reward points used as part-payment; each point covers ₹0.50).
A purchase that applies points also writes a matching `Redemption` row, so channel
part-payments and standalone redemptions share one audit trail.

## Spec conformance — Redemption

| Spec attribute (txt.md) | Type (spec) | Implementation (`loyalty.Redemption`) | Status |
|---|---|---|---|
| redeemID | UUID, PK | `key redeemID : UUID` | ✅ as specified |
| customerID | Association to Customer | `customerID : Association to Customer` | ✅ as specified |
| pointsUsed | Integer | `pointsUsed : Integer` | ✅ as specified (positive, ≤ balance — validated) |
| redeemDate | DateTime | `redeemDate : DateTime` | ✅ as specified (server-stamped) |
| remarks | String | `remarks : String(255)` | ✅ as specified |

## Configuration entities (extension — required by the Admin role)

| Entity | Purpose | Key fields |
|---|---|---|
| `loyalty.RewardPolicy` | Admin-defined earn rate per channel, e.g. **₹1 = 0.05 points** (txt.md Admin example) | `channel` (unique), `pointsPerCurrencyUnit : Decimal(5,2)` |
| `loyalty.TierThreshold` | Admin-defined tier promotion rules | `key tier`, `minLifetimePoints : Integer` |

Seed data: [`db/data/`](../db/data) — Online 0.05/₹, Store 0.03/₹; Bronze 0 / Silver 5,000 / Gold 20,000.

## Point arithmetic (invariants, enforced in `srv/handlers/`)

- `pointsEarned = floor(amount × policyRate(channel))` — Online earns more, promoting digital adoption (txt.md business reason).
- `amount = price − pointsApplied × ₹0.50`; price is denominated on the ₹0.50 grid, so `amount` never carries an odd fraction.
- Balance mutation is a **single atomic guarded UPDATE** (`totalPoints = totalPoints − used + earned`
  with a `totalPoints >= used` WHERE-guard) — concurrent purchases/redemptions can never overspend or go below zero (txt.md: "ensuring points don't go below zero").
- Tier is re-derived from `lifetimePoints` on every earn **and** whenever an admin changes a `TierThreshold`.

## Deployment on SAP HANA

- Development/tests run on in-memory SQLite (`[development]`/`[test]` profiles).
- Production (`[production]` profile) uses **SAP HANA Cloud via `@cap-js/hana`**; the MTA
  (`mta.yaml`) provisions an HDI container (`loyalty-rewards-db`) and the db-deployer pushes
  the schema as design-time artifacts. The atomic balance UPDATE compiles to a plain SQL
  `UPDATE … WHERE totalPoints >= ?`, which HANA executes safely under row locking.
- See [deployment.md](deployment.md) for the full BTP flow.

## Entity-relationship sketch

```
Customer 1 ──── * Transaction      (customerID)
Customer 1 ──── * Redemption       (customerID)
RewardPolicy (per channel)         TierThreshold (per tier)
```
