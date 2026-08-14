sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"transactionsmanagement/test/integration/pages/TransactionsList.gen",
	"transactionsmanagement/test/integration/pages/TransactionsObjectPage.gen"
], function (JourneyRunner, TransactionsListGenerated, TransactionsObjectPageGenerated) {
    'use strict';

    const runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('transactionsmanagement') + '/test/flp.html#app-preview',
        pages: {
			onTheTransactionsListGenerated: TransactionsListGenerated,
			onTheTransactionsObjectPageGenerated: TransactionsObjectPageGenerated
        },
        async: true
    });

    return runner;
});

