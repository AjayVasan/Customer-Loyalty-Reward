using { LoyaltyService } from './service';

annotate LoyaltyService.Customers with @(
  UI: {
    HeaderInfo: {
      TypeName: 'Customer', TypeNamePlural: 'Customers',
      Title: { Value: name }
    },
    LineItem: [
      { Value: name }, { Value: email }, { Value: totalPoints }, { Value: lifetimePoints }, { Value: tier }
    ],
    Facets: [
      { $Type: 'UI.ReferenceFacet', Label: 'Purchases', Target: 'transactions/@UI.LineItem' },
      { $Type: 'UI.ReferenceFacet', Label: 'Redemptions', Target: 'redemptions/@UI.LineItem' },
      { $Type: 'UI.ReferenceFacet', Label: 'Change History', Target: 'changes/@UI.PresentationVariant' }
    ]
  }
) {
  customerID @UI.Hidden;
};

annotate LoyaltyService.Transactions with @(
  UI.LineItem: [
    { Value: txnDate }, { Value: channel }, { Value: amount }, { Value: pointsEarned }
  ]
);

annotate LoyaltyService.Transactions with {
  customerID @(
    Common: {
      Text: customerID.name,
      TextArrangement: #TextOnly,
      ValueList: {
        Label: 'Customers',
        CollectionPath: 'Customers',
        Parameters: [
          { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: customerID_customerID, ValueListProperty: 'customerID' },
          { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' },
          { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'email' }
        ]
      }
    }
  )
};

annotate LoyaltyService.Redemptions with @(
  UI.LineItem: [
    { Value: redeemDate }, { Value: pointsUsed }, { Value: remarks }
  ]
);

annotate LoyaltyService.RewardPolicies with @(
  UI: {
    HeaderInfo: { TypeName: 'Reward Policy', TypeNamePlural: 'Reward Policies', Title: { Value: channel } },
    LineItem: [ { Value: channel }, { Value: pointsPerCurrencyUnit } ],
    Facets: [ { $Type: 'UI.ReferenceFacet', Label: 'Change History', Target: 'changes/@UI.PresentationVariant' } ]
  }
) {
  policyID @UI.Hidden;
};

annotate LoyaltyService.TierThresholds with @(
  UI: {
    HeaderInfo: { TypeName: 'Tier Threshold', TypeNamePlural: 'Tier Thresholds', Title: { Value: tier } },
    LineItem: [ { Value: tier }, { Value: minLifetimePoints } ],
    Facets: [ { $Type: 'UI.ReferenceFacet', Label: 'Change History', Target: 'changes/@UI.PresentationVariant' } ]
  }
);
