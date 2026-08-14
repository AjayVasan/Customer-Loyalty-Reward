let policies = new Map()
let thresholds = []

// Bare SELECT (not srv.run/srv.tx) joins whatever transaction is already active
// (cds.db's own at bootstrap, or the current request's when called from an
// after-handler in Task 7) instead of opening a nested one — a nested srv.tx()
// here deadlocks against sqlite's single connection when called mid-request.
// It also bypasses @restrict, which is fine: this is trusted internal config
// loading, not a user-facing read.
async function load(srv) {
  const { RewardPolicies, TierThresholds } = srv.entities
  const rates = await SELECT.from(RewardPolicies)
  policies = new Map(rates.map(r => [r.channel, r.pointsPerCurrencyUnit]))
  thresholds = await SELECT.from(TierThresholds)
}

function rateFor(channel) {
  const rate = policies.get(channel)
  if (rate == null) throw new Error(`No RewardPolicy configured for channel "${channel}"`)
  return rate
}

function getThresholds() {
  return thresholds
}

module.exports = { load, rateFor, getThresholds }
