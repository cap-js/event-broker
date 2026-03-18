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
      // where the systemId will be blank for the MT plan service instance binding and contain the value of the global account id for the EC Plan
      const systemId = this.options.credentials.systemId ? this.options.credentials.systemId : cds.context.tenant
      headers.source = `${this.options.credentials.ceSource[0]}/${systemId}`
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

    const limit = this.options.webhookSizeLimit ?? cds.env.server.body_parser?.limit ?? "1mb"
    cds.app.post(webhookBasePath, express.json({ limit }))
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

// ============================================================================
// ORD Integration Dependency Provider
// ============================================================================

/**
 * Known Event Broker service kinds
 */
const EVENT_BROKER_KINDS = ['event-broker', 'event-broker-ias']

/**
 * Get all Event Broker messaging service configurations from cds.env.requires
 * @returns {Array} Array of { name, config } objects
 */
function getEventBrokerConfigs() {
  const envRequires = cds.env?.requires
  if (!envRequires) return []

  const configs = []
  for (const [name, config] of Object.entries(envRequires)) {
    if (!config || typeof config !== 'object') continue

    const isEventBroker =
      (config.kind && EVENT_BROKER_KINDS.includes(config.kind)) ||
      (config.vcap?.label && EVENT_BROKER_KINDS.some(kind => config.vcap.label.includes(kind)))

    if (isEventBroker) {
      configs.push({ name, config })
    }
  }

  return configs
}

/**
 * Extract namespace from Event Broker credentials ceSource.
 *
 * ceSource format: "/default/<namespace>/..." or array with such strings
 * Examples:
 *   "/default/sap.s4/source-system" -> "sap.s4"
 *   ["/default/beb-demo-nodejs/local"] -> "beb-demo-nodejs"
 *
 * @returns {string|null} Extracted namespace or null
 */
function extractNamespaceFromCeSource() {
  const configs = getEventBrokerConfigs()

  for (const { config } of configs) {
    const credentials = config.credentials
    if (!credentials) continue

    // ceSource can be a string or an array
    const ceSource = Array.isArray(credentials.ceSource) ? credentials.ceSource[0] : credentials.ceSource
    if (!ceSource || typeof ceSource !== 'string') continue

    // Parse ceSource: "/default/<namespace>/..." or "/<namespace>/..."
    const parts = ceSource.split('/').filter(Boolean)
    if (parts.length < 2) continue

    // If first part is "default", namespace is second part, otherwise first part
    const namespace = parts[0] === 'default' ? parts[1] : parts[0]
    if (namespace) return namespace
  }

  return null
}

/**
 * Get subscribed topics from Event Broker messaging services at runtime.
 * Reads the subscribedTopics property from initialized messaging services.
 *
 * @returns {Array<string>} Array of subscribed topic names
 */
function getSubscribedTopics() {
  const services = cds.services
  if (!services) return []

  const topics = new Set()
  const configs = getEventBrokerConfigs()

  for (const { name } of configs) {
    const service = services[name]
    if (!service || typeof service.subscribedTopics === 'undefined') continue

    const subscribedTopics = service.subscribedTopics

    if (subscribedTopics instanceof Map) {
      for (const topic of subscribedTopics.keys()) {
        if (topic && topic !== '*' && !topic.includes('messaging/error')) {
          topics.add(topic)
        }
      }
    } else if (subscribedTopics instanceof Set) {
      for (const topic of subscribedTopics) {
        if (topic && topic !== '*' && !topic.includes('messaging/error')) {
          topics.add(topic)
        }
      }
    } else if (Array.isArray(subscribedTopics)) {
      for (const topic of subscribedTopics) {
        if (topic && topic !== '*' && !topic.includes('messaging/error')) {
          topics.add(topic)
        }
      }
    }
  }

  return Array.from(topics)
}

/**
 * Annotation name for event resource ORD ID mapping.
 * Applied to event definitions in CDS.
 */
const ORD_EVENT_RESOURCE_ANNOTATION = '@ORD.Extensions.eventResource'

/**
 * Reads event resource mappings from CDS model annotations.
 *
 * Scans cds.model.definitions for events annotated with @ORD.Extensions.eventResource
 * and builds a mapping of event types to their ORD event resource IDs.
 *
 * @example
 * // In CDS:
 * event sap.s4.beh.salesorder.v1.SalesOrder.Changed.v1
 *   @ORD.Extensions.eventResource: 'sap.s4:eventResource:CE_SALESORDEREVENTS:v1';
 *
 * @returns {Map<string, string>} Map of eventType -> ordId
 */
function getEventResourceMappingsFromCds() {
  const LOG = cds.log('event-broker')
  const mappings = new Map()

  if (!cds.model?.definitions) {
    LOG.debug?.('No CDS model available')
    return mappings
  }

  for (const [name, def] of Object.entries(cds.model.definitions)) {
    // Check if it's an event definition with the annotation
    if (def.kind === 'event' && def[ORD_EVENT_RESOURCE_ANNOTATION]) {
      const ordId = def[ORD_EVENT_RESOURCE_ANNOTATION]
      if (typeof ordId === 'string' && ordId.trim()) {
        mappings.set(name, ordId)
        LOG.debug?.(`Found event ${name} -> ${ordId}`)
      }
    }
  }

  LOG.debug?.(`Found ${mappings.size} annotated events in CDS model`)
  return mappings
}

/**
 * Builds eventResources from CDS annotations and subscribed events.
 *
 * Only includes events that are both:
 * - Annotated with @ORD.Extensions.eventResource in CDS
 * - Actually subscribed by the application at runtime
 *
 * @param {Array<string>} subscribedEvents - Events the app is subscribed to
 * @param {Map<string, string>} eventResourceMappings - Map of eventType -> ordId from CDS
 * @returns {Array} eventResources array with {ordId, events} for ORD plugin
 */
function buildEventResourcesFromAnnotations(subscribedEvents, eventResourceMappings) {
  const LOG = cds.log('event-broker')
  const mappedEvents = new Set()

  // Group subscribed events by their ordId
  const ordIdToEvents = new Map()

  for (const eventType of subscribedEvents) {
    const ordId = eventResourceMappings.get(eventType)
    if (ordId) {
      if (!ordIdToEvents.has(ordId)) {
        ordIdToEvents.set(ordId, [])
      }
      ordIdToEvents.get(ordId).push(eventType)
      mappedEvents.add(eventType)
      LOG.debug?.(`Mapped event ${eventType} to ${ordId}`)
    }
  }

  // Build eventResources array
  const eventResources = []
  for (const [ordId, events] of ordIdToEvents) {
    eventResources.push({ ordId, events })
  }

  // Log unmapped events (subscribed but not annotated)
  const unmappedEvents = subscribedEvents.filter(e => !mappedEvents.has(e))
  if (unmappedEvents.length > 0) {
    LOG.warn(`${unmappedEvents.length} subscribed events not annotated with ${ORD_EVENT_RESOURCE_ANNOTATION}: ${unmappedEvents.join(', ')}`)
  }

  return eventResources
}

/**
 * Register Integration Dependency provider with ORD plugin.
 * Called once when services are ready.
 */
function registerOrdIntegrationDependencyProvider() {
  const LOG = cds.log('event-broker')

  // Check if ORD plugin is available
  let ordPlugin
  try {
    ordPlugin = require('@cap-js/ord')
    LOG.info('ORD plugin found, registering Integration Dependency provider')
  } catch (e) {
    // ORD plugin not installed - that's fine
    LOG.debug?.('ORD plugin not installed:', e.message)
    return
  }

  if (!ordPlugin.registerIntegrationDependencyProvider) {
    // Older ORD plugin version without Extension API
    LOG.debug?.('ORD plugin version does not support Extension API')
    return
  }

  // Register provider function
  ordPlugin.registerIntegrationDependencyProvider(() => {
    // Get subscribed events at runtime
    const subscribedEvents = getSubscribedTopics()
    if (subscribedEvents.length === 0) {
      LOG.debug?.('No subscribed events found')
      return null
    }

    // Get event resource mappings from CDS annotations
    const eventResourceMappings = getEventResourceMappingsFromCds()
    if (eventResourceMappings.size === 0) {
      LOG.debug?.('No events annotated with @ORD.Extensions.eventResource')
      return null
    }

    // Build eventResources from annotations and subscribed events
    const eventResources = buildEventResourcesFromAnnotations(subscribedEvents, eventResourceMappings)
    if (eventResources.length === 0) {
      LOG.debug?.('No eventResources could be built from annotations')
      return null
    }

    LOG.info(`Providing ${eventResources.length} eventResource(s) for ORD Integration Dependency`)
    return { eventResources }
  })
}

// Register when services are served (runtime only)
cds.once('served', () => {
  registerOrdIntegrationDependencyProvider()
})

module.exports = EventBroker
