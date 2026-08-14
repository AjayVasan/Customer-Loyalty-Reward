sap.ui.define(['sap/ui/core/mvc/Controller'], function (Controller) {
  'use strict'
  return Controller.extend('loyaltydashboard.controller.Shell', {

    onInit: function () {
      // the App control exists once the shell view is instantiated; start
      // routing here so the initial hash is parsed and the first page shows
      this.getOwnerComponent().getRouter().initialize()
    }
  })
})
