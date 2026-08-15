'use strict'

// Shared request-user email resolver + customer-ownership guard.
//
// XSUAA tokens carry the email in user.attr.email (SCN attribute),
// local basic mock users carry it in user.email — support both so the
// guard behaves identically in dev and production.
function emailOf (user) {
  return String((user && (user.email || (user.attr && user.attr.email))) || user.id || '').toLowerCase()
}

// Returns an async before-hook body: customers may only act on their OWN
// account; staff/admin may act for anyone. Rejected with 403 before any
// business validation runs so a foreign customerID never leaks whether
// the account exists (the 400 "No customer found" path).
function assertOwnCustomer (srv) {
  const { Customers } = srv.entities
  return async (req) => {
    const u = req.user
    if (u.is && (u.is('admin') || u.is('staff'))) return
    const ownEmail = emailOf(u)
    const key = req.data.customerID_customerID
      || (req.data.customerID && req.data.customerID.customerID)
    const cust = await srv.run(SELECT.one.from(Customers)
      .where({ customerID: key }))
    if (!cust || String(cust.email || '').toLowerCase() !== ownEmail) {
      return req.reject(403, 'Customers may only act on their own account')
    }
  }
}

module.exports = { emailOf, assertOwnCustomer }
