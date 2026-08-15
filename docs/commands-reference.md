# Commands & Sample Outputs

Every command used to develop, test, and deploy this project, with real
sample output from the runs on 2026-08-15. File paths are relative to the
project root.

## 1. Install

```bash
npm install          # root + app/* workspaces
```
```
added 1 package in 2s
```

## 2. Local development — `cds watch`

```bash
npm run watch         # = cds watch
```
```
[cds] - loaded model from 8 file(s)

  loyalty-rewards
  [cds] - serving CatalogService { at: '/odata/v4/catalog' }
  [cds] - serving LoyaltyService   { at: '/odata/v4/loyalty' }
  [cds-plugin-ui5] - Mounting /loyaltydashboard to UI5 app ../app/loyalty-dashboard (id=loyalty-dashboard)
  [cds-plugin-ui5] - Mounting /apitestharness to UI5 app ../app/api-test-harness (id=api-test-harness)
  [cds] - server listening on { url: 'http://localhost:4004' }
```
URLs (basic auth, mock users — carol admin · bob staff · alice customer,
password `pass`):
- Dashboard UI — http://localhost:4004/loyaltydashboard/index.html
- CRUD test harness — http://localhost:4004/apitestharness/index.html
- Service — http://localhost:4004/odata/v4/loyalty

## 3. Backend tests

```bash
npm test              # node --test via @cap-js/cds-test, [test] profile
```
```
ℹ tests 12
ℹ suites 3
ℹ pass 12
ℹ fail 0
ℹ duration_ms 853.9
```

## 4. CRUD smoke checks (curl)

Full matrix: `docs/crud-test-results.md`. Representative calls:

```bash
# read with auth
curl -u carol:pass "$U/Customers?\$top=2"          # U=http://localhost:4004/odata/v4/loyalty
# -> 200 {"@odata.context":"$metadata#Customers","value":[…]}
curl -u alice:pass "$U/Customers?\$top=1"           # -> 403 (alice may read only her own row)
curl "$U/getUserInfo()"                             # -> 401 anonymous

# CSRF token for writes
T=$(curl -s -u carol:pass -H "x-csrf-token: fetch" -o /dev/null -D - "$U/Customers?\$top=1" \
    | grep -i x-csrf | tr -d '\r' | awk '{print $2}')

# create purchase (points engine: floor(1000 × 0.05) = 50 pts)
curl -X POST -u carol:pass -H "x-csrf-token: $T" -H "Content-Type: application/json" \
  -d '{"customerID_customerID":"<uuid>","channel":"Online","price":1000}' "$U/Transactions"
# -> 201 … "amount":1000,"pointsEarned":50

# part-payment: price 500 with 20 points → payable 490, 14 pts earned
#   → 201 "amount":490,"pointsEarned":14 + auto Redemption row

# ownership guard (alice → foreign customer)
curl -X POST -u alice:pass … -d '{"customerID_customerID":"<other-uuid>","channel":"Online","price":100}' "$U/Transactions"
# -> 403 {"message":"Customers may only act on their own account"}

# aggregate (KPI tiles use the same shape)
curl -u carol:pass "$U/Transactions?\$apply=groupby((channel),aggregate(pointsEarned%20with%20sum%20as%20total))"
# -> 200 {"value":[{"total":60,"channel":"Online"},{"total":14,"channel":"Store"}]}
```

## 5. Build (MBT)

```bash
npm run build         # = mbt build
```
```
[2026-08-15 09:43:36]  INFO the MTA archive generated at: …/mta_archives/archive.mtar
```
The archive contains 44 HANA HDI artifacts for `loyalty-rewards-db-deployer`
(`src/gen/*.hdbtable/.hdbview/.hdbsynonym` — CAP `cds build --production`
HANA target).

## 6. Deploy to SAP BTP CF (HANA)

```bash
npm run deploy        # = cf deploy mta_archives/archive.mtar -f
cf target             # api.cf.us10-001.hana.ondemand.com, org 9231c958trial, space dev
```
```
Binding service instance "loyalty-rewards-auth" to application "loyalty-rewards"…
Application "loyalty-rewards-srv" started and available at
  "9231c958trial-dev-loyalty-rewards-srv.cfapps.us10-001.hana.ondemand.com"
Process finished.
```
Post-deploy verification:
```bash
cf services | grep loyalty
```
```
loyalty-rewards-auth             xsuaa           application  … create succeeded
loyalty-rewards-db               hana            hdi-shared   … create succeeded
loyalty-rewards-html5-repo-host  html5-apps-repo app-host     … create succeeded
loyalty-rewards-html5-runtime    html5-apps-repo app-runtime  … create succeeded
loyalty-rewards-destination-…    destination     lite         … create succeeded
```
```bash
cf logs --recent loyalty-rewards-db-deployer | grep -a "Starting make\|Exit"
```
```
[APP/TASK/deploy/0] OUT Starting make in the container "4063…" with 0 files to deploy…
[APP/TASK/deploy/0] OUT Exit status 0
```
(schema unchanged since the previous push — 44 files were in sync;
handlers/UI changes only redeploy the srv module)

```bash
curl -o /dev/null -w "%{http_code}\n" https://…-loyalty-rewards-srv.cfapps.us10-001.hana.ondemand.com/odata/v4/loyalty/\$metadata
# -> 401 (XSUAA JWT required — anonymous access denied)
curl -o /dev/null -w "%{http_code}\n" https://9231c958trial-dev-loyalty-rewards.cfapps.us10-001.hana.ondemand.com/
# -> 302 (approuter redirects to the login page)
```

## 7. Undeploy (when needed)

```bash
npm run undeploy      # = cf undeploy loyalty-rewards -f --delete-services
```

## Notes

- `cds watch` hot-reloads on file save; the dev DB is **in-memory SQLite**
  (fresh seed per restart) — production uses the **SAP HANA HDI container**
  exclusively (`[production]` profile + `loyalty-rewards-db` binding).
- Trial-quota tip: this space also hosts unrelated apps (`basic-*`, `Hon*`);
  stop them with `cf stop <app>` if the trial runs out of memory.
