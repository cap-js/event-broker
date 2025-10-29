describe('event broker webhook endpoint registration', () => {
	test.each([
		{
			name: 'webhookSizeLimit correctly passed to express.json',
			webhookPath: '/webhook-test',
			webhookSizeLimit: '5mb',
			bodyParserLimit: undefined,
			expectedLimit: '5mb'
		},
		{
			name: 'body_parser.limit overrides webhookSizeLimit',
			webhookPath: '/webhook-test-2',
			webhookSizeLimit: '5mb',
			bodyParserLimit: '42mb',
			expectedLimit: '42mb'
		}
	])('$name', async ({ webhookPath, webhookSizeLimit, bodyParserLimit, expectedLimit }) => {
		// Arrange
		const express = require('express')
		const originalJson = express.json
		let calledLimit
		express.json = opts => {
			calledLimit = opts.limit
			return (req, res, next) => next()
		}

		const cds = require('@sap/cds')
		const originalServer = cds.server
		if (bodyParserLimit) {
			cds.server = { body_parser: { limit: bodyParserLimit } }
		}

		const EventBroker = require('../../cds-plugin.js')
		const eb = new EventBroker('event-broker')
		eb.options = {
			webhookPath,
			webhookSizeLimit,
			credentials: {
				ias: { clientId: 'clientId' },
			}
		}
		eb.auth = { kind: 'ias', ias: { credentials: { certificate: 'cert', key: 'key' }, clientId: 'clientId' } }

		const useMock = jest.fn()
		const postMock = jest.fn()
		cds.app = { use: useMock, post: postMock }

		// Act
		eb.registerWebhookEndpoints()

		// Assert
		expect(calledLimit).toBe(expectedLimit)

		// Cleanup
		express.json = originalJson
		cds.server = originalServer
	})

})
