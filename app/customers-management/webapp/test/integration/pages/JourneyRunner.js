sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"customersmanagement/test/integration/pages/CustomersList.gen",
	"customersmanagement/test/integration/pages/CustomersObjectPage.gen"
], function (JourneyRunner, CustomersListGenerated, CustomersObjectPageGenerated) {
    'use strict';

    const runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('customersmanagement') + '/test/flp.html#app-preview',
        pages: {
			onTheCustomersListGenerated: CustomersListGenerated,
			onTheCustomersObjectPageGenerated: CustomersObjectPageGenerated
        },
        async: true
    });

    return runner;
});

