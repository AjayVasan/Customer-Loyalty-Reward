# Deployment — SAP BTP Cloud Foundry (SAP HANA Cloud)

The MTA descriptor `mta.yaml` assembles the full stack. Prerequisites: CF CLI with
`cf login` to your subaccount, and an entitlement for SAP HANA Cloud (or use an
existing instance by binding instead of provisioning).

## One-command flow

```bash
npm install
npm run build     # rimraf + mbt build --mtar archive  → mta_archives/archive.mtar
npm run deploy    # cf deploy mta_archives/archive.mtar --retries 1
```

## What the MTA creates

| Module / resource | Purpose |
|---|---|
| `loyalty-rewards-db` (SAP HANA SaaS service, HDI) | **SAP HANA Cloud** database container — the production persistence |
| `loyalty-rewards-db-deployer` | Pushes `gen/db` design-time artifacts (schema from `db/schema.cds`) into the HDI container |
| `loyalty-rewards-srv` | Node.js CAP service (`gen/srv`), bound to the HDI container and to XSUAA; `cds build --for nodejs` output |
| `loyalty-rewards-uaa` (XSUAA) | Roles `admin`, `staff`, `customer` from `xs-security.json`; assign them to users in the BTP cockpit (role collections of the same names) |
| `loyalty-rewards-html5-repo-host` + `-app-deployer` | Hosts the built Fiori UIs (`gen/app`) |
| `loyalty-rewards-destination` / `-connectivity` | App router dependencies for the HTML5 runtime |
| App Router (`app/router`) | Entry point; routes `/odata/*` to the srv, serves the HTML5 apps, CSRF-protects mutations |

After deployment the approuter route is available under your subaccount's HTML5 apps;
log in with an IdP user who has the role collections above.

## Verifying the deployment

1. Open the deployed dashboard URL → login → role chip shows Admin/Staff/Customer.
2. Record a purchase as staff; confirm the customer's balance/tier change.
3. In BTP cockpit → SAP HANA Cloud → open the HDI container (SAP HANA Database Explorer)
   to inspect `LOYALTY_CUSTOMER` / `LOYALTY_TRANSACTION` / `LOYALTY_REDEMPTION` rows.

## Teardown

```bash
npm run undeploy   # cf undeploy loyalty-rewards --delete-services --delete-service-keys --delete-service-brokers
```

## Local vs production configuration

| Concern | Local (`cds watch`) | Production |
|---|---|---|
| Database | in-memory SQLite, CSV seeds, disposable | SAP HANA Cloud HDI container |
| Auth | `kind: basic` mock users (alice/bob/carol, password `pass`) | XSUAA with role collections |
| Point value / policies | same code paths — server-owned | same |
