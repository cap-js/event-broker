const cds = require('@sap/cds')
const EB = require('../../cds-plugin.js')

describe('event broker error handling', () => {
  beforeEach(() => {
    cds.env.requires = {}
  })

  test('no eb and ias credentials', async () => {
    const eb = new EB()
    try {
      await eb.init()
      expect(1).toBe('Should not reach here')
    } catch (e) {
      expect(e.message).toMatch(/to be bound to an IAS instance/)
    }
  })

  test('no eb credentials is not fine in multitenancy', async () => {
    cds.env.requires.multitenancy = true
    const eb = new EB()
    try {
      await eb.init()
      expect(1).toBe('Should not reach here')
    } catch (e) {
      expect(e.message).toMatch(/`certificate` not found/)
    }
  })

  test('in single-tenancy, ias is needed', async () => {
    const eb = new EB()
    try {
      await eb.init()
      expect(1).toBe('Should not reach here')
    } catch (e) {
      expect(e.message).toMatch(/to be bound to an IAS instance/)
    }
  })

  test('in single-tenancy receiver only, it is enough to have an IAS instance', async () => {
    const eb = new EB()
    cds.env.requires.myIas = { vcap: { label: 'identity' } }
    await eb.init()
    eb.startListening()
  })

  test('error in emit must throw ', async () => {
    const eb = new EB()
    eb.options.credentials = { ceSource: '/foo' /* leave out props to enforce failure */ }
    cds.env.requires.myIas = { vcap: { label: 'identity' } }
    await eb.init()
    expect(eb.emit('foo', { some: 'message' })).rejects.toThrow()
  })

  test('x509 but no cert[path]', async () => {
    const eb = new EB()
    eb.options.x509 = {}
    try {
      await eb.init()
      expect(1).toBe('Should not reach here')
    } catch (e) {
      expect(e.message).toMatch(/requires `x509.cert` or `x509.certPath`/)
    }
  })

  test('x509 but no pkey[path]', async () => {
    const eb = new EB()
    eb.options.x509 = { cert: 'cert' }
    try {
      await eb.init()
      expect(1).toBe('Should not reach here')
    } catch (e) {
      expect(e.message).toMatch(/requires `x509.pkey` or `x509.pkeyPath`/)
    }
  })

  test('multiple webhooks', async () => {
    cds.env.requires.myIas = { vcap: { label: 'identity' }, credentials: {} }

    cds.app = require('express')()

    const eb1 = new EB()
    eb1.options.webhookPath = '/-/cds/event-broker/webhook'
    await eb1.init()
    eb1.on('foo', () => {})
    eb1.startListening()

    const eb2 = new EB()
    eb2.options.webhookPath = '/-/cds/event-broker/webhook'
    await eb2.init()
    eb2.on('foo', () => {})
    try {
      eb2.startListening()
    } catch (e) {
      expect(e.message).toMatch(/endpoint already registered/)
    }
  })
})
