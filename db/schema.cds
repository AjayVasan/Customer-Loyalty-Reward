using { managed } from '@sap/cds/common';

namespace loyalty;

entity Customer : managed {
  key customerID   : UUID;
  name             : String(120);
  email            : String(254);
  totalPoints      : Integer default 0;
  lifetimePoints   : Integer default 0;
  tier             : String(10) default 'Bronze';
  transactions     : Association to many Transaction on transactions.customerID = $self;
  redemptions      : Association to many Redemption on redemptions.customerID = $self;
}

entity Transaction : managed {
  key txnID        : UUID;
  customerID       : Association to Customer;
  channel          : String(10) enum { Online; Store };
  // product list price entered at purchase time (₹0.50-denominated by the service)
  price            : Decimal(10,2) default 0;
  // reward points applied as part-payment (1 pt = POINT_VALUE_INR, see lib/point-value)
  pointsApplied    : Integer default 0;
  // cash payable after points: price − pointsApplied × point value
  amount           : Decimal(10,2);
  txnDate          : DateTime;
  pointsEarned     : Integer default 0;
}

entity Redemption : managed {
  key redeemID     : UUID;
  customerID       : Association to Customer;
  pointsUsed       : Integer;
  redeemDate       : DateTime;
  remarks          : String(255);
}

entity RewardPolicy : managed {
  key policyID             : UUID;
  channel                  : String(10) enum { Online; Store };
  pointsPerCurrencyUnit    : Decimal(5,2);
}

entity TierThreshold : managed {
  key tier             : String(10);
  minLifetimePoints    : Integer;
}

annotate RewardPolicy with @assert.unique: { channel: [ channel ] };