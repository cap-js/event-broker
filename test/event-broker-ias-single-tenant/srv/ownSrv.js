const cds = require('@sap/cds');

module.exports = async () => {

  const messaging = await cds.connect.to('messaging')
  messaging.on('someEvent', () => { })

  setInterval(async () => {
    let eventType = "ns.fh.employee.feedbackCollector-create.v1"

    try {
      await messaging.emit(eventType, {
        data: "testdata",
      });

      console.log(`SUCCESS: Event ${eventType} emitted successfully`);
    } catch (error) {
      console.log(`FAILURE: Failed to emit event ${eventType}`);
      console.log(`Error details:`, error);
    }
  }, 5000);
}