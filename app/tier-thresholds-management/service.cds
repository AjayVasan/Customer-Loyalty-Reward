using LoyaltyService from '../../srv/service';

@path: '/service/tier-thresholds'
service TierThresholdsService {
  entity TierThresholds as projection on LoyaltyService.TierThresholds;
}
