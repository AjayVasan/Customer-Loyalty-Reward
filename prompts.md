**1. Customers app**

```
/fiori-gen-cap-ui
Build me a List Report Object Page app on the Customers entity from LoyaltyService. List page
columns: name, email, totalPoints, lifetimePoints, tier. On the object page I want three facets:
one showing the customer's purchases (that's the transactions navigation), one showing their
redemptions, and one called "Change History" showing the changes navigation. Hide the customerID
field everywhere, nobody needs to see a raw UUID.
```

**2. Transactions app**

```
/fiori-gen-cap-ui
Build me a List Report Object Page app on the Transactions entity from LoyaltyService. List
columns: txnDate, channel, amount, pointsEarned. The customer field on this entity needs a
value-help dropdown that searches by name and email, not a raw ID picker — wire it up as a
ValueList against Customers so staff can just type a customer's name when logging a purchase.
```

**3. Reward Policy app**

```
/fiori-gen-cap-ui
Build me a List Report Object Page app on the RewardPolicies entity from LoyaltyService. List
columns: channel, pointsPerCurrencyUnit. Add a "Change History" facet on the object page so admins
can see the history of rate changes. Hide policyID, it's just an internal key.
```

**4. Tier Threshold app**

```
/fiori-gen-cap-ui
Build me a List Report Object Page app on the TierThresholds entity from LoyaltyService. List
columns: tier, minLifetimePoints. Add a "Change History" facet on the object page, same as the
reward policy app, so admins can see when tier boundaries were last edited.
```
