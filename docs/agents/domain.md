# Domain docs

Before exploring domain code, read the root `CONTEXT.md` and relevant ADRs under `docs/adr/` when they exist. Missing files require no warning; domain-modeling creates them only when terminology or decisions are resolved.

## Layout

This is a single-context repo:

- `CONTEXT.md`: glossary and domain model.
- `docs/adr/`: architectural decisions.

## Consumer rules

- Use terminology defined in `CONTEXT.md`; avoid synonyms it rejects.
- A missing term is either invented language to reconsider or a gap to record for domain modeling.
- Surface conflicts with existing ADRs explicitly rather than silently overriding them.
