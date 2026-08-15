# High-Level Flow Diagram

Mermaid source; renders on GitHub, VS Code (with a mermaid plugin), mermaid.live, and most markdown viewers.

```mermaid
flowchart TD
    U([User opens the app URL]) --> AR

    subgraph EDGE["Cloud Foundry edge"]
        AR["approuter<br/>(login + routing)"]
        AR -->|"XSUAA redirect, SAML/JWT"| IDP(("SAP IdP"))
        IDP -->|"JWT with email + role collection"| AR
    end

    AR -->|"authenticated"| UI["html5-apps-repo<br/>loyaltydashboard / 4 admin apps / apitestharness"]
    UI --> ODATA["OData V4 /odata/v4/loyalty<br/>($batch + CSRF token)"]

    subgraph CAP["CAP service (srv)"]
        ODATA --> GUI["getUserInfo()"]
        GUI --> AUTO{"customer record<br/>exists for email?"}
        AUTO -->|"no"| ONBOARD["auto-onboard:<br/>create Customer (Bronze, 0 pts)"]
        ONBOARD --> RESP["identity + role flags + pointValueInr"]
        AUTO -->|"yes"| RESP

        RESP --> TABS{{"UI opens on the strongest role's tab"}}

        TABS -->|Customer| CFLOW
        TABS -->|Staff| SFLOW
        TABS -->|Admin| AFLOW

        subgraph CFLOW["Customer: My Account"]
            C1["register purchase or redeem<br/>(channel, price, optional points)"]
        end
        subgraph SFLOW["Staff: Staff Operations"]
            S1["search by email<br/>→ identity + balance + tier only"]
            S2["onboard new customer<br/>or record purchase"]
        end
        subgraph AFLOW["Admin: Admin Console"]
            A1["KPIs + lookup 360<br/>(email or UUID)"]
            A2["edit RewardPolicy / TierThreshold"]
        end

        C1 --> GUARD
        S2 --> GUARD
        GUARD{"ownership guard<br/>(before validation)"}
        GUARD -->|"foreign account"| R403["403, no existence hint"]
        GUARD -->|"own / staff / admin"| ENGINE

        subgraph ENGINE["purchase engine (one DB transaction)"]
            E1["floor price to ₹0.50 grid"] --> E2
            E2{"points applied?"}
            E2 -->|"yes"| E3["payable = price − pts × ₹0.50<br/>write auto Redemption row"]
            E2 -->|"no"| E4["payable = price"]
            E3 --> E4X["pointsEarned = floor(payable × rate)"]
            E4 --> E4X
            E4X --> E5["guarded UPDATE:<br/>totalPoints ± pts WHERE balance ≥ used<br/>lifetimePoints += earned"]
            E5 --> E6["re-derive tier from lifetimePoints"]
        end

        S1 --> READ["read Customers (identity scope)"]
        A1 --> READALL["read Transactions + Redemptions"]
        A2 --> CACHE["write-through cache:<br/>reload rates/thresholds in-request;<br/>threshold change → re-derive all tiers"]
    end

    E5 --> DB[("HANA Cloud (prod)<br/>SQLite (dev/tests)")]
    E6 --> OK["201 + toast:<br/>earned points, refreshed balance"]
    CACHE --> DB
```

Reading it top to bottom: every request is authenticated at the edge; the UI learns who it is serving from `getUserInfo()`; all money-moving paths funnel through the same guarded purchase engine, and config edits take effect immediately through the write-through cache.
