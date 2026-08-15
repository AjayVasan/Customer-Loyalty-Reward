# Data Model / ER Diagram

Mermaid `erDiagram` source; renders on GitHub, VS Code (mermaid plugin), mermaid.live, and most markdown viewers. Attribute types as in `db/data-model.cds` (all entities also carry CAP `managed` fields: createdAt, createdBy, modifiedAt, modifiedBy).

Ready-made export: [er-diagram.png](er-diagram.png) (high resolution, drop straight
into Word or PDF).

```mermaid
erDiagram
    CUSTOMER ||--o{ TRANSACTION : "makes"
    CUSTOMER ||--o{ REDEMPTION : "redeems"
    REWARD_POLICY {
        UUID policyID PK
        String channel "Online | Store, unique"
        Decimal pointsPerCurrencyUnit "points per ₹1: 0.05 / 0.03"
    }
    TIER_THRESHOLD {
        String tier PK "Bronze / Silver / Gold / Platinum"
        Integer minLifetimePoints "0 / 5,000 / 20,000 / 50,000"
    }
    CUSTOMER {
        UUID customerID PK
        String name
        String email "unique, login identity"
        Integer totalPoints "spendable balance, guarded UPDATE only"
        Integer lifetimePoints "never decreases, drives tier"
        String tier "derived, never user input"
    }
    TRANSACTION {
        UUID txnID PK
        UUID customerID FK
        String channel "Online | Store"
        Decimal price "list price, floored to ₹0.50 grid"
        Integer pointsApplied "part-payment points"
        Decimal amount "cash payable = price − applied × ₹0.50"
        DateTime txnDate
        Integer pointsEarned "floor(amount × channel rate)"
    }
    REDEMPTION {
        UUID redeemID PK
        UUID customerID FK
        Integer pointsUsed
        DateTime redeemDate
        String remarks "auto remark for part-payments"
    }

    REWARD_POLICY ||..o{ TRANSACTION : "rate used per channel (via write-through cache)"
    TIER_THRESHOLD ||..o{ CUSTOMER : "tier derived from lifetimePoints"
```

Notes that the diagram cannot say by itself:

- `totalPoints` and `lifetimePoints` split spendable from historical: redeeming drops the first, never the second, so tiers never demote on redemption.
- `Transaction` and `Redemption` are an append-only ledger: the service rejects PATCH and DELETE for every role; balances only move through the guarded business handlers.
- Part-payments write both a Transaction (`pointsApplied` set) and an auto-generated Redemption row with remark `Applied to purchase (₹X → payable ₹Y)`, which is why the two entities share one audit trail.
- `RewardPolicy` and `TierThreshold` are configuration, not master data: one row per channel and one per tier, edited by admin only, read by the service through the write-through cache (never joined per purchase).
