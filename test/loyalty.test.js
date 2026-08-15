// Backend test suite — runs under the [test] profile (see package.json):
// sqlite :memory: auto-deployed from db/schema.cds + db/data CSVs, dummy auth
// users alice (customer) / bob (staff) / carol (admin), empty passwords.
// Run: npm test
const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const cds = require('@sap/cds')

const { GET, POST, PATCH, DELETE } = cds.test(__dirname + '/..')

const SVC = '/odata/v4/loyalty'
const ALICE = 'b1a7e6d0-1111-4000-8000-000000000001' // seeded in db/data/loyalty-Customer.csv
const USERS = {
  customer: { username: 'alice', password: 'pass' },
  staff: { username: 'bob', password: 'pass' },
  admin: { username: 'carol', password: 'pass' }
}

// CSRF: CAP enforces token validation on data modifications. Fetch one token
// per role lazily and replay it together with the session cookie on every write.
const sessions = {}
async function session (role) {
  if (!sessions[role]) {
    const res = await GET(`${SVC}/Customers?$top=1`, {
      auth: USERS[role],
      headers: { 'x-csrf-token': 'fetch' }
    })
    sessions[role] = {
      auth: USERS[role],
      headers: {
        'x-csrf-token': res.headers['x-csrf-token'],
        cookie: (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ')
      }
    }
  }
  return sessions[role]
}

const get = async (path, role = 'admin') => GET(`${SVC}${path}`, await session(role))
const post = async (path, data, role = 'staff') => POST(`${SVC}${path}`, data, await session(role))
const patch = async (path, data, role = 'admin') => PATCH(`${SVC}${path}`, data, await session(role))
const del = async (path, role = 'admin') => DELETE(`${SVC}${path}`, await session(role))

// create an isolated customer per test so cases never share balance state
let seq = 0
async function newCustomer () {
  const { data } = await post('/Customers', { name: `Test ${++seq}`, email: `test${seq}@example.com` }, 'staff')
  return data.customerID
}
const customer = async (id) => (await get(`/Customers(customerID=${id})`)).data
const balanceOf = async (id) => (await customer(id)).totalPoints

describe('points engine', () => {
  it('earns online points at the online policy rate', async () => {
    const id = await newCustomer()
    const { status, data } = await post('/Transactions', { customerID_customerID: id, channel: 'Online', price: 1000 })
    assert.equal(status, 201)
    assert.equal(Number(data.amount), 1000)
    assert.equal(data.pointsEarned, 50) // 1000 × 0.05
    const c = await customer(id)
    assert.equal(c.totalPoints, 50)
    assert.equal(c.lifetimePoints, 50)
    assert.equal(c.tier, 'Bronze')
  })

  it('earns store points at the store policy rate', async () => {
    const id = await newCustomer()
    const { data } = await post('/Transactions', { customerID_customerID: id, channel: 'Store', price: 500 })
    assert.equal(data.pointsEarned, 15) // 500 × 0.03
    assert.equal(await balanceOf(id), 15)
  })

  it('applies points as part-payment and records the redemption side', async () => {
    const id = await newCustomer()
    await post('/Transactions', { customerID_customerID: id, channel: 'Online', price: 1000 }) // +50 pts
    const { data } = await post('/Transactions', { customerID_customerID: id, channel: 'Store', price: 500, pointsApplied: 20 })
    assert.equal(Number(data.amount), 490) // 500 − 20 × ₹0.50
    assert.equal(data.pointsEarned, 14) // floor(490 × 0.03)
    assert.equal(await balanceOf(id), 44) // 50 − 20 + 14
    const reds = await get(`/Redemptions?$filter=customerID_customerID eq ${id}`)
    assert.equal(reds.data.value.length, 1)
    assert.equal(reds.data.value[0].pointsUsed, 20)
  })

  it('rejects invalid channel, unknown customer, overspending applied points', async () => {
    const id = await newCustomer()
    await assert.rejects(post('/Transactions', { customerID_customerID: id, channel: 'Phone', price: 100 }), /400/)
    await assert.rejects(
      post('/Transactions', { customerID_customerID: '00000000-0000-0000-0000-000000000000', channel: 'Online', price: 100 }), /400/)
    await assert.rejects(post('/Transactions', { customerID_customerID: id, channel: 'Online', price: 1000, pointsApplied: 1 }), /400|Insufficient/)
  })

  it('rejects redemptions beyond the balance and honours valid ones', async () => {
    const id = await newCustomer()
    await post('/Transactions', { customerID_customerID: id, channel: 'Online', price: 1000 }) // 50 pts
    await assert.rejects(post('/Redemptions', { customerID_customerID: id, pointsUsed: 51, remarks: 'too many' }, 'customer'), /403|400/)
    const { status } = await post('/Redemptions', { customerID_customerID: id, pointsUsed: 30, remarks: 'voucher' }, 'admin')
    assert.equal(status, 201)
    assert.equal(await balanceOf(id), 20)
  })

  it('promotes tier when lifetime points cross a threshold', async () => {
    const id = await newCustomer()
    await post('/Transactions', { customerID_customerID: id, channel: 'Online', price: 100000 }) // 5000 pts
    assert.equal((await customer(id)).tier, 'Silver') // Silver threshold = 5000 lifetime
  })

  it('recomputes existing tiers when a threshold is added and removed', async () => {
    const id = await newCustomer()
    await post('/Transactions', { customerID_customerID: id, channel: 'Online', price: 1000 }) // lifetime 50
    assert.equal((await customer(id)).tier, 'Bronze')
    await post('/TierThresholds', { tier: 'TestGold', minLifetimePoints: 10 }, 'admin')
    assert.equal((await customer(id)).tier, 'TestGold') // recomputed without a new purchase
    await del(`/TierThresholds('TestGold')`, 'admin')
    assert.equal((await customer(id)).tier, 'Bronze') // and back
  })
})

describe('concurrency guard', () => {
  it('never lets two concurrent redemptions spend the same points twice', async () => {
    const id = await newCustomer()
    await post('/Transactions', { customerID_customerID: id, channel: 'Online', price: 1000 }) // 50 pts
    const results = await Promise.allSettled([
      post('/Redemptions', { customerID_customerID: id, pointsUsed: 50, remarks: 'race A' }, 'admin'),
      post('/Redemptions', { customerID_customerID: id, pointsUsed: 50, remarks: 'race B' }, 'admin')
    ])
    const succeeded = results.filter(r => r.status === 'fulfilled')
    assert.equal(succeeded.length, 1, 'exactly one redemption may win')
    assert.equal(await balanceOf(id), 0) // and never negative
  })
})

describe('role guards', () => {
  it('returns role flags and the server-side point value from getUserInfo', async () => {
    const admin = (await get('/getUserInfo()', 'admin')).data
    assert.equal(admin.isAdmin, true)
    assert.equal(admin.pointValueInr, 0.5)
    const staff = (await get('/getUserInfo()', 'staff')).data
    assert.equal(staff.isStaff, true)
    assert.equal(staff.isAdmin, false)
  })

  it('forbids customers from registering purchases for someone else', async () => {
    const other = await newCustomer()
    await assert.rejects(
      post('/Transactions', { customerID_customerID: other, channel: 'Online', price: 100 }, 'customer'), /403|400/)
    // …but alice may register for her own account
    const { status } = await post('/Transactions', { customerID_customerID: ALICE, channel: 'Online', price: 100 }, 'customer')
    assert.equal(status, 201)
  })

  it('forbids customers from onboarding accounts with a foreign email', async () => {
    await assert.rejects(post('/Customers', { name: 'Fake', email: 'notalice@example.com' }, 'customer'), /403/)
    await assert.rejects(post('/Customers', { name: 'Dup', email: 'alice@example.com' }, 'customer'), /403|409|400/)
  })

  it('hides redemptions and policies from staff', async () => {
    await assert.rejects(get('/Redemptions', 'staff'), /403/)
    const pol = await get('/RewardPolicies', 'staff') // staff READ is granted
    assert.equal(pol.status, 200)
    await assert.rejects(post('/RewardPolicies', { channel: 'Online', pointsPerCurrencyUnit: 0.1 }, 'staff'), /403/)
  })
})
