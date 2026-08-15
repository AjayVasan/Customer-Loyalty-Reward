const policyCache = require('../lib/policy-cache')
const { VALID_CHANNELS } = require('../lib/channels')
const { computeTier } = require('../lib/tier')

module.exports = (srv) => {
  const { RewardPolicies, TierThresholds, Customers } = srv.entities

  srv.before(['CREATE', 'UPDATE'], RewardPolicies, async (req) => {
    const { channel } = req.data
    // CDS `enum` on RewardPolicy.channel only documents the allowed set in $metadata — it
    // does not reject invalid values at runtime, so this handler is the actual enforcement
    // (same list Transaction.channel validates against, so a policy can't be created for a
    // channel purchases could never use).
    if (channel !== undefined && !VALID_CHANNELS.includes(channel)) {
      return req.reject(400, `channel must be one of ${VALID_CHANNELS.join(', ')}`, 'channel')
    }
    // one policy per channel: surface the unique constraint as a clean 409
    // instead of a raw 500 SQLITE/HANA constraint error
    if (channel !== undefined) {
      const dup = await SELECT.one.from(RewardPolicies)
        .where({ channel })
        .columns('policyID')
      if (dup && dup.policyID !== req.data.policyID) {
        return req.reject(409, `A reward policy for channel ${channel} already exists`)
      }
    }
  })

  srv.after(['CREATE', 'UPDATE', 'DELETE'], RewardPolicies, async () => {
    await policyCache.load(srv)
  })
  srv.after(['CREATE', 'UPDATE', 'DELETE'], TierThresholds, async () => {
    await policyCache.load(srv)
    // A changed threshold changes what existing lifetime totals mean, so
    // re-derive every customer's tier immediately — otherwise tiers stay
    // stale until each customer's next purchase. Bare SELECT/UPDATE: same
    // transaction as the triggering request, no @restrict (system logic).
    const thresholds = policyCache.getThresholds()
    const customers = await SELECT.from(Customers).columns('customerID', 'lifetimePoints', 'tier')
    for (const c of customers) {
      const tier = computeTier(c.lifetimePoints, thresholds)
      if (tier !== c.tier) {
        await UPDATE(Customers, c.customerID).set({ tier })
      }
    }
  })
}
