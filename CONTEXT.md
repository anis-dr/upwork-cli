# Upwork job discovery

This context covers authenticated Upwork job discovery and the language used in CLI commands, output, and documentation.

## Language

**Saved session**:
An authenticated Upwork session retained for later CLI commands.
_Avoid_: Auth state, cookie file, credentials file

**Job query**:
One search phrase and its discovery constraints.
_Avoid_: Search request, keyword set

**Query outcome**:
The success or failure and paging metadata for one job query.
_Avoid_: Query metadata, search result

**Search result ID**:
The identifier of an item returned by Upwork job discovery. It is used for deduplication and is not accepted by the job-details command.
_Avoid_: Job ID, job reference

**Job reference**:
The opaque Upwork identifier beginning with `~` that identifies one job for detail retrieval.
_Avoid_: Ciphertext, bare ID

**Job summary**:
The compact job information returned by discovery before full inspection.
_Avoid_: Job result, tile

**Job details**:
The complete opening, client, qualification, and account-specific information for one job reference.
_Avoid_: Full result, raw job

**Shortlist**:
A capped, deduplicated collection of job summaries produced from one or more job queries.
_Avoid_: Combined results, merged jobs

**Verified client**:
A client whose payment method Upwork reports as verified.
_Avoid_: Trusted client, approved client
