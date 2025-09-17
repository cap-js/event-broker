class IdentityService {
  constructor(credentials, config) {
    this.credentials = credentials
    this.config = config
  }
}

class XsuaaService {
  constructor(credentials, config) {
    this.credentials = credentials
    this.config = config
  }
}

class XsuaaToken {
  constructor() {}
}

class ValidationError extends Error {
  constructor(message = 'Invalid token') {
    super(message)
    this.name = 'ValidationError'
  }
}

class ExpiredTokenError extends Error {
  constructor(message = 'Token expired') {
    super(message)
    this.name = 'ExpiredTokenError'
    this.token = {
      getZoneId: () => 'dummyZoneId'
    }
  }
}

const Token = {
  decodeCache: null,
  enableDecodeCache() {
    this.decodeCache = true
  }
}

module.exports = {
  v3: 'dummy',
  createSecurityContext(_, contextConfig) {
    contextConfig.jwt ??= contextConfig.req?.headers?.authorization?.split(' ')[1]
    if (contextConfig.jwt !== 'dummyToken') throw new ValidationError()
    const tokenInfoObj = { sub: 'eb-client-id', azp: 'eb-client-id' }
    const dummyTokenInfo = {
      getPayload: () => tokenInfoObj,
      getClientId: () => 'eb-client-id',
      getZoneId: () => 'dummyZoneId',
      ...tokenInfoObj
    }
    return { token: dummyTokenInfo }
  },
  Token,
  IdentityService,
  XsuaaService,
  XsuaaToken,
  errors: { ValidationError, ExpiredTokenError }
}
