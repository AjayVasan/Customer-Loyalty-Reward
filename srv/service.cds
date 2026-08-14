using { loyalty } from '../db/schema';

@path: '/odata/v4/loyalty'
service LoyaltyService @(requires: 'authenticated-user') {

  entity Customers      as projection on loyalty.Customer;
  entity Transactions   as projection on loyalty.Transaction;
  entity Redemptions    as projection on loyalty.Redemption;
  entity RewardPolicies as projection on loyalty.RewardPolicy;
  entity TierThresholds as projection on loyalty.TierThreshold;

  type UserInfo : {
    id        : String;
    email     : String;
    name      : String;
    isAdmin   : Boolean;
    isStaff   : Boolean;
    isCustomer: Boolean;
  };

  function getUserInfo() returns UserInfo;
}


annotate LoyaltyService.Customers with @(restrict: [
  { grant: 'READ', to: 'admin' },
  { grant: 'READ', to: 'staff' },
  { grant: ['READ', 'CREATE'], to: 'customer', where: 'email = $user.email' },
  { grant: 'CREATE', to: 'staff' },
  { grant: 'CREATE', to: 'admin' }
]);

annotate LoyaltyService.Transactions with @(restrict: [
  { grant: ['READ', 'CREATE'], to: 'admin' },
  { grant: ['READ', 'CREATE'], to: 'staff' },
  { grant: 'READ', to: 'customer', where: 'customerID.email = $user.email' }
]);

annotate LoyaltyService.Redemptions with @(restrict: [
  { grant: ['READ', 'CREATE'], to: 'admin' },
  { grant: ['READ', 'CREATE'], to: 'customer', where: 'customerID.email = $user.email' }
]);

annotate LoyaltyService.RewardPolicies with @(restrict: [
  { grant: '*', to: 'admin' },
  { grant: 'READ', to: 'staff' }
]);

annotate LoyaltyService.TierThresholds with @(restrict: [
  { grant: '*', to: 'admin' }
]);
annotate LoyaltyService.Customers {
  totalPoints    @changelog;
  lifetimePoints @changelog;
  tier           @changelog;
};

annotate LoyaltyService.RewardPolicies {
  pointsPerCurrencyUnit @changelog;
};

annotate LoyaltyService.TierThresholds {
  minLifetimePoints @changelog;
};
