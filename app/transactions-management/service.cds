using LoyaltyService from '../../srv/service';

@path: '/service/transactions'
service TransactionsService {
  entity Transactions as projection on LoyaltyService.Transactions;
}
