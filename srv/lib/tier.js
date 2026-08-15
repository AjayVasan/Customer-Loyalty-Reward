function computeTier(lifetimePoints, thresholds) {
  if (!thresholds || thresholds.length === 0) return 'Bronze'
  const sorted = [...thresholds].sort((a, b) => b.minLifetimePoints - a.minLifetimePoints)
  const match = sorted.find(t => lifetimePoints >= t.minLifetimePoints)
  return match ? match.tier : sorted[sorted.length - 1].tier
}

module.exports = { computeTier }
