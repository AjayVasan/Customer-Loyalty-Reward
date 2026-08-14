sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"tierthresholdsmanagement/test/integration/pages/TierThresholdsList.gen",
	"tierthresholdsmanagement/test/integration/pages/TierThresholdsObjectPage.gen"
], function (JourneyRunner, TierThresholdsListGenerated, TierThresholdsObjectPageGenerated) {
    'use strict';

    const runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('tierthresholdsmanagement') + '/test/flp.html#app-preview',
        pages: {
			onTheTierThresholdsListGenerated: TierThresholdsListGenerated,
			onTheTierThresholdsObjectPageGenerated: TierThresholdsObjectPageGenerated
        },
        async: true
    });

    return runner;
});

