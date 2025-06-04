class IdentityService {
  constructor(credentials, config) {
    this.credentials = credentials
    this.config = config
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ValidationError'
  }
}

module.exports = {
  v3: 'dummy',
  createSecurityContext(authService, contextConfig, _, cb) {
    let { req } = contextConfig
    contextConfig.jwt ??= req?.headers?.authorization?.split(' ')[1]
    if (contextConfig.jwt !== 'dummyToken') {
      // if (cb) return cb(new ValidationError('Invalid token'))
      // if (cb) {
      //   debugger
      //   return cb(null, null, null)
      // }
      throw new ValidationError()
    }

    const tokenInfoObj = { sub: 'eb-client-id', azp: 'eb-client-id' }
    const dummyTokenInfo = {
      getPayload: () => tokenInfoObj,
      getClientId: () => 'eb-client-id',
      getZoneId: () => 'dummyZoneId',
      ...tokenInfoObj
    }
    return { token: dummyTokenInfo }
  },
  IdentityService,
  errors: { ValidationError }
}
