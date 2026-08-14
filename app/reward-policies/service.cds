using LoyaltyService from '../../srv/service';

@path: '/service/reward-policies'
service RewardPoliciesService {
  entity RewardPolicies as projection on LoyaltyService.RewardPolicies;
}
