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

  // role guard: customers may only register with their own login email;
  // staff/admin may onboard any customer
  srv.before('CREATE', 'Customers', async (req) => {
    const u = req.user
    if (u.is && (u.is('admin') || u.is('staff'))) return
    const ownEmail = String(u.email || u.id || '').toLowerCase()
    const rowEmail = String(req.data.email || '').toLowerCase()
    if (!rowEmail || rowEmail !== ownEmail) {
      return req.reject(403, 'Customers may only register with their own email address')
    }
  })
  cds.on('served', async () => {
    await policyCache.load(srv)
  })
}
