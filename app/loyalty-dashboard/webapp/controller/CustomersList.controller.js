sap.ui.define(
  [
    'sap/ui/core/mvc/Controller',
    'sap/ui/model/json/JSONModel',
    'sap/m/MessageToast',
    'sap/m/MessageBox',
    'sap/m/Dialog',
    'sap/m/Button',
    'sap/m/Text',
    'sap/m/VBox',
    'sap/m/Label'
  ],
  function (Controller, JSONModel, MessageToast, MessageBox, Dialog, Button, MText, VBox, MLabel) {
    'use strict'

    return Controller.extend('loyaltydashboard.controller.CustomersList', {

      onInit: function () {
        const ui = new JSONModel({
          adminMode: false,
          customers: [],
          all: [],
          shown: 0
        })
        this.getView().setModel(ui, 'ui')
        this.getOwnerComponent().getRouter()
          .getRoute('customersList')
          .attachPatternMatched(this._onRouteMatched, this)
      },

      _onRouteMatched: async function (evt) {
        const mode = evt.getParameter('arguments').mode || 'staff'
        const ui = this.getView().getModel('ui')
        ui.setProperty('/adminMode', mode === 'admin')
        try {
          const select = 'customerID,name,email,tier'
            + (mode === 'admin' ? ',totalPoints,lifetimePoints' : '')
          const res = await this._fetch('Customers?$select=' + select + '&$orderby=' + encodeURIComponent('name asc'))
          ui.setProperty('/all', res.value || [])
          ui.setProperty('/customers', res.value || [])
          ui.setProperty('/shown', (res.value || []).length)
        } catch (err) {
          MessageBox.error(this._i18n('errRequest') + '\n' + (err.message || err))
        }
      },

      _api: function (path) { return 'odata/v4/loyalty/' + path },

      _fetch: async function (path) {
        const res = await fetch(this._api(path), { headers: { Accept: 'application/json' } })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error?.message || res.status + ' ' + res.statusText)
        return body
      },

      onSearch: function (evt) {
        const q = (evt.getParameter('newValue') || '').toLowerCase().trim()
        const ui = this.getView().getModel('ui')
        const all = ui.getProperty('/all') || []
        const filtered = q
          ? all.filter((c) => (c.name || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q))
          : all
        ui.setProperty('/customers', filtered)
        ui.setProperty('/shown', filtered.length)
      },

      // admin drill-down: per-customer purchase + redemption detail
      onRowPress: async function (evt) {
        const ui = this.getView().getModel('ui')
        if (!ui.getProperty('/adminMode')) return
        const cust = evt.getSource().getBindingContext('ui').getObject()
        try {
          const filter = encodeURIComponent('customerID eq ' + cust.customerID)
          const [txns, reds] = await Promise.all([
            this._fetch('Transactions?$select=txnDate,channel,amount,pointsEarned&$filter=' + filter + '&$orderby=' + encodeURIComponent('txnDate desc')),
            this._fetch('Redemptions?$select=redeemDate,pointsUsed,remarks&$filter=' + filter + '&$orderby=' + encodeURIComponent('redeemDate desc'))
          ])
          const lines = []
          lines.push(cust.name + ' · ' + cust.email + ' · ' + cust.tier
            + ' · ' + cust.totalPoints + ' pts · lifetime ' + cust.lifetimePoints)
          lines.push('')
          lines.push('Purchases (' + ((txns.value || []).length) + '):')
          ;(txns.value || []).forEach((t) => {
            lines.push('  ' + (t.txnDate || '') + ' · ' + t.channel + ' · ₹' + t.amount + ' · +' + t.pointsEarned + ' pts')
          })
          if (!(txns.value || []).length) lines.push('  —')
          lines.push('')
          lines.push('Redemptions (' + ((reds.value || []).length) + '):')
          ;(reds.value || []).forEach((r) => {
            lines.push('  ' + (r.redeemDate || '') + ' · -' + r.pointsUsed + ' pts · ' + (r.remarks || ''))
          })
          if (!(reds.value || []).length) lines.push('  —')
          new Dialog({
            title: this._i18n('detailDialogTitle'),
            contentWidth: '560px',
            content: new VBox({
              items: lines.map((l) => new MText({ text: l }).addStyleClass('sapUiTinyMarginBegin'))
            }),
            beginButton: new Button({ text: 'Close', press: function () { this.getParent().close() } }),
            afterClose: function (d) { d.destroy() }
          }).open()
        } catch (err) {
          MessageBox.error(this._i18n('errRequest') + '\n' + (err.message || err))
        }
      },
      onNavBack: function () {
        window.history.back()
      },

      _i18n: function (key) {
        return (this.getOwnerComponent().getModel('i18n') || { getProperty: (k) => k }).getProperty(key) || key
      }
    })
  }
)
