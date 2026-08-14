using LoyaltyService from '../../srv/service';

@path: '/service/customers'
service CustomersService {
  entity Customers as projection on LoyaltyService.Customers;
}
