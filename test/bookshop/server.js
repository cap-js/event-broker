const cds = require('@sap/cds')

cds.on('served', async () => {
  if (cds.env.requires.messaging.kind === 'event-broker') await cds.connect.to('ucl')
})
