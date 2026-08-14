module.exports = (srv) => {
  const { Redemptions, Customers } = srv.entities

  srv.before('CREATE', Redemptions, async (req) => {
    const { pointsUsed } = req.data
    const customerKey = req.data.customerID_customerID

    if (!customerKey) {
      return req.reject(400, 'customerID is required', 'customerID')
    }
    if (!Number.isInteger(pointsUsed) || pointsUsed <= 0) {
      return req.reject(400, 'pointsUsed must be a positive integer', 'pointsUsed')
    }

    const customer = await srv.run(SELECT.one.from(Customers).where({ customerID: customerKey }))
    if (!customer) {
      return req.reject(400, `No customer found for ${customerKey}`, 'customerID')
    }
    if (customer.totalPoints < pointsUsed) {
      return req.reject(400, `Insufficient points: customer has ${customer.totalPoints}, tried to redeem ${pointsUsed}`, 'pointsUsed')
    }

    req.data.redeemDate = req.data.redeemDate || new Date().toISOString()

    // Bare UPDATE, same reasoning as the transaction handler: stays in the current
    // transaction (no nested-tx deadlock) and bypasses @restrict (no role has
    // direct Customer-write; only this validated path may change totalPoints).
    await UPDATE(Customers, customerKey).set({
      totalPoints: customer.totalPoints - pointsUsed
    })
  })
}
