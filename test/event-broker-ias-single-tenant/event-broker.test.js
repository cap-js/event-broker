const cds = require('@sap/cds')
cds.test.in(__dirname)
const DATA = { key1: 1, value1: 1 }
const HEADERS = { keyHeader1: 1, valueHeader1: 1 }
let messaging, ownSrv, extSrv, credentials

const mockHttps = {
  handleHttpReq: () => {
    throw new Error('must be implemented by test')
  },
  Agent: jest.fn(({ cert, key }) => {
    if (cert !== 'dummyCert' || key !== 'dummyKey') throw new Error('invalid agent')
  }),
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

describe('event-broker service with ias auth for single tenant scenario', () => {
  const { POST } = cds.test()

  beforeAll(async () => {
    extSrv = await cds.connect.to('ExtSrv')
    ownSrv = await cds.connect.to('OwnSrv')
    messaging = await cds.connect.to('messaging')
    credentials = messaging.options.credentials
  })
  beforeEach(() => {
    mockHttps.request.mockClear()
    messaging.options.credentials = credentials
  })

  test('emit from app service', async () => {
    mockHttps.handleHttpReq = () => {
      return { message: 'ok' }
    }
    cds.context = { tenant: 't1', user: cds.User.privileged }
    try {
      await ownSrv.emit('created', { data: 'testdata', headers: { some: 'headers' } })
      expect(1).toBe('Should not be supported')
    } catch (e) {
      expect(e.message).toMatch(/not supported/)
    }
  })

  test('no creds and emit from app service', async () => {
    delete messaging.options.credentials
    mockHttps.handleHttpReq = () => {
      return { message: 'ok' }
    }
    cds.context = { tenant: 't1', user: cds.User.privileged }
    try {
      await ownSrv.emit('created', { data: 'testdata', headers: { some: 'headers' } })
      expect(1).toBe('Should not be supported')
    } catch (e) {
      expect(e.message).toMatch(/No credentials/)
    }
  })

  test('request without JWT token', async () => {
    await expect(POST(`/-/cds/event-broker/webhook`)).rejects.toHaveProperty(
      'message',
      expect.stringMatching('Request failed with status code 401')
    )
  })

  test('request with invalid JWT token', async () => {
    await expect(
      POST(`/-/cds/event-broker/webhook`, { some: 'data' }, { headers: { Authorization: 'Bearer invalidtoken' } })
    ).rejects.toHaveProperty('message', expect.stringMatching('Request failed with status code 401'))
  })

  test('Event broker mock event - messaging service ', done => {
    messaging.on('cap.test.object.changed.v1', msg => {
      try {
        expect(msg.event).toBe('cap.test.object.changed.v1')
        expect(msg.inbound).toBe(true)
        expect(msg.data).toEqual(DATA)
        expect(msg.headers).toMatchObject(HEADERS)
        expect(msg.headers.type).toBe('cap.test.object.changed.v1')
        expect(cds.context.tenant).toEqual('dummyZoneId') // not t2
        done()
      } catch (e) {
        done(e)
      }
    })
    const headers = {
      'ce-type': 'cap.test.object.changed.v1',
      'ce-sapconsumertenant': 't2', // must be ignored
      Authorization: 'Bearer dummyToken'
    }
    POST(`/-/cds/event-broker/webhook`, { data: DATA, ...HEADERS }, { headers })
  })

  test('Accepts payload without data wrapper', done => {
    messaging.on('payloadWithoutDataWrapper', msg => {
      try {
        expect(msg.event).toBe('payloadWithoutDataWrapper')
        expect(msg.inbound).toBe(true)
        expect(msg.data).toEqual(DATA)
        expect(cds.context.tenant).toEqual('dummyZoneId')
        done()
      } catch (e) {
        done(e)
      }
    })
    const headers = {
      'ce-type': 'payloadWithoutDataWrapper',
      'ce-sapconsumertenant': 't2',
      Authorization: 'Bearer dummyToken'
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
        expect(cds.context.tenant).toEqual('dummyZoneId')
        done()
      } catch (e) {
        done(e)
      }
    })
    const headers = {
      'ce-type': 'cap.external.object.changed.v1',
      'ce-sapconsumertenant': 't3',
      'ce-mycustomheader': 'mycustomvalue',
      Authorization: 'Bearer dummyToken'
    }
    POST(`/-/cds/event-broker/webhook`, { data: DATA, ...HEADERS }, { headers })
  })

  test('event handler throws error', async () => {
    extSrv.on('changed', () => {
      throw new Error("won't handle that message!")
    })
    const headers = {
      'ce-type': 'cap.external.object.changed.v1',
      'ce-sapconsumertenant': 't3',
      'ce-mycustomheader': 'mycustomvalue',
      Authorization: 'Bearer dummyToken'
    }
    try {
      await POST(`/-/cds/event-broker/webhook`, { data: DATA, ...HEADERS }, { headers })
      expect(1).toBe('should not reach here')
    } catch (e) {
      expect(e.code).toBe('ERR_BAD_RESPONSE')
    }
  })
})
