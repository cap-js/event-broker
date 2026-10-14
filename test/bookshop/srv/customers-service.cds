using my.bookshop as my from '../db/schema';

@requires: 'admin'
service CustomersService {
  entity Customers as projection on my.Customers;

  event Customer.Changed @(topic: 'sap.s4.beh.businesspartner.v1.BusinessPartner.Changed.v1') {
    BusinessPartner : String
  }
}
