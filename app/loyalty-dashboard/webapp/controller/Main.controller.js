sap.ui.define(
  [
    'sap/ui/core/mvc/Controller',
    'sap/ui/model/json/JSONModel',
    'sap/m/MessageToast',
    'sap/m/MessageBox'
  ],
  function (Controller, JSONModel, MessageToast, MessageBox) {
    'use strict'

    return Controller.extend('loyaltydashboard.controller.Main', {

      onInit: function () {
        const ui = new JSONModel({
          userName: '',
          userEmail: '',
          isAdmin: false,
          isStaff: false,
          isCustomer: false,
          kpiStaff: { customers: '–', purchases: '–', pointsIssued: '–', online: '–', store: '–' },
          kpisAdmin: { customers: '–', online: '–', store: '–', pointsRedeemed: '–', purchases: '–', redemptions: '–' },
          // customer tab: the signed-in user's own record (auto-created on first login)
          me: { customerID: '', name: '', email: '', totalPoints: 0, lifetimePoints: 0, tier: '' },
          myTxns: [],
          myReds: [],
          // staff tab: customer found via email search (identity only, no history)
          staffCustomer: null,
          // admin tab: customer found via ID/email lookup (full detail, gated behind search)
          adminCustomer: null,
          adminTxns: [],
          adminReds: [],
          policies: []
        })
        this.getView().setModel(ui, 'ui')
        this._bootstrap().catch((err) => this._error(this._i18n('errRequest'), err))
      },

      // ---------- bootstrap ----------

      _api: function (path) { return 'odata/v4/loyalty/' + path },

      _fetch: async function (path) {
        const res = await fetch(this._api(path), { headers: { Accept: 'application/json' } })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error?.message || res.status + ' ' + res.statusText)
        return body
      },

      _bootstrap: async function () {
        const ui = this.getView().getModel('ui')
        const user = await this._fetch('getUserInfo()')
        ui.setProperty('/userName', user.name || user.id || '')
        ui.setProperty('/userEmail', user.email || '')
        ui.setProperty('/isAdmin', !!user.isAdmin)
        ui.setProperty('/isStaff', !!user.isStaff)
        ui.setProperty('/isCustomer', !!user.isCustomer)

        try {
          const polRes = await this._fetch('RewardPolicies?$select=policyID,channel,pointsPerCurrencyUnit')
          ui.setProperty('/policies', polRes.value || [])
        } catch (e) { /* role without policy read access: rate hints degrade to 0 */ }
        this.onRateHintRefresh()

        // default tab follows the strongest role: admin > staff > customer
        const tabKey = user.isAdmin ? 'tabAdmin' : (user.isStaff ? 'tabStaff' : 'tabCustomer')
        const tab = this.byId(tabKey)
        if (tab) this.byId('roleTabs').setSelectedKey(tab.getId())

        if (user.isAdmin || user.isStaff) this.refreshKpis().catch(() => {})

        if (user.isCustomer) await this._onboardSelf(user)
        this.onCustPurchaseHint()
      },

      // find the signed-in user's customer record by email; create it on first login
      _onboardSelf: async function (user) {
        const ui = this.getView().getModel('ui')
        const email = (user.email || user.id || '').trim()
        const name = (user.name || user.id || '').trim()
        const existing = await this._fetch(
          'Customers?$select=customerID,name,email,totalPoints,lifetimePoints,tier&$filter=' +
          encodeURIComponent("email eq '" + email.replace(/'/g, "''") + "'"))
        let me = (existing.value || [])[0]
        let isNew = false
        if (!me) {
          const model = this.getView().getModel()
          const list = model.bindList('/Customers')
          const ctx = list.create({ name: name, email: email })
          await this._send(ctx)
          me = {
            customerID: ctx.getProperty('customerID'),
            name: ctx.getProperty('name'),
            email: ctx.getProperty('email'),
            totalPoints: ctx.getProperty('totalPoints'),
            lifetimePoints: ctx.getProperty('lifetimePoints'),
            tier: ctx.getProperty('tier')
          }
          isNew = true
        }
        ui.setProperty('/me', me)
        await this._loadMyHistory(me.customerID)
        if (isNew) {
          MessageToast.show(this._i18n('welcomeNew'))
          if (this.getView().getModel('ui').getProperty('/isAdmin') || this.getView().getModel('ui').getProperty('/isStaff')) {
            this.refreshKpis().catch(() => {})
          }
        }
      },

      _loadMyHistory: async function (id) {
        const ui = this.getView().getModel('ui')
        const filter = encodeURIComponent("customerID eq " + id)
        const [txns, reds] = await Promise.all([
      this._fetch('Transactions?$select=txnDate,channel,amount,pointsApplied,pointsEarned&$filter=' + filter + '&$orderby=' + encodeURIComponent('txnDate desc')),
          this._fetch('Redemptions?$select=redeemDate,pointsUsed,remarks&$filter=' + filter + '&$orderby=' + encodeURIComponent('redeemDate desc'))
        ])
        ui.setProperty('/myTxns', txns.value || [])
        ui.setProperty('/myReds', reds.value || [])
      },

      refreshKpis: async function () {
        const ui = this.getView().getModel('ui')
        const isAdmin = ui.getProperty('/isAdmin')
        const count = async (set) => String((await this._fetch(set + '?$count=true'))['@odata.count'] ?? 0)
        // per-channel points issued via $apply groupby (CAP ignores $filter+$apply combos)
        const byChannel = async () => {
          const j = await this._fetch('Transactions?$apply=' +
            encodeURIComponent('groupby((channel),aggregate(pointsEarned with sum as total))'))
          const map = { Online: 0, Store: 0 }
          ;(j.value || []).forEach((r) => { map[r.channel] = r.total || 0 })
          return map
        }
        if (isAdmin) {
          const [cust, tx, red, chan, redAgg] = await Promise.all([
            count('Customers'), count('Transactions'), count('Redemptions'), byChannel(),
            this._fetch('Redemptions?$apply=' + encodeURIComponent('aggregate(pointsUsed with sum as total)'))
          ])
          const redeemed = String((redAgg.value && redAgg.value[0] && redAgg.value[0].total) || 0)
          ui.setProperty('/kpisAdmin', {
            customers: cust, purchases: tx, redemptions: red,
            online: String(chan.Online || 0), store: String(chan.Store || 0), pointsRedeemed: redeemed
          })
        } else {
          // staff: Customers + Transactions only (no Redemptions read access)
          const [cust, tx, chan] = await Promise.all([count('Customers'), count('Transactions'), byChannel()])
          ui.setProperty('/kpiStaff', {
            customers: cust, purchases: tx,
            online: String(chan.Online || 0), store: String(chan.Store || 0),
            pointsIssued: String((chan.Online || 0) + (chan.Store || 0))
          })
        }
      },

      // ---------- customer: redeem ----------

      onRedeem: async function () {
        const ui = this.getView().getModel('ui')
        const id = ui.getProperty('/me/customerID')
        const pts = parseInt(this.byId('redeemPoints').getValue(), 10)
        const remarks = this.byId('redeemRemarks').getValue()
        if (!id || !(pts > 0)) {
          return MessageToast.show(this._i18n('errRedeemFill'))
        }
        const model = this.getView().getModel()
        let ctx
        try {
          const list = model.bindList('/Redemptions')
          ctx = list.create({
            customerID_customerID: id,
            pointsUsed: pts,
            remarks: remarks || 'Redemption'
          })
          await this._send(ctx)
          MessageToast.show(this._i18n('redeemSuccess').replace('{0}', pts).replace('{1}', ui.getProperty('/me/name') || ''))
          this.byId('redeemPoints').setValue('')
          this.byId('redeemRemarks').setValue('')
          await this._refreshMe()
        } catch (err) {
          if (ctx && ctx.delete) { try { ctx.delete() } catch (e) { /* transient already gone */ } }
          this._error(this._i18n('errRequest'), err)
        }
      },

      _refreshMe: async function () {
        const ui = this.getView().getModel('ui')
        const id = ui.getProperty('/me/customerID')
        if (!id) return
        const rows = await this._fetch(
          'Customers?$select=customerID,name,email,totalPoints,lifetimePoints,tier&$filter=' +
          encodeURIComponent("customerID eq " + id))
        const me = (rows.value || [])[0]
        if (me) ui.setProperty('/me', me)
        await this._loadMyHistory(id)
        if (ui.getProperty('/isAdmin') || ui.getProperty('/isStaff')) this.refreshKpis().catch(() => {})
      },

      // ---------- staff: find customer by email (identity only) ----------

      onStaffSearchChange: function () {
        // clear the stale result as soon as the search text changes
        this.getView().getModel('ui').setProperty('/staffCustomer', null)
        const msg = this.byId('staffSearchMsg')
        if (msg) { msg.setVisible(false); msg.setText('') }
      },

      onStaffSearch: async function () {
        const ui = this.getView().getModel('ui')
        const email = (this.byId('staffSearchEmail').getValue() || '').trim()
        const msg = this.byId('staffSearchMsg')
        msg.setVisible(false)
        if (!email) {
          ui.setProperty('/staffCustomer', null)
          msg.setText(this._i18n('errEmailRequired'))
          msg.setVisible(true)
          return
        }
        try {
          const res = await this._fetch(
            'Customers?$select=customerID,name,email,totalPoints,tier&$filter=' +
            encodeURIComponent("email eq '" + email.replace(/'/g, "''") + "'"))
          const cust = (res.value || [])[0]
          if (!cust) {
            ui.setProperty('/staffCustomer', null)
            msg.setText(this._i18n('staffNotFound').replace('{0}', email))
            msg.setVisible(true)
            return
          }
          ui.setProperty('/staffCustomer', cust)
        } catch (err) {
          this._error(this._i18n('errRequest'), err)
        }
      },

      // ---------- staff: add new customer ----------

      onAddCustomer: async function () {
        const ui = this.getView().getModel('ui')
        const name = (this.byId('newCustName').getValue() || '').trim()
        const email = (this.byId('newCustEmail').getValue() || '').trim()
        if (!name || !email.includes('@')) {
          return MessageToast.show(this._i18n('errNewCustomerFill'))
        }
        const model = this.getView().getModel()
        let ctx
        try {
          const list = model.bindList('/Customers')
          ctx = list.create({ name: name, email: email })
          await this._send(ctx)
          MessageToast.show(this._i18n('newCustomerSaved').replace('{0}', name))
          this.byId('newCustName').setValue('')
          this.byId('newCustEmail').setValue('')
          ui.setProperty('/staffCustomer', {
            customerID: ctx.getProperty('customerID'),
            name: ctx.getProperty('name'),
            email: ctx.getProperty('email'),
            tier: ctx.getProperty('tier'),
            totalPoints: ctx.getProperty('totalPoints') || 0
          })
          this.byId('staffSearchEmail').setValue(email)
          this.refreshKpis().catch(() => {})
        } catch (err) {
          if (ctx && ctx.delete) { try { ctx.delete() } catch (e) { /* transient already gone */ } }
          this._error(this._i18n('errRequest'), err)
        }
      },

      // ---------- staff: record purchase ----------

      // ---------- purchase math (staff + customer forms share this) ----------

      // reward-point part-payment value (₹ per point) — mirrors
      // srv/lib/point-value.js; the backend recomputes authoritatively.
      _PURCHASE_POINT_VALUE: 0.5,

      _purchaseHint: function (priceIn, pointsIn, channel, balance) {
        const pol = (this.getView().getModel('ui').getProperty('/policies') || []).find((p) => p.channel === channel)
        const rate = pol ? parseFloat(pol.pointsPerCurrencyUnit) : 0
        const price = Math.floor((parseFloat(priceIn) || 0) * 2) / 2 // ₹0.50 denominations
        const maxPts = Math.min(balance || 0, Math.floor(price / this._PURCHASE_POINT_VALUE))
        let pts = Math.floor(parseFloat(pointsIn) || 0)
        if (pts < 0) pts = 0
        if (pts > maxPts) pts = maxPts
        const covered = pts * this._PURCHASE_POINT_VALUE
        const payable = price - covered
        const earned = Math.floor(payable * rate)
        const parts = ['₹1 = ' + rate + ' pts (' + channel + ')', 'price ₹' + price.toFixed(2)]
        if (pts > 0) parts.push(pts + ' pts cover ₹' + covered.toFixed(2))
        parts.push('payable ₹' + payable.toFixed(2), '+' + earned + ' pts')
        return { price: price, points: pts, payable: payable, earned: earned, text: parts.join(' — ') }
      },

      onRateHintRefresh: function () {
        if (!this.byId('rateHint')) return
        const cust = this.getView().getModel('ui').getProperty('/staffCustomer')
        const channel = this.byId('purchaseChannel') ? (this.byId('purchaseChannel').getSelectedKey() || 'Online') : 'Online'
        const h = this._purchaseHint(
          this.byId('purchasePrice') ? this.byId('purchasePrice').getValue() : '0',
          this.byId('purchasePoints') ? this.byId('purchasePoints').getValue() : '0',
          channel, cust ? cust.totalPoints : 0)
        this.byId('rateHint').setText(h.text)
        // live-normalize the points field to the usable maximum
        if (this.byId('purchasePoints')) this.byId('purchasePoints').setValue(String(h.points))
      },

      onRecordPurchase: async function () {
        const ui = this.getView().getModel('ui')
        const cust = ui.getProperty('/staffCustomer')
        const channel = this.byId('purchaseChannel').getSelectedKey() || 'Online'
        const price = parseFloat(this.byId('purchasePrice').getValue())
        const points = Math.floor(parseFloat(this.byId('purchasePoints').getValue() || '0') || 0)
        if (!cust || !channel || !(price > 0)) {
          return MessageToast.show(this._i18n('errFillAll'))
        }
        const model = this.getView().getModel()
        let ctx
        try {
          const list = model.bindList('/Transactions')
          ctx = list.create({
            customerID_customerID: cust.customerID,
            channel: channel,
            price: price,
            pointsApplied: points
          })
          await this._send(ctx)
          const pts = ctx.getProperty('pointsEarned')
          MessageToast.show(this._i18n('purchaseSuccess').replace('{0}', pts).replace('{1}', cust.name))
          this.byId('purchasePrice').setValue('')
          this.byId('purchasePoints').setValue('')
          // refresh the searched customer so the next form's points cap is correct
          try {
            const res = await this._fetch(
              'Customers?$select=customerID,name,email,totalPoints,tier&$filter=' +
              encodeURIComponent('customerID eq ' + cust.customerID))
            const fresh = (res.value || [])[0]
            if (fresh) ui.setProperty('/staffCustomer', fresh)
          } catch (e) { /* balance refresh is best-effort */ }
          this.onRateHintRefresh()
          this.refreshKpis().catch(() => {})
        } catch (err) {
          if (ctx && ctx.delete) { try { ctx.delete() } catch (e) { /* transient already gone */ } }
          this._error(this._i18n('errRequest'), err)
        }
      },

      // ---------- customer: register own purchase (points optional) ----------

      onCustPurchaseHint: function () {
        if (!this.byId('custRateHint')) return
        const me = this.getView().getModel('ui').getProperty('/me')
        const channel = this.byId('custChannel') ? (this.byId('custChannel').getSelectedKey() || 'Online') : 'Online'
        const h = this._purchaseHint(
          this.byId('custPrice') ? this.byId('custPrice').getValue() : '0',
          this.byId('custPoints') ? this.byId('custPoints').getValue() : '0',
          channel, me ? me.totalPoints : 0)
        this.byId('custRateHint').setText(h.text)
        if (this.byId('custPoints')) this.byId('custPoints').setValue(String(h.points))
      },

      onCustomerPurchase: async function () {
        const ui = this.getView().getModel('ui')
        const me = ui.getProperty('/me')
        const channel = this.byId('custChannel').getSelectedKey() || 'Online'
        const price = parseFloat(this.byId('custPrice').getValue())
        const points = Math.floor(parseFloat(this.byId('custPoints').getValue() || '0') || 0)
        if (!me.customerID || !channel || !(price > 0)) {
          return MessageToast.show(this._i18n('errFillAll'))
        }
        const model = this.getView().getModel()
        let ctx
        try {
          const list = model.bindList('/Transactions')
          ctx = list.create({
            customerID_customerID: me.customerID,
            channel: channel,
            price: price,
            pointsApplied: points
          })
          await this._send(ctx)
          const pts = ctx.getProperty('pointsEarned')
          MessageToast.show(this._i18n('purchaseSuccess').replace('{0}', pts).replace('{1}', me.name))
          this.byId('custPrice').setValue('')
          this.byId('custPoints').setValue('')
          await this._refreshMe()
          await this._loadMyHistory(me.customerID)
          this.onCustPurchaseHint()
          if (ui.getProperty('/isAdmin') || ui.getProperty('/isStaff')) {
            this.refreshKpis().catch(() => {})
          }
        } catch (err) {
          if (ctx && ctx.delete) { try { ctx.delete() } catch (e) { /* transient already gone */ } }
          this._error(this._i18n('errRequest'), err)
        }
      },

      // ---------- admin: gated customer lookup (ID or email) ----------

      onAdminLookup: async function () {
        const ui = this.getView().getModel('ui')
        const key = (this.byId('adminLookupKey').getValue() || '').trim()
        const msg = this.byId('adminLookupMsg')
        msg.setVisible(false)
        if (!key) {
          ui.setProperty('/adminCustomer', null)
          ui.setProperty('/adminTxns', [])
          ui.setProperty('/adminReds', [])
          msg.setText(this._i18n('adminLookupEmpty'))
          msg.setVisible(true)
          return
        }
        const esc = key.replace(/'/g, "''")
        try {
          const res = await this._fetch(
            'Customers?$select=customerID,name,email,totalPoints,lifetimePoints,tier&$filter=' +
            encodeURIComponent("email eq '" + esc + "' or customerID eq " + (/^[0-9a-f-]{36}$/i.test(key) ? key : "00000000-0000-0000-0000-000000000000")))
          const cust = (res.value || [])[0]
          if (!cust) {
            ui.setProperty('/adminCustomer', null)
            ui.setProperty('/adminTxns', [])
            ui.setProperty('/adminReds', [])
            msg.setText(this._i18n('adminLookupNotFound').replace('{0}', key))
            msg.setVisible(true)
            return
          }
          ui.setProperty('/adminCustomer', cust)
          const filter = encodeURIComponent('customerID eq ' + cust.customerID)
          const [txns, reds] = await Promise.all([
            this._fetch('Transactions?$select=txnDate,channel,amount,pointsEarned&$filter=' + filter + '&$orderby=' + encodeURIComponent('txnDate desc')),
            this._fetch('Redemptions?$select=redeemDate,pointsUsed,remarks&$filter=' + filter + '&$orderby=' + encodeURIComponent('redeemDate desc'))
          ])
          ui.setProperty('/adminTxns', txns.value || [])
          ui.setProperty('/adminReds', reds.value || [])
        } catch (err) {
          this._error(this._i18n('errRequest'), err)
        }
      },

      // ---------- admin: policies / thresholds ----------

      onPolicySave: async function (evt) {
        const row = evt.getSource().getParent()
        const rate = parseFloat(row.getCells()[1].getValue())
        if (!(rate > 0)) return MessageToast.show(this._i18n('errRateInvalid'))
        const ctx = row.getBindingContext()
        try {
          ctx.setProperty('pointsPerCurrencyUnit', rate)
          await this._send()
          MessageToast.show(this._i18n('policySaved').replace('{0}', ctx.getProperty('channel')))
          const j = await this._fetch('RewardPolicies?$select=policyID,channel,pointsPerCurrencyUnit')
          this.getView().getModel('ui').setProperty('/policies', j.value || [])
          this.onRateHintRefresh()
        } catch (err) {
          this._error(this._i18n('errRequest'), err)
        }
      },

      onThresholdSave: async function (evt) {
        const row = evt.getSource().getParent()
        const min = parseInt(row.getCells()[1].getValue(), 10)
        if (!(min >= 0)) return MessageToast.show(this._i18n('errThresholdInvalid'))
        const ctx = row.getBindingContext()
        try {
          ctx.setProperty('minLifetimePoints', min)
          await this._send()
          MessageToast.show(this._i18n('thresholdSaved').replace('{0}', ctx.getProperty('tier')))
        } catch (err) {
          this._error(this._i18n('errRequest'), err)
        }
      },

      onThresholdAdd: async function () {
        const tier = (this.byId('newThresholdTier').getValue() || '').trim()
        const min = parseInt(this.byId('newThresholdMin').getValue(), 10)
        if (!tier || !(min >= 0)) return MessageToast.show(this._i18n('errThresholdInvalid'))
        const model = this.getView().getModel()
        let ctx
        try {
          const list = model.bindList('/TierThresholds')
          ctx = list.create({ tier: tier, minLifetimePoints: min })
          await this._send(ctx)
          MessageToast.show(this._i18n('thresholdAdded').replace('{0}', tier))
          this.byId('newThresholdTier').setValue('')
          this.byId('newThresholdMin').setValue('')
          this.byId('thresholdTable').getBinding('items').refresh()
        } catch (err) {
          if (ctx && ctx.delete) { try { ctx.delete() } catch (e) { /* transient already gone */ } }
          this._error(this._i18n('errRequest'), err)
        }
      },

      // ---------- navigation ----------

      onOpenDirectoryStaff: function () {
        this.getOwnerComponent().getRouter().navTo('customersList', { mode: 'staff' })
      },

      onOpenMasterList: function () {
        this.getOwnerComponent().getRouter().navTo('customersList', { mode: 'admin' })
      },

      // ---------- helpers ----------

      _i18n: function (key) {
        return (this.getOwnerComponent().getModel('i18n') || { getProperty: (k) => k }).getProperty(key) || key
      },

      // submit the $auto group; surface backend validation errors from the MessageManager
      _send: async function (ctx) {
        const mm = sap.ui.getCore().getMessageManager()
        const before = mm.getMessageModel().getData().length
        await this.getView().getModel().submitBatch('$auto')
        const errs = mm.getMessageModel()
          .getData()
          .slice(before)
          .filter((m) => m.type === 'Error')
          .map((m) => m.message)
        if (errs.length) throw new Error(errs.join(' | '))
        if (ctx) await ctx.created()
      },

      _error: function (title, err) {
        let msg = ''
        if (err) {
          msg = err.message || ''
          if (err && err.innerError && typeof err.innerError.getMessage === 'function') msg = err.innerError.getMessage()
          if (!msg) msg = String(err)
        }
        MessageBox.error(title + (msg ? '\n' + msg : ''))
      }
    })
  }
)
