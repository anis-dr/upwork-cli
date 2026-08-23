---
name: always-use-bun
description: "Keep project runtime, platform adapters, commands, and tests on Bun"
condition: "@effect/platform-node|NodeServices|NodeRuntime|\\bnode\\s+|\\bnpx\\s+|\\bnpm\\s+(?:run|install|add|exec|test)\\b"
scope: "tool"
---

This project is Bun-only. Use `@effect/platform-bun`, `BunServices`, `BunRuntime`, `bun`, `bunx`, and Bun-compatible test/process adapters. Do not introduce Node platform packages or Node/npm/npx commands—even as test-only dependencies. npm is only the package registry/distribution channel.
