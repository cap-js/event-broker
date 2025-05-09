const cds = require('@sap/cds')
const CDS_8 = cds.version.split('.')[0] < 9

const express = require('express')
const https = require('https')
const crypto = require('crypto')

const _JSONorString = string => {
  try {
    return JSON.parse(string)
  } catch {
    return string
  }
}

// Some messaging systems don't adhere to the standard that the payload has a `data` property.
// For these cases, we interpret the whole payload as `data`.
const normalizeIncomingMessage = message => {
  const _payload = typeof message === 'object' ? message : _JSONorString(message)
  let data, headers
  if (typeof _payload === 'object' && 'data' in _payload) {
    data = _payload.data
    headers = { ..._payload }
    delete headers.data
  } else {
    data = _payload
    headers = {}
  }

  if (CDS_8) return { data, headers, inbound: true }
  return { data, headers }
}

const usedWebhookEndpoints = new Set()

async function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      const chunks = []
      res.on('data', chunk => {
        chunks.push(chunk)
      })
      res.on('end', () => {
        const response = {
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString()
        }
        if (res.statusCode > 299) {
          reject({ message: response.body })
        } else {
          resolve(response)
        }
      })
    })
    req.on('error', error => {
      reject(error)
    })
    if (data) {
      req.write(JSON.stringify(data))
    }
    req.end()
  })
}

function _validateCertificate(req, res, next) {
  this.LOG._debug && this.LOG.debug('event broker trying to authenticate via mTLS')

  if (req.headers['x-ssl-client-verify'] !== '0') {
    this.LOG._debug && this.LOG.debug('cf did not validate client certificate.')
    return res.status(401).json({ message: 'Unauthorized' })
  }

  if (!req.headers['x-forwarded-client-cert']) {
    this.LOG._debug && this.LOG.debug('no certificate in xfcc header.')
    return res.status(401).json({ message: 'Unauthorized' })
  }

  const clientCertObj = new crypto.X509Certificate(
    `-----BEGIN CERTIFICATE-----\n${req.headers['x-forwarded-client-cert']}\n-----END CERTIFICATE-----`
  )
  const clientCert = clientCertObj.toLegacyObject()

  if (!this.isMultitenancy && !clientCertObj.checkPrivateKey(this.auth.privateKey))
    return res.status(401).json({ message: 'Unauthorized' })

  const cfSubject = Buffer.from(req.headers['x-ssl-client-subject-cn'], 'base64').toString()
  if (
    this.auth.validationCert.subject.CN !== clientCert.subject.CN ||
    this.auth.validationCert.subject.CN !== cfSubject
  ) {
    this.LOG._debug && this.LOG.debug('certificate subject does not match')
    return res.status(401).json({ message: 'Unauthorized' })
  }
  this.LOG._debug && this.LOG.debug('incoming Subject CN is valid.')

  if (this.auth.validationCert.issuer.CN !== clientCert.issuer.CN) {
    this.LOG._debug && this.LOG.debug('Certificate issuer subject does not match')
    return res.status(401).json({ message: 'Unauthorized' })
  }
  this.LOG._debug && this.LOG.debug('incoming issuer subject CN is valid.')

  if (this.auth.validationCert.issuer.O !== clientCert.issuer.O) {
    this.LOG._debug && this.LOG.debug('Certificate issuer org does not match')
    return res.status(401).json({ message: 'Unauthorized' })
  }
  this.LOG._debug && this.LOG.debug('incoming Issuer Org is valid.')

  if (this.auth.validationCert.issuer.OU !== clientCert.issuer.OU) {
    this.LOG._debug && this.LOG.debug('certificate issuer OU does not match')
    return res.status(401).json({ message: 'Unauthorized' })
  }
  this.LOG._debug && this.LOG.debug('certificate issuer OU is valid.')

  const valid_from = new Date(clientCert.valid_from)
  const valid_to = new Date(clientCert.valid_to)
  const now = new Date(Date.now())
  if (valid_from <= now && valid_to >= now) {
    this.LOG._debug && this.LOG.debug('certificate validation completed')
    next()
  } else {
    this.LOG.error('Certificate expired')
    return res.status(401).json({ message: 'Unauthorized' })
  }
}

class EventBroker extends cds.MessagingService {
  async init() {
    await super.init()
    cds.once('listening', () => {
      this.startListening()
    })
    this.isMultitenancy = cds.env.requires.multitenancy || cds.env.profiles.includes('mtx-sidecar')

    this.auth = {} // { kind: 'cert', validationCert?, privateKey? } or { kind: 'ias', ias }

    // determine auth.kind
    if (this.options.x509) {
      if (!this.options.x509.cert && !this.options.x509.certPath)
        throw new Error(`${this.name}: Event Broker with x509 option requires \`x509.cert\` or \`x509.certPath\`.`)
      if (!this.options.x509.pkey && !this.options.x509.pkeyPath)
        throw new Error(`${this.name}: Event Broker with x509 option requires \`x509.pkey\` or \`x509.pkeyPath\`.`)
      this.auth.kind = 'cert' // byo cert, unofficial
    } else {
      let ias
      for (const k in cds.env.requires) {
        const r = cds.env.requires[k]
        if (r.vcap?.label === 'identity' || r.kind === 'ias') ias = r
      }
      // multitenant receiver-only services don't need x509, check for ias existence
      if (!this.isMultitenancy || ias) {
        this.auth.kind = 'ias'
        this.auth.ias = ias
      } else this.auth.kind = 'cert'
    }

    if (!this.auth.kind || (this.auth.kind === 'ias' && !this.auth.ias))
      throw new Error(`${this.name}: Event Broker requires your app to be bound to an IAS instance.`)

    if (this.auth.kind === 'cert') {
      if (this.isMultitenancy && !this.options.credentials?.certificate)
        throw new Error(
          `${this.name}: \`certificate\` not found in Event Broker binding information. You need to bind your app to an Event Broker instance.`
        )
      this.auth.validationCert = new crypto.X509Certificate(
        this.isMultitenancy ? this.options.credentials.certificate : this.agent.options.cert
      ).toLegacyObject()
      this.auth.privateKey = !this.isMultitenancy && crypto.createPrivateKey(this.agent.options.key)
    }

    this.LOG._debug && this.LOG.debug('using auth: ' + this.auth.kind)
  }

  get agent() {
    return (this.__agentCache ??=
      this.auth.kind === 'ias'
        ? new https.Agent({
            cert: this.auth.ias.credentials.certificate,
            key: this.auth.ias.credentials.key
          })
        : new https.Agent({
            cert:
              this.options.x509.cert ??
              cds.utils.fs.readFileSync(cds.utils.path.resolve(cds.root, this.options.x509.certPath)),
            key:
              this.options.x509.pkey ??
              cds.utils.fs.readFileSync(cds.utils.path.resolve(cds.root, this.options.x509.pkeyPath))
          }))
  }

  async handle(msg) {
    if (msg.inbound) return super.handle(msg)
    if (!this.options.credentials) throw new Error(`${this.name}: No credentials found for Event Broker service.`)
    if (!this.options.credentials.ceSource)
      throw new Error(`${this.name}: Emitting events is not supported by Event Broker plan \`event-connectivity\`.`)
    const _msg = this.message4(msg)
    await this.emitToEventBroker(_msg)
  }

  startListening() {
    if (!this._listenToAll.value && !this.subscribedTopics.size) return
    this.registerWebhookEndpoints()
  }

  async emitToEventBroker(msg) {
    // TODO: CSN definition probably not needed, just in case...
    //   See if there's a CSN entry for that event
    //   const found = cds?.model.definitions[topicOrEvent]
    //   if (found) return found  // case for fully-qualified event name
    //   for (const def in cds.model?.definitions) {
    //     const definition = cds.model.definitions[def]
    //     if (definition['@topic'] === topicOrEvent) return definition
    //   }

    try {
      const hostname = this.options.credentials.eventing.http.x509.url.replace(/^https?:\/\//, '')

      // take over and cleanse cloudevents headers
      const headers = { ...(msg.headers ?? {}) }

      const ceId = headers.id
      delete headers.id

      const ceSource = headers.source
      delete headers.source

      const ceType = headers.type
      delete headers.type

      const ceSpecversion = headers.specversion
      delete headers.specversion

      // const ceDatacontenttype = headers.datacontenttype // not part of the HTTP API
      delete headers.datacontenttype

      // const ceTime  = headers.time // not part of the HTTP API
      delete headers.time

      const options = {
        hostname: hostname,
        method: 'POST',
        headers: {
          'ce-id': ceId,
          'ce-source': ceSource,
          'ce-type': ceType,
          'ce-specversion': ceSpecversion,
          'Content-Type': 'application/json' // because of { data, ...headers } format
        },
        agent: this.agent
      }
      this.LOG._debug && this.LOG.debug('HTTP headers:', JSON.stringify(options.headers))
      this.LOG._debug && this.LOG.debug('HTTP body:', JSON.stringify(msg.data))
      // what about headers?
      // TODO: Clarify if we should send `{ data, ...headers }` vs.  `data` + HTTP headers (`ce-*`)
      //       Disadvantage with `data` + HTTP headers is that they're case insensitive -> information loss, but they're 'closer' to the cloudevents standard
      await request(options, { data: msg.data, ...headers }) // TODO: fetch does not work with mTLS as of today, requires another module. see https://github.com/nodejs/node/issues/48977
      this.LOG.info('Emit', { topic: msg.event })
    } catch (e) {
      this.LOG.error('Emit failed:', e.message)
      throw e
    }
  }

  prepareHeaders(headers, event) {
    if (!('source' in headers)) {
      if (!this.options.credentials.ceSource)
        throw new Error(`${this.name}: Cannot emit event: Parameter \`ceSource\` not found in Event Broker binding.`)
      headers.source = `${this.options.credentials.ceSource[0]}/${cds.context.tenant}`
    }
    super.prepareHeaders(headers, event)
  }

  registerWebhookEndpoints() {
    const webhookBasePath = this.options.webhookPath
    if (usedWebhookEndpoints.has(webhookBasePath))
      throw new Error(
        `${this.name}: Event Broker: Webhook endpoint already registered. Use a different one with \`options.webhookPath\`.`
      )
    usedWebhookEndpoints.add(webhookBasePath)
    // auth
    if (this.auth.kind === 'ias') {
      let ias_auth
      try {
        ias_auth = require('@sap/cds/lib/srv/middlewares/auth/ias-auth.js')
      } catch {
        ias_auth = require('@sap/cds/lib/auth/ias-auth') // fallback for older @sap/cds version
      }
      cds.app.use(webhookBasePath, cds.middlewares.context())
      cds.app.use(webhookBasePath, ias_auth(this.auth.ias))
      cds.app.use(webhookBasePath, (err, _req, res, next) => {
        if (err == 401 || err.code == 401) return res.status(401).json({ message: 'Unauthorized' })
        return next(err)
      })
      cds.app.use(webhookBasePath, (_req, res, next) => {
        if (
          cds.context.user.is('system-user') &&
          cds.context.user.tokenInfo.azp === this.options.credentials.ias.clientId
        ) {
          // the token was fetched by event broker -> OK
          return next()
        }
        if (cds.context.user.is('internal-user')) {
          // the token was fetched by own credentials -> OK (for testing, developer dashboard, etc.)
          return next()
        }
        res.status(401).json({ message: 'Unauthorized' })
      })
    } else {
      cds.app.post(webhookBasePath, _validateCertificate.bind(this))
    }
    cds.app.post(webhookBasePath, express.json())
    cds.app.post(webhookBasePath, this.onEventReceived.bind(this))
  }

  async onEventReceived(req, res) {
    try {
      const event = req.headers['ce-type'] // TG27: type contains namespace, so there's no collision
      const tenant = req.headers['ce-sapconsumertenant']

      // take over cloudevents headers (`ce-*`) without the prefix
      const headers = {}
      for (const header in req.headers) {
        if (header.startsWith('ce-')) headers[header.slice(3)] = req.headers[header]
      }

      const msg = normalizeIncomingMessage(req.body)
      msg.event = event
      Object.assign(msg.headers, headers)
      if (this.isMultitenancy) msg.tenant = tenant

      // for cds.context.http
      msg._ = {}
      msg._.req = req
      msg._.res = res

      const context = { user: cds.User.privileged, _: msg._ }
      if (msg.tenant) context.tenant = msg.tenant

      if (CDS_8) await this.tx(context, tx => tx.emit(msg))
      else await this.processInboundMsg(context, msg)
      this.LOG._debug && this.LOG.debug('Event processed successfully.')
      return res.status(200).json({ message: 'OK' })
    } catch (e) {
      this.LOG.error('ERROR during inbound event processing:', e)
      res.status(500).json({ message: 'Internal Server Error!' })
    }
  }
}

module.exports = EventBroker
