#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Config, Effect, FileSystem, Schema } from "effect";
import packageJson from "../package.json" with { type: "json" };

const ChangesetsOutputEvent = Schema.Struct({
  type: Schema.Literal("git-tag"),
  tag: Schema.String,
  packageName: Schema.String,
});

const encodeEvent = Schema.encodeUnknownEffect(Schema.fromJsonString(ChangesetsOutputEvent));

Effect.gen(function* () {
  const outputPath = yield* Config.string("CHANGESETS_OUTPUT");
  const fileSystem = yield* FileSystem.FileSystem;
  const event = yield* encodeEvent({
    type: "git-tag",
    tag: `v${packageJson.version}`,
    packageName: packageJson.name,
  });
  yield* fileSystem.writeFileString(outputPath, `${event}\n`);
  yield* Effect.logInfo(
    `Recorded Changesets output for ${packageJson.name}@${packageJson.version}`,
  );
}).pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
