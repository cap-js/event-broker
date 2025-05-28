const cds = require('@sap/cds')
cds.test.in(__dirname)
const DATA = { key1: 1, value1: 1 }
const HEADERS = { keyHeader1: 1, valueHeader1: 1 }
let messaging, ownSrv, extSrv

const mockHttps = {
  handleHttpReq: () => {
    throw new Error('must be implemented by test')
  },
  Agent: jest.fn(),
  request: jest.fn((_opts, cb) => {
    const EventEmitter = require('events')
    const res = new EventEmitter()
    cb(res)

    return {
      on() {},
      write(data) {
        res.emit('data', Buffer.from(JSON.stringify(mockHttps.handleHttpReq(data))))
        res.emit('end')
      }
    }
  })
}

jest.mock('https', () => {
  return mockHttps
})

describe('event-broker service', () => {
  const { POST } = cds.test()
  beforeAll(async () => {
    extSrv = await cds.connect.to('ExtSrv')
    ownSrv = await cds.connect.to('OwnSrv')
    messaging = await cds.connect.to('messaging')
  })
  beforeEach(() => {
    mockHttps.request.mockClear()
  })
  test('emit from app service', async () => {
    mockHttps.handleHttpReq = () => {
      return { message: 'ok' }
    }
    cds.context = { tenant: 't1', user: cds.User.privileged }
    await ownSrv.emit('created', { data: 'testdata', headers: { some: 'headers' } })
    expect(mockHttps.request).toHaveBeenCalledTimes(1)
    expect(mockHttps.request).toHaveBeenCalledWith(
      {
        hostname: 'mock.em.services.cloud.sap',
        method: 'POST',
        headers: {
          'ce-id': expect.anything(),
          'ce-source': '/cf-capmock/cap.test/t1',
          'ce-type': 'cap.test.object.created.v1',
          'ce-specversion': '1.0',
          'Content-Type': 'application/json'
        },
        agent: messaging.agent
      },
      expect.anything()
    )
  })

  test('can set custom cloudevents headers', async () => {
    mockHttps.handleHttpReq = () => {
      return { message: 'ok' }
    }
    cds.context = { tenant: 't1', user: cds.User.privileged }
    await ownSrv.emit(
      'created',
      {
        data: 'testdata'
      },
      {
        some: 'headers',
        id: 'customId',
        source: 'customSource',
        type: 'customType',
        specversion: 'customSpecVersion',
        datacontenttype: 'customDatacontenttype' // will not be used in content-type!
      }
    )
    expect(mockHttps.request).toHaveBeenCalledTimes(1)
    expect(mockHttps.request).toHaveBeenCalledWith(
      {
        hostname: 'mock.em.services.cloud.sap',
        method: 'POST',
        headers: {
          'ce-id': 'customId',
          'ce-source': 'customSource',
          'ce-type': 'customType',
          'ce-specversion': 'customSpecVersion',
          'Content-Type': 'application/json'
        },
        agent: messaging.agent
      },
      expect.anything()
    )
  })

  test('request without client cert', async () => {
    await expect(POST(`/-/cds/event-broker/webhook`)).rejects.toHaveProperty(
      'message',
      '401 - Request failed with status code 401'
    )
  })

  test('Event broker mock event - messaging service ', done => {
    messaging.on('cap.test.object.changed.v1', msg => {
      try {
        expect(msg.event).toBe('cap.test.object.changed.v1')
        expect(msg.inbound).toBe(true)
        expect(msg.data).toEqual(DATA)
        expect(msg.headers).toMatchObject(HEADERS)
        expect(msg.headers.type).toBe('cap.test.object.changed.v1')
        expect(cds.context.tenant).toEqual('t2')
        done()
      } catch (e) {
        done(e)
      }
    })
    const headers = {
      'ce-type': 'cap.test.object.changed.v1',
      'ce-sapconsumertenant': 't2',
      'x-ssl-client-verify': '0',
      'x-forwarded-client-cert': process.env.MOCK_CERT,
      'x-ssl-client-subject-cn': Buffer.from('capmockemcert').toString('base64')
    }
    POST(`/-/cds/event-broker/webhook`, { data: DATA, ...HEADERS }, { headers })
  })

  test('Accepts payload without data wrapper', done => {
    messaging.on('payloadWithoutDataWrapper', msg => {
      try {
        expect(msg.event).toBe('payloadWithoutDataWrapper')
        expect(msg.inbound).toBe(true)
        expect(msg.data).toEqual(DATA)
        expect(cds.context.tenant).toEqual('t2')
        done()
      } catch (e) {
        done(e)
      }
    })
    const headers = {
      'ce-type': 'payloadWithoutDataWrapper',
      'ce-sapconsumertenant': 't2',
      'x-ssl-client-verify': '0',
      'x-forwarded-client-cert': process.env.MOCK_CERT,
      'x-ssl-client-subject-cn': Buffer.from('capmockemcert').toString('base64')
    }
    POST(`/-/cds/event-broker/webhook`, DATA, { headers })
  })

  test('event broker mock event - external app service', done => {
    extSrv.on('changed', msg => {
      try {
        expect(msg.event).toBe('changed')
        expect(msg.data).toEqual(DATA)
        expect(msg.headers.type).toBe('cap.external.object.changed.v1')
        expect(msg.headers.mycustomheader).toBe('mycustomvalue')
        expect(msg.headers['x-ssl-client-verify']).toBeUndefined()
        expect(cds.context.http).toBeDefined()
        expect(cds.context.http.req).toBeDefined()
        expect(cds.context.http.res).toBeDefined()
        expect(msg.inbound).toBe(undefined)
        expect(cds.context.tenant).toEqual('t3')
        done()
      } catch (e) {
        done(e)
      }
    })
    const headers = {
      'ce-type': 'cap.external.object.changed.v1',
      'ce-sapconsumertenant': 't3',
      'ce-mycustomheader': 'mycustomvalue',
      'x-ssl-client-verify': '0',
      'x-forwarded-client-cert': process.env.MOCK_CERT,
      'x-ssl-client-subject-cn': Buffer.from('capmockemcert').toString('base64')
    }
    POST(`/-/cds/event-broker/webhook`, { data: DATA, ...HEADERS }, { headers })
  })
})
