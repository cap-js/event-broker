namespace my.bookshop;

entity Books {
  key ID    : Integer;
      title : String;
      stock : Integer;
}

entity Customers {
  key ID                     : Integer;
      name                   : String;
      BusinessPartner        : String;
      @readonly synchronized : Boolean;
}
