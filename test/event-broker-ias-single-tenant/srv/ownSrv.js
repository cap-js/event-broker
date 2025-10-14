const cds = require('@sap/cds');
const { message } = require('@sap/cds/lib/log/cds-error');

module.exports = async () => {
  // Debug: Check CDS environment
  console.log('CDS requires.messaging:', JSON.stringify(cds.env.requires.messaging, null, 2));
  console.log('VCAP_SERVICES keys:', Object.keys(process.env.CAP_SERVICES ? JSON.parse(process.env.CAP_SERVICES) : 0));
  const messaging = await cds.connect.to("messaging")
  // Debug: Check the messaging service configuration
  console.log('Messaging service options:', JSON.stringify(messaging.options, null, 2));
  console.log('Messaging service credentials:', messaging.options?.credentials ? "Found" : "NOT FOUND");

  setInterval(async () => {
    let eventType = "ns.fh.employee.feedbackCollector-create.v1"

    try {
      await messaging.emit(eventType, {
        data: "testdata",
      });

      console.log(`SUCCESS: Event ${eventType} emitted successfully`);
    } catch (error) {
      console.log(`FAILURE: Failed to emit event ${eventType}`);
      console.log(`Error message:`, error.message);
      console.log(`Error details:`, error);
    }
  }, 5000);
}