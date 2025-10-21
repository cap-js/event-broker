service OwnSrv {
  @topic: 'cap.test.object.created.v1'
  event created {
    key ID1  : String;
    key ID2  : String;
        name : String;
  }

  action triggerEvent();
}
