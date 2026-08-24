# upwork-cli

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
