const cds = require('@sap/cds');

module.exports = async (srv) => {

  const messaging = await cds.connect.to('messaging')
  messaging.on('someEvent', () => { })

  srv.on('triggerEvent', async () => {
    let eventType = "ns.fh.employee.feedbackCollector-create.v1"

    await messaging.emit(eventType, {
      data: "testdata",
    });
  })
}