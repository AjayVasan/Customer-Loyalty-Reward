# High-Level Flow Diagram

Mermaid source with color-coded lanes: blue for the authentication edge, green for
the UI shell, teal for customer actions, orange for staff, purple for admin, red for
the ownership guard, pink for the purchase engine, amber for configuration, grey for
the database. The thick dark edges mark the money path. No icons or emoji, it stays
clean in print and in Word. Renders on GitHub and VS Code (mermaid plugin), or paste
into mermaid.live to export yourself.

Ready-made export of exactly this diagram: [flow-diagram.png](flow-diagram.png)
(rendered at high resolution, drop straight into Word or PDF).

```mermaid
flowchart TD
    %%{init: {"flowchart": {"curve": "basis"}} }%%

    U([User opens the app URL]):::auth
    AR["approuter<br/>login + routing"]:::auth
    IDP(("SAP Identity Service<br/>XSUAA")):::auth

    APP["loyaltydashboard (UI5)<br/>opens on the strongest role tab"]:::ui
    GUI["getUserInfo()<br/>identity + role flags + pointValueInr"]:::ui
    NEW{"customer record<br/>for this email?"}:::ui
    ONB["auto-onboard<br/>Bronze, 0 points"]:::ui

    C1["My Account<br/>balance, tier, history"]:::cust
    C2["register purchase<br/>or redeem points"]:::cust
    S1["find customer by email<br/>identity + balance + tier only"]:::staff
    S2["record purchase<br/>or onboard new customer"]:::staff
    A1["program KPIs<br/>customer 360 lookup"]:::admin
    A2["edit reward policy<br/>or tier threshold"]:::admin

    OWNS{"ownership guard<br/>runs before validation"}:::guard
    F403["403 rejected<br/>no account-existence hint"]:::guard

    GRID["floor price to the 0.50 grid"]:::engine
    COMPUTE["payable = price minus points x 0.50<br/>pointsEarned = floor(payable x channel rate)<br/>auto Redemption row when points used"]:::engine
    UPD["guarded UPDATE<br/>balance = balance - used + earned<br/>WHERE balance >= used"]:::engine
    TIER["re-derive tier<br/>from lifetimePoints"]:::engine
    OK([201: toast with earned points,<br/>refreshed balance]):::done

    CACHE["write-through cache<br/>rates + thresholds reloaded in-request"]:::config
    RETIER["re-derive every<br/>customer tier"]:::config
    DB[("HANA Cloud (production)<br/>SQLite (dev and tests)")]:::data

    U --> AR
    AR -- "redirect to login" --> IDP
    IDP -- "JWT: email + role collection" --> AR
    AR -- "authenticated session" --> APP
    APP -- "startup call" --> GUI
    GUI --> NEW
    NEW -- "no account yet" --> ONB
    ONB --> TAB{{"role routing"}}:::ui
    NEW -- "existing customer" --> TAB
    TAB -- Customer --> C1
    TAB -- Staff --> S1
    TAB -- Admin --> A1
    C1 --> C2
    S1 --> S2
    C2 --> OWNS
    S2 --> OWNS
    OWNS -- "foreign customerID" --> F403
    OWNS -- "own account, or staff/admin" --> GRID
    GRID --> COMPUTE
    COMPUTE --> UPD
    UPD --> TIER
    TIER --> OK
    UPD --> DB
    A1 -- "reads" --> DB
    A2 -- "config write" --> CACHE
    CACHE -. "reload, same request" .-> DB
    CACHE -- "threshold changed" --> RETIER
    RETIER -- "UPDATE all tiers" --> DB
    CACHE -. "next purchase uses new rate" .-> COMPUTE

    linkStyle 14,15,17,18,19,20,21 stroke:#9F1239,stroke-width:3px

    classDef auth fill:#DBEAFE,stroke:#1D4ED8,stroke-width:1.5px,color:#1E3A8A
    classDef ui fill:#DCFCE7,stroke:#15803D,stroke-width:1.5px,color:#14532D
    classDef cust fill:#CCFBF1,stroke:#0F766E,stroke-width:1.5px,color:#134E4A
    classDef staff fill:#FFEDD5,stroke:#C2410C,stroke-width:1.5px,color:#7C2D12
    classDef admin fill:#EDE9FE,stroke:#6D28D9,stroke-width:1.5px,color:#4C1D95
    classDef guard fill:#FEE2E2,stroke:#B91C1C,stroke-width:1.5px,color:#7F1D1D
    classDef engine fill:#FCE7F3,stroke:#BE185D,stroke-width:1.5px,color:#831843
    classDef config fill:#FEF3C7,stroke:#B45309,stroke-width:1.5px,color:#78350F
    classDef data fill:#E5E7EB,stroke:#374151,stroke-width:1.5px,color:#111827
    classDef done fill:#D1FAE5,stroke:#047857,stroke-width:2px,color:#064E3B
```

How to read it: top to bottom. Every request is authenticated at the blue edge and
the UI learns who it is serving from the green startup call. The three role lanes
(teal, orange, purple) converge on the red ownership guard; anything that passes it
flows through the pink purchase engine in one database transaction, along the thick
dark edges. Amber is the only path that changes program rules, and it feeds the pink
engine through the write-through cache without a restart.
