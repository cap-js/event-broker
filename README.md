# Welcome to @cap-js/event-broker

[![REUSE status](https://api.reuse.software/badge/github.com/cap-js/event-broker)](https://api.reuse.software/info/github.com/cap-js/event-broker)

## About this project

CDS plugin providing integration with SAP Cloud Application Event Hub (technical name: `event-broker`).

## Table of Contents

- [About this project](#about-this-project)
- [Requirements](#requirements)
- [Setup](#setup)
- [Support, Feedback, Contributing](#support-feedback-contributing)
- [Code of Conduct](#code-of-conduct)
- [Licensing](#licensing)

## Requirements

See [Getting Started](https://cap.cloud.sap/docs/get-started/in-a-nutshell) on how to jumpstart your development and grow as you go with SAP Cloud Application Programming Model (CAP).
To learn about messaging in CAP, please consult the guide on [Events & Messaging](https://cap.cloud.sap/docs/guides/messaging/).

## Setup

Install the plugin via:

```bash
npm add @cap-js/event-broker
```

Then, set the `kind` of your messaging service to `event-broker`:

```jsonc
"cds": {
  "requires": {
    "messaging": {
      "kind": "event-broker"
    }
  }
}
```

The [CloudEvents](https://cloudevents.io/) format is enforced since it is required by SAP Cloud Application Event Hub.

Authentication in the SAP Cloud Application Event Hub integration is based on the [Identity Authentication service (IAS)](https://help.sap.com/docs/cloud-identity-services/cloud-identity-services/getting-started-with-identity-service-of-sap-btp) of [SAP Cloud Identity Services](https://help.sap.com/docs/cloud-identity-services).
If you are not using [IAS-based Authentication](https://cap.cloud.sap/docs/node.js/authentication#ias), you will need to trigger the loading of the IAS credentials into your app's `cds.env` via an additional `requires` entry:

```jsonc
"cds": {
  "requires": {
    "ias": { // any name
      "vcap": {
        "label": "identity"
      }
    }
  }
}
```

For more information, please see [SAP Cloud Application Event Hub](https://help.sap.com/docs/sap-cloud-application-event-hub) in SAP Help Portal.

## Parameters

### webhookSizeLimit

To set a size limit for events accepted by the webhook, set the `webhookSizeLimit`parameter in the `package.json` file in the root folder of your app, e.g.

```jsonc
"cds": {
  "requires": {
    "messaging": {
      "kind": "event-broker",
      "webhookSizeLimit": "1mb"
    }
  }
}
```

If the parameter is not set, the [global request body size limit](https://pages.github.tools.sap/cap/docs/node.js/cds-server#maximum-request-body-size) `cds.env.server.body_parser.limit` is taken into account. If this parameter is not set either, the default value of `1mb`is used.

## ORD Integration

When both `@cap-js/event-broker` and `@cap-js/ord` plugins are installed, the Event Broker plugin can expose consumed events as an **Integration Dependency** in the ORD document.

### Configuration via CDS Annotation

To enable ORD Integration Dependencies, annotate consumed event definitions in your CDS model with `@ORD.Extensions.eventResource`. This maps your subscribed event types to their corresponding ORD event resource identifiers.

```cds
// srv/services.cds

// External events consumed from SAP S/4HANA via Event Broker
event sap.s4.beh.businesspartner.v1.BusinessPartner.Changed.v1
    @ORD.Extensions.eventResource: 'sap.s4:eventResource:CE_BUSINESSPARTNEREVENTS:v1';

event sap.s4.beh.businesspartner.v1.BusinessPartner.Created.v1
    @ORD.Extensions.eventResource: 'sap.s4:eventResource:CE_BUSINESSPARTNEREVENTS:v1';

event sap.s4.beh.salesorder.v1.SalesOrder.Changed.v1
    @ORD.Extensions.eventResource: 'sap.s4:eventResource:CE_SALESORDEREVENTS:v1';
```

The `ordId` values should match the event resource identifiers from the SAP Business Accelerator Hub or your event source's ORD document.

### How it works

At runtime, when services are served, the Event Broker plugin:

1. Scans the CDS model for events annotated with `@ORD.Extensions.eventResource`
2. Collects all subscribed event topics from active messaging services
3. Matches subscribed events against the annotated event definitions
4. Registers the matching eventResources with the ORD plugin's Extension API

Only events that are both:

- Annotated with `@ORD.Extensions.eventResource` in CDS AND
- Actually subscribed by your application

will appear in the ORD document. Events that are subscribed but not annotated will trigger a warning log.

### Example ORD Output

```json
{
  "integrationDependencies": [
    {
      "ordId": "customer.myapp:integrationDependency:consumedEvents:v1",
      "title": "Consumed Events",
      "aspects": [
        {
          "title": "Subscribed Event Types",
          "eventResources": [
            {
              "ordId": "sap.s4:eventResource:CE_BUSINESSPARTNEREVENTS:v1",
              "subset": [
                {
                  "eventType": "sap.s4.beh.businesspartner.v1.BusinessPartner.Changed.v1"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

### No Annotation = No Integration Dependency

If no events are annotated with `@ORD.Extensions.eventResource`, no Integration Dependency will be generated. This is intentional - the annotation ensures that event resources are properly mapped to their official ORD identifiers.

## Support, Feedback, Contributing

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/cap-js/event-broker/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).

## Security / Disclosure

If you find any bug that may be a security problem, please follow our instructions at [in our security policy](https://github.com/cap-js/event-broker/security/policy) on how to report it. Please do not create GitHub issues for security-related doubts or problems.

## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](https://github.com/cap-js/.github/blob/main/CODE_OF_CONDUCT.md) at all times.

## Licensing

Copyright 2024 SAP SE or an SAP affiliate company and event-broker contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/cap-js/event-broker).
