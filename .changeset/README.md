# Changesets

Add a changeset to every pull request that changes the published CLI behavior:

```bash
bun run changeset
```

Choose the release type, then write the user-facing release note. Commit the generated Markdown file with the change.

- `patch`: compatible fix
- `minor`: new behavior or a breaking change while the package is `0.x`
- `major`: breaking change after `1.0.0`

Tooling, tests, and documentation-only changes do not need a release. Use `bun run changeset --empty` only when a workflow requires an explicit no-release record.
