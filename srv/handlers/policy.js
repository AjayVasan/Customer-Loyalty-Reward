const policyCache = require('../lib/policy-cache')
const { VALID_CHANNELS } = require('../lib/channels')

module.exports = (srv) => {
  const { RewardPolicies, TierThresholds } = srv.entities

  srv.before(['CREATE', 'UPDATE'], RewardPolicies, (req) => {
    const { channel } = req.data
    // CDS `enum` on RewardPolicy.channel only documents the allowed set in $metadata — it
    // does not reject invalid values at runtime, so this handler is the actual enforcement
    // (same list Transaction.channel validates against, so a policy can't be created for a
    // channel purchases could never use).
    if (channel !== undefined && !VALID_CHANNELS.includes(channel)) {
      return req.reject(400, `channel must be one of ${VALID_CHANNELS.join(', ')}`, 'channel')
    }
  })

  srv.after(['CREATE', 'UPDATE', 'DELETE'], RewardPolicies, async () => {
    await policyCache.load(srv)
  })
  srv.after(['CREATE', 'UPDATE', 'DELETE'], TierThresholds, async () => {
    await policyCache.load(srv)
  })
}
