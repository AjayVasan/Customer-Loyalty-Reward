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
          kpis: { customers: '–', pointsIssued: '–', pointsRedeemed: '–', transactions: '–', redemptions: '–' },
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

        const polRes = await this._fetch('RewardPolicies?$select=policyID,channel,pointsPerCurrencyUnit')
        ui.setProperty('/policies', polRes.value || [])
        this.onRateHintRefresh()

        if (user.isAdmin || user.isStaff) this.refreshKpis().catch(() => {})

        if (user.isCustomer) await this._onboardSelf(user)
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
          this._fetch('Transactions?$select=txnDate,channel,amount,pointsEarned&$filter=' + filter + '&$orderby=' + encodeURIComponent('txnDate desc')),
          this._fetch('Redemptions?$select=redeemDate,pointsUsed,remarks&$filter=' + filter + '&$orderby=' + encodeURIComponent('redeemDate desc'))
        ])
        ui.setProperty('/myTxns', txns.value || [])
        ui.setProperty('/myReds', reds.value || [])
      },

      refreshKpis: async function () {
        const k = this.getView().getModel('ui')
        const count = async (set) => String((await this._fetch(set + '?$count=true'))['@odata.count'] ?? 0)
        const agg = async (set, prop) => {
          const j = await this._fetch(set + '?$apply=' + encodeURIComponent('aggregate(' + prop + ' with sum as total)'))
          return String((j.value && j.value[0] && j.value[0].total) || 0)
        }
        const [c, t, r, pi, pr] = await Promise.all([
          count('Customers'), count('Transactions'), count('Redemptions'),
          agg('Transactions', 'pointsEarned'), agg('Redemptions', 'pointsUsed')
        ])
        k.setProperty('/kpis/customers', c)
        k.setProperty('/kpis/transactions', t)
        k.setProperty('/kpis/redemptions', r)
        k.setProperty('/kpis/pointsIssued', pi)
        k.setProperty('/kpis/pointsRedeemed', pr)
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
            'Customers?$select=customerID,name,email,tier&$filter=' +
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
            tier: ctx.getProperty('tier')
          })
          this.byId('staffSearchEmail').setValue(email)
          this.refreshKpis().catch(() => {})
        } catch (err) {
          if (ctx && ctx.delete) { try { ctx.delete() } catch (e) { /* transient already gone */ } }
          this._error(this._i18n('errRequest'), err)
        }
      },

      // ---------- staff: record purchase ----------

      onRateHintRefresh: function () {
        const ui = this.getView().getModel('ui')
        const channel = this.byId('purchaseChannel') ? this.byId('purchaseChannel').getSelectedKey() : 'Online'
        const amount = parseFloat(this.byId('purchaseAmount') ? this.byId('purchaseAmount').getValue() : '0')
        const pol = (ui.getProperty('/policies') || []).find((p) => p.channel === channel)
        const rate = pol ? parseFloat(pol.pointsPerCurrencyUnit) : 0
        const pts = Math.floor((amount || 0) * (rate || 0))
        this.byId('rateHint').setText('₹1 = ' + rate + ' pts (' + channel + ') — this purchase: ' + pts + ' pts')
      },

      onRecordPurchase: async function () {
        const ui = this.getView().getModel('ui')
        const cust = ui.getProperty('/staffCustomer')
        const channel = this.byId('purchaseChannel').getSelectedKey()
        const amount = parseFloat(this.byId('purchaseAmount').getValue())
        if (!cust || !channel || !(amount > 0)) {
          return MessageToast.show(this._i18n('errFillAll'))
        }
        const model = this.getView().getModel()
        let ctx
        try {
          const list = model.bindList('/Transactions')
          ctx = list.create({
            customerID_customerID: cust.customerID,
            channel: channel,
            amount: amount
          })
          await this._send(ctx)
          const pts = ctx.getProperty('pointsEarned')
          MessageToast.show(this._i18n('purchaseSuccess').replace('{0}', pts).replace('{1}', cust.name))
          this.byId('purchaseAmount').setValue('')
          this.onRateHintRefresh()
          this.refreshKpis().catch(() => {})
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

      onPolicyAdd: async function () {
        const channel = this.byId('newPolicyChannel').getSelectedKey()
        const rate = parseFloat(this.byId('newPolicyRate').getValue())
        if (!channel || !(rate > 0)) return MessageToast.show(this._i18n('errRateInvalid'))
        const model = this.getView().getModel()
        let ctx
        try {
          const list = model.bindList('/RewardPolicies')
          ctx = list.create({ channel: channel, pointsPerCurrencyUnit: rate })
          await this._send(ctx)
          MessageToast.show(this._i18n('policyAdded').replace('{0}', channel))
          this.byId('newPolicyRate').setValue('')
          this.byId('policyTable').getBinding('items').refresh()
          const j = await this._fetch('RewardPolicies?$select=policyID,channel,pointsPerCurrencyUnit')
          this.getView().getModel('ui').setProperty('/policies', j.value || [])
          this.onRateHintRefresh()
        } catch (err) {
          if (ctx && ctx.delete) { try { ctx.delete() } catch (e) { /* transient already gone */ } }
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
