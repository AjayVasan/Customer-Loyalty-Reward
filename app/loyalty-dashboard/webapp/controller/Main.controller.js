sap.ui.define(
  [
    'sap/ui/core/mvc/Controller',
    'sap/ui/model/json/JSONModel',
    'sap/ui/model/Filter',
    'sap/ui/model/FilterOperator',
    'sap/m/MessageToast',
    'sap/m/MessageBox'
  ],
  function (Controller, JSONModel, Filter, FilterOperator, MessageToast, MessageBox) {
    'use strict'

    return Controller.extend('loyaltydashboard.controller.Main', {

      onInit: function () {
        const ui = new JSONModel({
          userName: '',
          userEmail: '',
          isAdmin: false,
          isStaff: false,
          isCustomer: false,
          customers: [],
          policies: [],
          selected: { customerID: '', name: '', totalPoints: 0, lifetimePoints: 0, tier: '' },
          kpis: { customers: '–', pointsIssued: '–', pointsRedeemed: '–', transactions: '–', redemptions: '–' }
        })
        this.getView().setModel(ui, 'ui')
        this._bootstrap().catch((err) => this._error(this._i18n('errRequest'), err))
      },

      // ---------- bootstrap ----------

      _api: function (path) { return 'odata/v4/loyalty/' + path },

      _fetch: async function (path) {
        const res = await fetch(this._api(path))
        if (!res.ok) throw new Error(path + ' → ' + res.status)
        return res.json()
      },

      _bootstrap: async function () {
        // 1. who am I (roles from the XSUAA JWT)
        let user
        try {
          const j = await this._fetch('getUserInfo()')
          user = j.value || j
        } catch (e) {
          user = { name: '', email: '', isAdmin: false, isStaff: false, isCustomer: false }
        }
        const ui = this.getView().getModel('ui')
        ui.setProperty('/userName', user.name || user.id || '')
        ui.setProperty('/userEmail', user.email || '')
        ui.setProperty('/isAdmin', !!user.isAdmin)
        ui.setProperty('/isStaff', !!user.isStaff)
        ui.setProperty('/isCustomer', !!user.isCustomer)
        this._user = user

        // 2. reference data: customers (for pickers), policies (rate hints)
        //    customer role: backend already restricts Customers to own email
        const [custRes, polRes] = await Promise.all([
          this._fetch('Customers?$select=customerID,name,email,totalPoints,lifetimePoints,tier&$orderby=name'),
          this._fetch('RewardPolicies?$select=policyID,channel,pointsPerCurrencyUnit').catch(() => ({ value: [] }))
        ])
        const customers = (custRes.value || []).map((c) => ({
          customerID: c.customerID,
          name: c.name,
          email: c.email,
          totalPoints: c.totalPoints,
          lifetimePoints: c.lifetimePoints,
          tier: c.tier
        }))
        ui.setProperty('/customers', customers)
        ui.setProperty('/policies', polRes.value || [])

        // customer role: auto-select own record
        if (user.isCustomer && customers.length) {
          const mine = customers.find(
            (c) => (c.email || '').toLowerCase() === (user.email || '').toLowerCase()
          ) || customers[0]
          this.byId('custPicker').setSelectedKey(mine.customerID)
          this._selectCustomer(mine.customerID)
        } else if (customers.length) {
          this.byId('custPicker').setSelectedKey(customers[0].customerID)
          this._selectCustomer(customers[0].customerID)
        }

        // no history until a customer is chosen
        this._applyHistoryFilters('')

        if (user.isAdmin || user.isStaff) this.refreshKpis()
        this.onRateHintRefresh()
      },

      refreshKpis: async function () {
        try {
          const [c, t, r, pt, pr] = await Promise.all([
            this._fetch('Customers/$count'),
            this._fetch('Transactions/$count'),
            this._fetch('Redemptions/$count'),
            this._fetch('Transactions?$apply=' + encodeURIComponent('aggregate(pointsEarned with sum as total)')),
            this._fetch('Redemptions?$apply=' + encodeURIComponent('aggregate(pointsUsed with sum as total)'))
          ])
          const agg = (j) => String((j.value && j.value[0] && j.value[0].total) || 0)
          const k = this.getView().getModel('ui')
          k.setProperty('/kpis/customers', String(c))
          k.setProperty('/kpis/transactions', String(t))
          k.setProperty('/kpis/redemptions', String(r))
          k.setProperty('/kpis/pointsIssued', agg(pt))
          k.setProperty('/kpis/pointsRedeemed', agg(pr))
        } catch (e) {
          // KPIs are decorative; ignore
        }
      },

      // ---------- customer selection ----------

      onCustomerSelect: function (evt) {
        this._selectCustomer(evt.getParameter('selectedItem').getKey())
      },

      _selectCustomer: function (id) {
        const c = this.getView().getModel('ui').getProperty('/customers').find((x) => x.customerID === id)
        if (!c) return
        const ui = this.getView().getModel('ui')
        ui.setProperty('/selected', {
          customerID: c.customerID, name: c.name,
          totalPoints: c.totalPoints, lifetimePoints: c.lifetimePoints, tier: c.tier
        })
        this._applyHistoryFilters(id)
      },

      _applyHistoryFilters: function (id) {
        const f = new Filter({ path: 'customerID_customerID', operator: FilterOperator.EQ, value: id || '' })
        const t = this.byId('purchaseHistory').getBinding('items')
        const r = this.byId('redemptionHistory').getBinding('items')
        if (t) t.filter(f)
        if (r) r.filter(f)
      },

      _refreshSelected: async function () {
        try {
          const id = this.getView().getModel('ui').getProperty('/selected/customerID')
          if (!id) return
          const j = await this._fetch(
            `Customers(${id})?$select=totalPoints,lifetimePoints,tier`)
          const c = j && !j.error ? j : null
          if (c) {
            const ui = this.getView().getModel('ui')
            ui.setProperty('/selected/totalPoints', c.totalPoints)
            ui.setProperty('/selected/lifetimePoints', c.lifetimePoints)
            ui.setProperty('/selected/tier', c.tier)
          }
          // refresh histories through the v4 model
          const t = this.byId('purchaseHistory').getBinding('items')
          const r = this.byId('redemptionHistory').getBinding('items')
          if (t) t.refresh()
          if (r) r.refresh()
        } catch (e) { /* next reload will resync */ }
      },

      // ---------- rate hint ----------

      onRateHintRefresh: function () {
        const ui = this.getView().getModel('ui')
        const channel = this.byId('purchaseChannel')
          ? this.byId('purchaseChannel').getSelectedKey() : 'Online'
        const amount = parseFloat(this.byId('purchaseAmount') ? this.byId('purchaseAmount').getValue() : '0')
        const pol = (ui.getProperty('/policies') || []).find((p) => p.channel === channel)
        if (!pol) { this.byId('rateHint').setText(''); return }
        const pts = Number.isFinite(amount) ? Math.floor(amount * pol.pointsPerCurrencyUnit) : 0
        this.byId('rateHint').setText(
          `₹1 = ${pol.pointsPerCurrencyUnit} pts (${channel}) — this purchase: ${pts} pts`
        )
      },

      // ---------- staff: record purchase ----------

      onRecordPurchase: async function () {
        const custKey = this.byId('purchaseCustomer').getSelectedKey()
        const channel = this.byId('purchaseChannel').getSelectedKey()
        const amount = parseFloat(this.byId('purchaseAmount').getValue())
        if (!custKey || !channel || !(amount > 0)) {
          return MessageToast.show(this._i18n('errFillAll'))
        }
        const model = this.getView().getModel()
        let ctx
        try {
          const list = model.bindList('/Transactions')
          ctx = list.create({
            customerID_customerID: custKey,
            channel: channel,
            amount: amount
          })
          await this._send(ctx)
          const pts = ctx.getProperty('pointsEarned')
          const cust = this.getView().getModel('ui').getProperty('/customers').find((x) => x.customerID === custKey)
          MessageToast.show(this._i18n('purchaseSuccess').replace('{0}', pts).replace('{1}', cust ? cust.name : ''))
          this.byId('purchaseAmount').setValue('')
          this.onRateHintRefresh()
          await Promise.all([this.refreshKpis(), this._refreshSelected()])
        } catch (err) {
          if (ctx && ctx.delete) { try { ctx.delete() } catch (e) { /* transient already gone */ } }
          this._error(this._i18n('errRequest'), err)
        }
      },

      // ---------- customer: redeem ----------

      onRedeem: async function () {
        const id = this.getView().getModel('ui').getProperty('/selected/customerID')
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
          const name = this.getView().getModel('ui').getProperty('/selected/name') || ''
          MessageToast.show(this._i18n('redeemSuccess').replace('{0}', pts).replace('{1}', name))
          this.byId('redeemPoints').setValue('')
          this.byId('redeemRemarks').setValue('')
          await Promise.all([this.refreshKpis(), this._refreshSelected()])
        } catch (err) {
          if (ctx && ctx.delete) { try { ctx.delete() } catch (e) { /* transient already gone */ } }
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
          // keep rate hints current
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
