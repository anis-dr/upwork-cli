# Issue tracker: Local Markdown

Issues and specs live under `.scratch/`.

## Conventions

- One effort per directory: `.scratch/<feature-slug>/`.
- The spec is `.scratch/<feature-slug>/spec.md`.
- Implementation issues are separate files at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`.
- Comments append under `## Comments`.

## Skill operations

- Publish: create the appropriate file under `.scratch/<feature-slug>/`.
- Fetch: read the referenced path supplied by the user or calling skill.
- Wayfinding map: `.scratch/<effort>/map.md`.
- Wayfinding tickets: `.scratch/<effort>/issues/NN-<slug>.md`, with `Type:`, `Status:`, and optional `Blocked by:` lines.
- Claim before work by setting `Status: claimed`.
- Resolve by appending `## Answer`, setting `Status: resolved`, and linking the result from the map.
