const cds = require('@sap/cds')
const policyCache = require('./lib/policy-cache')
const { POINT_VALUE_INR } = require('./lib/point-value')
const registerTransactionHandlers = require('./handlers/transaction')
const registerRedemptionHandlers = require('./handlers/redemption')
const registerPolicyHandlers = require('./handlers/policy')

// XSUAA users expose the email directly on the user object; basic/dummy
// mock users (dev + tests) carry it as attr.email. One resolver, used by
// getUserInfo and both ownership guards.
function _emailOf (u) {
  return u.email || (u.attr && u.attr.email) || ''
}

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
      // XSUAA puts the email on the user object; basic/dummy mock users
      // carry it in attr.email
      email: _emailOf(u),
      name,
      isAdmin: !!(u.is && u.is('admin')),
      isStaff: !!(u.is && u.is('staff')),
      isCustomer: !!(u.is && u.is('customer')),
      pointValueInr: POINT_VALUE_INR
    }
  })

  // CREATE validation (all roles) + role guard: customers may only register
  // with their own login email; staff/admin may onboard any customer
  srv.before('CREATE', 'Customers', async (req) => {
    const name = String(req.data.name || '').trim()
    const email = String(req.data.email || '').trim()
    if (!name) return req.reject(400, 'name is required', 'name')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return req.reject(400, 'a valid email address is required', 'email')
    }
    const u = req.user
    if (u.is && (u.is('admin') || u.is('staff'))) {
      // one account per email also when staff/admin onboard
      const dupAny = await srv.run(SELECT.one.from(srv.entities.Customers).where({ email }))
      if (dupAny) return req.reject(409, `An account for ${email} already exists`)
      return
    }
    const ownEmail = String(_emailOf(u) || u.id || '').toLowerCase()
    const rowEmail = email.toLowerCase()
    if (rowEmail !== ownEmail) {
      return req.reject(403, 'Customers may only register with their own email address')
    }
    // one account per login: a customer must not register themselves twice
    const dup = await srv.run(SELECT.one.from(srv.entities.Customers).where({ email }))
    if (dup) {
      return req.reject(409, `An account for ${email} already exists`)
    }
  })
  cds.on('served', async () => {
    await policyCache.load(srv)
  })
}
