const policyCache = require('../lib/policy-cache')
const { computeTier } = require('../lib/tier')
const { VALID_CHANNELS } = require('../lib/channels')
const { POINT_VALUE_INR } = require('../lib/point-value')

module.exports = (srv) => {
  const { Transactions, Customers, Redemptions } = srv.entities

  srv.before('CREATE', Transactions, async (req) => {
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
    await UPDATE(Customers, customerKey).set({
      totalPoints: customer.totalPoints - pointsApplied + pointsEarned,
      lifetimePoints: newLifetimePoints,
      tier: newTier
    })
  })
}
