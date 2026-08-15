const policyCache = require('../lib/policy-cache')
const { computeTier } = require('../lib/tier')
const { VALID_CHANNELS } = require('../lib/channels')
const { POINT_VALUE_INR } = require('../lib/point-value')
const { assertOwnCustomer } = require('../lib/ownership')

module.exports = (srv) => {
  const { Transactions, Customers, Redemptions } = srv.entities

  srv.before('CREATE', Transactions, async (req) => {
    // ownership FIRST: a customer acting on a foreign account gets 403 before
    // any validation reveals whether that account exists
    await assertOwnCustomer(srv)(req)
    const { channel } = req.data
    const customerKey = req.data.customerID_customerID

    if (!VALID_CHANNELS.includes(channel)) {
      return req.reject(400, `channel must be one of ${VALID_CHANNELS.join(', ')}`, 'channel')
    }
    if (!customerKey) {
      return req.reject(400, 'customerID is required', 'customerID')
    }

    // price: the product list price; amount (cash payable) is derived below.
    // Older clients that still send only `amount` are treated as full-cash
    // purchases (price = amount).
    const rawPrice = Number(req.data.price ?? req.data.amount)
    const pointsApplied = Number(req.data.pointsApplied ?? 0)
    if (!(rawPrice > 0)) {
      return req.reject(400, 'price must be greater than 0', 'price')
    }
    if (!Number.isInteger(pointsApplied) || pointsApplied < 0) {
      return req.reject(400, 'pointsApplied must be a non-negative integer', 'pointsApplied')
    }

    // Denominate the price on the ₹0.50 grid so the payable never carries an
    // odd fraction: 1 point already covers exactly ₹0.50, so price ∥ 0.5 and
    // points × 0.5 keep the payable on the grid as well.
    const price = Math.floor(rawPrice * 2) / 2

    const customer = await srv.run(SELECT.one.from(Customers).where({ customerID: customerKey }))
    if (!customer) {
      return req.reject(400, `No customer found for ${customerKey}`, 'customerID')
    }
    if (pointsApplied > customer.totalPoints) {
      return req.reject(400, `Insufficient points: customer has ${customer.totalPoints}, tried to apply ${pointsApplied}`, 'pointsApplied')
    }
    const maxByPrice = Math.floor(price / POINT_VALUE_INR)
    if (pointsApplied > maxByPrice) {
      return req.reject(400, `Points exceed purchase value: at most ${maxByPrice} points can be applied to ₹${price}`, 'pointsApplied')
    }

    const amount = price - pointsApplied * POINT_VALUE_INR // always a ₹0.50 multiple
    const rate = policyCache.rateFor(channel)
    const pointsEarned = Math.floor(amount * rate)

    req.data.price = price
    req.data.pointsApplied = pointsApplied
    req.data.amount = amount
    req.data.pointsEarned = pointsEarned
    req.data.txnDate = req.data.txnDate || new Date().toISOString()

    // Points applied as part-payment: record the redemption side of the
    // purchase. Plain INSERT (like the UPDATE below) targets cds.db directly —
    // inside this request's transaction and without re-running the Redemptions
    // handler (which would double-deduct the customer's balance).
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

    // Bare UPDATE (not srv.run/srv.tx) targets cds.db directly, inside the current
    // request's own transaction — no nested transaction (which deadlocked against
    // sqlite's single connection), and no @restrict check (this is internal system
    // logic triggered by an already-authorized Transaction CREATE; no role is
    // granted direct Customer-write in srv/service.cds, so all point changes are
    // forced through this validated path).
    //
    // Concurrency: the balance mutation is a single atomic UPDATE with a
    // `totalPoints >= pointsApplied` guard, computed by the database
    // (totalPoints = totalPoints - applied + earned) — NOT a read-modify-write
    // of the value fetched above. Two concurrent purchases therefore cannot
    // double-spend the same points: the loser's guard matches 0 rows and the
    // request is rejected. On SAP HANA the row lock + re-evaluated WHERE make
    // this safe under read-committed isolation. The friendly pre-checks above
    // remain for precise error messages; this guard is the correctness backstop.
    const rows = await UPDATE(Customers)
      .where({ customerID: customerKey })
      .and('totalPoints >=', pointsApplied)
      .set({
        totalPoints: { xpr: [{ ref: ['totalPoints'] }, '-', { val: pointsApplied }, '+', { val: pointsEarned }] },
        lifetimePoints: { xpr: [{ ref: ['lifetimePoints'] }, '+', { val: pointsEarned }] },
        tier: newTier
      })
    if (rows !== 1) {
      return req.reject(400, `Insufficient points: balance changed concurrently, retry the purchase`, 'pointsApplied')
    }
  })
}
