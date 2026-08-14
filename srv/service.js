const cds = require('@sap/cds')
const policyCache = require('./lib/policy-cache')
const registerTransactionHandlers = require('./handlers/transaction')
const registerRedemptionHandlers = require('./handlers/redemption')
const registerPolicyHandlers = require('./handlers/policy')

module.exports = (srv) => {
  registerTransactionHandlers(srv)
  registerRedemptionHandlers(srv)
  registerPolicyHandlers(srv)

  srv.on('getUserInfo', async (req) => {
    const u = req.user
    const name = u.fullName
      || [u.givenName, u.familyName].filter(Boolean).join(' ')
      || u.name || u.id
    return {
      id: u.id,
      email: u.email || '',
      name,
      isAdmin: !!(u.is && u.is('admin')),
      isStaff: !!(u.is && u.is('staff')),
      isCustomer: !!(u.is && u.is('customer'))
    }
  })
  cds.on('served', async () => {
    await policyCache.load(srv)
  })
}
