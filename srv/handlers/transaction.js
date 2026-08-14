const policyCache = require('../lib/policy-cache')
const { computeTier } = require('../lib/tier')
const { VALID_CHANNELS } = require('../lib/channels')

module.exports = (srv) => {
  const { Transactions, Customers } = srv.entities

  srv.before('CREATE', Transactions, async (req) => {
    const { channel, amount } = req.data
    const customerKey = req.data.customerID_customerID

    if (!VALID_CHANNELS.includes(channel)) {
      return req.reject(400, `channel must be one of ${VALID_CHANNELS.join(', ')}`, 'channel')
    }
    if (!customerKey) {
      return req.reject(400, 'customerID is required', 'customerID')
    }
    if (!(Number(amount) > 0)) {
      return req.reject(400, 'amount must be greater than 0', 'amount')
    }

    const customer = await srv.run(SELECT.one.from(Customers).where({ customerID: customerKey }))
    if (!customer) {
      return req.reject(400, `No customer found for ${customerKey}`, 'customerID')
    }

    const rate = policyCache.rateFor(channel)
    const pointsEarned = Math.floor(Number(amount) * rate)
    req.data.pointsEarned = pointsEarned
    req.data.txnDate = req.data.txnDate || new Date().toISOString()

    const newLifetimePoints = customer.lifetimePoints + pointsEarned
    const newTier = computeTier(newLifetimePoints, policyCache.getThresholds())

    // Bare UPDATE (not srv.run/srv.tx) targets cds.db directly, inside the current
    // request's own transaction — no nested transaction (which deadlocked against
    // sqlite's single connection), and no @restrict check (this is internal system
    // logic triggered by an already-authorized Transaction CREATE; no role is
    // granted direct Customer-write in srv/service.cds, so all point changes are
    // forced through this validated path).
    await UPDATE(Customers, customerKey).set({
      totalPoints: customer.totalPoints + pointsEarned,
      lifetimePoints: newLifetimePoints,
      tier: newTier
    })
  })
}
