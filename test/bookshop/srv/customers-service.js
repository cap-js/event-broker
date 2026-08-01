const cds = require('@sap/cds')

module.exports = class CustomersService extends cds.ApplicationService {
  async init() {
    const messaging = await cds.connect.to('messaging')

    messaging.on('Customer.Changed', async function (msg) {
      const { BusinessPartner } = msg.data
      await UPDATE('my.bookshop.Customers').set({ synchronized: true }).where({ BusinessPartner })
    })

    this.before('UPDATE', 'Customers', function (req) {
      req.data.synchronized = false
    })

    this.after('UPDATE', 'Customers', async function (data, req) {
      const { BusinessPartner } = await SELECT.one.from(req.subject)
      await messaging.emit('Customer.Changed', { BusinessPartner })
    })

    return super.init()
  }
}
