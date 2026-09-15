# Change Log

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](http://semver.org/).
The format is based on [Keep a Changelog](http://keepachangelog.com/).

## Unreleased

### Added

- ORD Integration Dependencies for events consumed via `messaging.on()` are now declared using the `@OrdId` CDS annotation

### Fixed

- Generated Integration Dependency now includes the mandatory `partOfPackage` (defaults to the `@cap-js/ord` plugin's default package ordId, overridable via `cds.env.ord.integrationDependency.partOfPackage`)

## Version 0.3.1 - 2025-11-10

### Added

- Webhook size limit parameter

## Version 0.3.0 - 2025-10-27

### Added

- Support for publishing events

## Version 0.2.0 - 2025-06-05

### Added

- Prerequisite for inboxing incoming messages in `@sap/cds^9`

## Version 0.1.2 - 2024-12-12

### Fixed

- Response format of unauthorized requests

## Version 0.1.1 - 2024-11-12

### Added

- Support for `@sap/cds` >= 8.5.0 (modified `ias-auth` middleware path)

## Version 0.1.0 - 2024-09-27

### Added

- Option for outboxing

## Version 0.0.1 - 2024-09-23

### Added

- Initial release
