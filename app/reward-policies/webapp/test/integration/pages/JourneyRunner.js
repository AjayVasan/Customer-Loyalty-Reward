sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"rewardpolicies/test/integration/pages/RewardPoliciesList.gen",
	"rewardpolicies/test/integration/pages/RewardPoliciesObjectPage.gen"
], function (JourneyRunner, RewardPoliciesListGenerated, RewardPoliciesObjectPageGenerated) {
    'use strict';

    const runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('rewardpolicies') + '/test/flp.html#app-preview',
        pages: {
			onTheRewardPoliciesListGenerated: RewardPoliciesListGenerated,
			onTheRewardPoliciesObjectPageGenerated: RewardPoliciesObjectPageGenerated
        },
        async: true
    });

    return runner;
});

