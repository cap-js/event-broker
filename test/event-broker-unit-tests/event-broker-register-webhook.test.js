describe('event broker webhook endpoint registration', () => {
	test('webhookSizeLimit correctly passed to express.json', async () => {
		// Arrange
		const expectedLimit = '5mb'

		const express = require('express')
		const originalJson = express.json
		let calledLimit
		express.json = opts => {
			calledLimit = opts.limit
			return (req, res, next) => next()
		}

		const EventBroker = require('../../cds-plugin.js')
		const eb = new EventBroker('event-broker')
		eb.options = {
			webhookPath: '/webhook-test',
			webhookSizeLimit: expectedLimit,
			credentials: {
				ias: { clientId: 'clientId' },
			}
		}
		eb.auth = { kind: 'ias', ias: { credentials: { certificate: 'cert', key: 'key' }, clientId: 'clientId' } }

		const useMock = jest.fn()
		const postMock = jest.fn()
		require('@sap/cds').app = { use: useMock, post: postMock }

		// Act
		eb.registerWebhookEndpoints()

		// Assert
		expect(calledLimit).toBe(expectedLimit)

		// Cleanup
		express.json = originalJson
	})
})
