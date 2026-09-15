const cds = require('@sap/cds')
const EventBroker = require('../../cds-plugin.js')

async function initEventBroker() {
  const eb = new EventBroker()
  await eb.init()
  return eb
}

describe('event broker ORD integration (@OrdId annotation)', () => {
  let emitSpy

  beforeEach(() => {
    // single-tenant, IAS-only setup - simplest path through EventBroker#init()
    cds.env.requires = { myIas: { vcap: { label: 'identity' } } }
    cds.model = { definitions: {} }
    emitSpy = jest.spyOn(cds, 'emit')
  })

  afterEach(() => {
    emitSpy.mockRestore()
    delete cds.model
    delete cds.env.ord
  })

  function ordExtensionCalls() {
    return emitSpy.mock.calls.filter(([event]) => event === 'ord.extension.publish')
  }

  test('publishes an Integration Dependency for a consumed event annotated with @OrdId', async () => {
    cds.model.definitions['EventService.sap.demo.Test.Created.v1'] = {
      kind: 'event',
      '@OrdId': 'sap.demo:eventResource:TestEvents:v1'
    }

    const eb = await initEventBroker()
    eb.on('EventService.sap.demo.Test.Created.v1', () => {})
    await cds.emit('served')

    const calls = ordExtensionCalls()
    expect(calls).toHaveLength(1)

    const [, payload] = calls[0]
    expect(payload.id).toBe('event-broker-consumed-events')
    expect(payload.data.integrationDependencies[0].aspects[0].eventResources).toEqual([
      { ordId: 'sap.demo:eventResource:TestEvents:v1', subset: [{ eventType: 'EventService.sap.demo.Test.Created.v1' }] }
    ])
    // mandatory per ORD spec, derived from package.json name when not configured
    expect(payload.data.integrationDependencies[0].partOfPackage).toBe('customer.app:package:capjseventbroker:v1')
  })

  test('does not publish for events without an @OrdId annotation', async () => {
    cds.model.definitions['EventService.some.Unannotated.Event.v1'] = { kind: 'event' }

    const eb = await initEventBroker()
    eb.on('EventService.some.Unannotated.Event.v1', () => {})
    await cds.emit('served')

    expect(ordExtensionCalls()).toHaveLength(0)
  })

  test('does not publish for @OrdId-annotated events that are not actually consumed', async () => {
    cds.model.definitions['EventService.not.Subscribed.v1'] = {
      kind: 'event',
      '@OrdId': 'sap.demo:eventResource:TestEvents:v1'
    }

    await initEventBroker() // no eb.on(...) registered for the event above
    await cds.emit('served')

    expect(ordExtensionCalls()).toHaveLength(0)
  })

  test('ignores non-event definitions even if annotated with @OrdId', async () => {
    cds.model.definitions['EventService.SomeEntity'] = {
      kind: 'entity',
      '@OrdId': 'sap.demo:eventResource:TestEvents:v1'
    }

    await initEventBroker()
    await cds.emit('served')

    expect(ordExtensionCalls()).toHaveLength(0)
  })

  test('groups multiple consumed events under the same @OrdId', async () => {
    cds.model.definitions['EventService.BP.Changed.v1'] = {
      kind: 'event',
      '@OrdId': 'sap.s4:eventResource:CE_BUSINESSPARTNEREVENTS:v1'
    }
    cds.model.definitions['EventService.BP.Created.v1'] = {
      kind: 'event',
      '@OrdId': 'sap.s4:eventResource:CE_BUSINESSPARTNEREVENTS:v1'
    }

    const eb = await initEventBroker()
    eb.on('EventService.BP.Changed.v1', () => {})
    eb.on('EventService.BP.Created.v1', () => {})
    await cds.emit('served')

    const [, payload] = ordExtensionCalls()[0]
    const [eventResource] = payload.data.integrationDependencies[0].aspects[0].eventResources

    expect(eventResource.ordId).toBe('sap.s4:eventResource:CE_BUSINESSPARTNEREVENTS:v1')
    expect(eventResource.subset).toEqual(
      expect.arrayContaining([{ eventType: 'EventService.BP.Changed.v1' }, { eventType: 'EventService.BP.Created.v1' }])
    )
    expect(eventResource.subset).toHaveLength(2)
  })

  test('uses cds.env.ord.namespace for the integration dependency ordId, falling back to customer.app', async () => {
    cds.model.definitions['EventService.sap.demo.Test.Created.v1'] = {
      kind: 'event',
      '@OrdId': 'sap.demo:eventResource:TestEvents:v1'
    }

    const eb = await initEventBroker()
    eb.on('EventService.sap.demo.Test.Created.v1', () => {})
    cds.env.ord = { namespace: 'sap.demo' }
    await cds.emit('served')

    const [, payload] = ordExtensionCalls()[0]
    expect(payload.data.integrationDependencies[0].ordId).toBe('sap.demo:integrationDependency:consumedEvents:v1')
  })

  test('uses cds.env.ord.integrationDependency.partOfPackage to override the default partOfPackage', async () => {
    cds.model.definitions['EventService.sap.demo.Test.Created.v1'] = {
      kind: 'event',
      '@OrdId': 'sap.demo:eventResource:TestEvents:v1'
    }

    const eb = await initEventBroker()
    eb.on('EventService.sap.demo.Test.Created.v1', () => {})
    cds.env.ord = { integrationDependency: { partOfPackage: 'sap.demo:package:custom:v1' } }
    await cds.emit('served')

    const [, payload] = ordExtensionCalls()[0]
    expect(payload.data.integrationDependencies[0].partOfPackage).toBe('sap.demo:package:custom:v1')
  })
})
