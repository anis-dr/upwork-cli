# upwork-cli

## 0.5.2

### Patch Changes

- 092f103: Refactor job discovery into focused Shortlist and Job query modules without changing CLI behavior.

## 0.5.1

### Patch Changes

- dc954d6: Show required Connects for jobs and support filtering by maximum Connects.

## 0.5.0

### Minor Changes

- 59b5c03: Harden discovery against nullable Upwork fields, clarify job references in command output, and add optional OTLP traces and logs.

## 0.4.0

### Minor Changes

- 9690384: Make multi-query discovery resilient and compact with per-query status, nullable client fields, matched query metadata, CLI version metadata, and a configurable result cap.

## 0.3.0

### Minor Changes

- b40ab8e: Close the dedicated Chrome instance after authentication and replace authentication JSON with short human-readable status messages.

## 0.2.1

### Patch Changes

- 37e5e45: Publish the initial changelog and document the automated Changesets release workflow.

## 0.2.0

### Minor changes

- Consolidated job discovery under `find` with multiple explicit queries, exact proposal caps, job deduplication, configurable recency or relevance ordering, and per-query paging metadata.
- Renamed `--per-query` to `--page-size` and removed the overlapping `search` command.

### Patch changes

- Added automatic cross-platform Chrome launch for authentication.
- Replaced fixed bearer-cookie loading with candidate discovery and authenticated GraphQL validation.
- Rewrote the distributed agent skill around installation, authentication, job discovery, inspection, and result presentation.

## 0.1.0

### Minor changes

- Published the initial read-only CLI with authentication capture, filtered Upwork job discovery, complete job details, JSON output, and a distributed agent skill.
