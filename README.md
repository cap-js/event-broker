# Welcome to @cap-js/event-broker

[![REUSE status](https://api.reuse.software/badge/github.com/cap-js/event-broker)](https://api.reuse.software/info/github.com/cap-js/event-broker)



## About this project

CDS plugin providing integration with SAP Event Broker.



## Table of Contents

- [About this project](#about-this-project)
- [Requirements](#requirements)
- [Setup](#setup)
- [Support, Feedback, Contributing](#support-feedback-contributing)
- [Code of Conduct](#code-of-conduct)
- [Licensing](#licensing)



## Requirements

See [Getting Started](https://cap.cloud.sap/docs/get-started) on how to jumpstart your development and grow as you go with SAP Cloud Application Programming Model.



## Setup

Install the plugin via:

```bash
npm add @cap-js/event-broker
```

Please follow the [guide on messaging](https://cap.cloud.sap/docs/guides/messaging/) to get an overview over the messaging concepts of CAP.

You can create an SAP Event Broker service with the following configuration:

```jsonc
{
  "cds": {
    "requires": {
      "messaging": {
        "kind": "event-broker"
      }
    }
  }
}
```

For more details, please refer to the [messaging section](https://cap.cloud.sap/docs/node.js/messaging) of the CAP Node.js documentation.



## Support, Feedback, Contributing

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/cap-js/event-broker/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).



## Security / Disclosure

If you find any bug that may be a security problem, please follow our instructions at [in our security policy](https://github.com/cap-js/event-broker/security/policy) on how to report it. Please do not create GitHub issues for security-related doubts or problems.



## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](https://github.com/cap-js/.github/blob/main/CODE_OF_CONDUCT.md) at all times.



## Licensing

Copyright 2024 SAP SE or an SAP affiliate company and event-broker contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/cap-js/event-broker).
