# upwork-cli

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
