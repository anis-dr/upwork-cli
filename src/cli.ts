#!/usr/bin/env bun
import { BunRuntime, BunServices, BunSocket } from "@effect/platform-bun";
import { Config, Console, Effect, Layer, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { FetchHttpClient, Headers } from "effect/unstable/http";
import { OtlpLogger, OtlpSerialization, OtlpTracer } from "effect/unstable/observability";
import packageJson from "../package.json" with { type: "json" };
import { captureAuthenticatedSession, UpworkCliError, authenticate } from "./auth.ts";
import { findJobsForQuery } from "./job-query.ts";
import { findShortlist } from "./shortlist.ts";
import { getJobDetails, getRequiredConnects } from "./upwork.ts";

const encodeJson = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown, { space: 2 }));

const printJson = <A>(value: A) =>
  encodeJson(value).pipe(
    Effect.mapError(
      (cause) => new UpworkCliError({ message: "Could not encode CLI output", cause }),
    ),
    Effect.flatMap(Console.log),
  );

const cdpFlag = Flag.integer("cdp").pipe(
  Flag.withDefault(9222),
  Flag.withDescription("Chrome DevTools Protocol port"),
);
const authTimeoutFlag = Flag.integer("timeout-minutes").pipe(
  Flag.withDefault(10),
  Flag.withDescription("Minutes to wait for the user to finish authentication"),
);
const loginCommand = Command.make(
  "login",
  {
    cdp: cdpFlag,
    timeoutMinutes: authTimeoutFlag,
  },
  ({ cdp, timeoutMinutes }) =>
    Effect.gen(function* () {
      const session = yield* authenticate(cdp, timeoutMinutes);
      if (session.wasAlreadyAuthenticated) {
        yield* Console.log("Already authenticated with Upwork.");
      } else {
        yield* Console.log("Authenticated with Upwork.");
        if (session.browserClosed) {
          yield* Console.log("Chrome closed.");
        } else {
          yield* Console.log("Chrome could not be closed automatically. You can close it now.");
        }
      }
      yield* Console.log(`Session saved to ${session.path}.`);
    }),
).pipe(Command.withDescription("Open Chrome and wait for Upwork authentication"));
const captureCommand = Command.make("capture", { cdp: cdpFlag }, ({ cdp }) =>
  Effect.gen(function* () {
    const session = yield* captureAuthenticatedSession(cdp);
    yield* Console.log("Authentication captured.");
    yield* Console.log(`Session saved to ${session.path}.`);
  }),
).pipe(Command.withDescription("Capture authenticated Upwork state from Chrome"));

const authCommand = Command.make("auth").pipe(
  Command.withDescription("Manage local Upwork authentication"),
  Command.withSubcommands([loginCommand, captureCommand]),
);

const sortFlag = Flag.choice("sort", ["relevance", "recency"]).pipe(
  Flag.withDefault("recency"),
  Flag.withDescription("Combined result ordering"),
);
const proposalsFlag = Flag.choice("proposals", [
  "any",
  "0-4",
  "5-9",
  "10-14",
  "15-19",
  "20-49",
]).pipe(Flag.withDefault("any"), Flag.withDescription("Server-side proposal-count range"));
const experienceFlag = Flag.choice("experience", ["any", "entry", "intermediate", "expert"]).pipe(
  Flag.withDefault("any"),
  Flag.withDescription("Required experience level"),
);
const jobTypeFlag = Flag.choice("job-type", ["any", "hourly", "fixed"]).pipe(
  Flag.withDefault("any"),
  Flag.withDescription("Hourly or fixed-price jobs"),
);
const budgetFlag = Flag.choice("fixed-budget", [
  "any",
  "under-100",
  "100-499",
  "500-999",
  "1000-4999",
  "5000-plus",
]).pipe(Flag.withDefault("any"), Flag.withDescription("Fixed-price budget range"));
const clientHiresFlag = Flag.choice("client-hires", ["any", "none", "1-9", "10-plus"]).pipe(
  Flag.withDefault("any"),
  Flag.withDescription("Client's previous hire count"),
);
const durationFlag = Flag.choice("duration", [
  "any",
  "under-1-month",
  "1-3-months",
  "3-6-months",
  "over-6-months",
]).pipe(Flag.withDefault("any"), Flag.withDescription("Expected project duration"));
const workloadFlag = Flag.choice("workload", ["any", "part-time", "full-time", "as-needed"]).pipe(
  Flag.withDefault("any"),
  Flag.withDescription("Expected weekly workload"),
);
const contractToHireFlag = Flag.boolean("contract-to-hire").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Only contract-to-hire jobs"),
);
const postedWithinFlag = Flag.choice("posted-within", ["any", "24h", "3d", "7d", "30d"]).pipe(
  Flag.withDefault("any"),
  Flag.withDescription("Only jobs posted within this window"),
);
const maxPagesFlag = Flag.integer("max-pages").pipe(
  Flag.withDefault(10),
  Flag.withDescription("Maximum pages scanned for a posted-within filter"),
);

const jobInput = Argument.string("job").pipe(
  Argument.withDescription("Upwork job reference or URL"),
);
const jobCommand = Command.make("job", { job: jobInput }, ({ job }) =>
  Effect.gen(function* () {
    const jobDetails = yield* getJobDetails(job);
    return yield* printJson({
      meta: { cliVersion: packageJson.version },
      ...jobDetails,
    });
  }),
).pipe(Command.withDescription("Return complete data for one Upwork job"));

const queryArguments = Argument.string("query").pipe(
  Argument.variadic({ min: 1 }),
  Argument.withDescription("Queries to combine"),
);
const maxProposalsFlag = Flag.integer("max-proposals").pipe(
  Flag.withDefault(20),
  Flag.withDescription("Drop jobs above this applicant count"),
);
const maxConnectsFlag = Flag.integer("max-connects").pipe(
  Flag.withDescription("Drop jobs requiring more than this many Connects"),
  Flag.optional,
);
const pageSizeFlag = Flag.integer("page-size").pipe(
  Flag.withDefault(20),
  Flag.withDescription("Jobs fetched per page for each query, from 1 to 50"),
);
const maxResultsFlag = Flag.integer("max-results").pipe(
  Flag.withDefault(20),
  Flag.withDescription("Maximum deduplicated jobs returned"),
);
const includeUnverifiedFlag = Flag.boolean("include-unverified").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Include clients without verified payment"),
);

const findCommand = Command.make(
  "find",
  {
    queries: queryArguments,
    maxProposals: maxProposalsFlag,
    maxConnects: maxConnectsFlag,
    pageSize: pageSizeFlag,
    maxResults: maxResultsFlag,
    sort: sortFlag,
    includeUnverified: includeUnverifiedFlag,
    proposals: proposalsFlag,
    experience: experienceFlag,
    jobType: jobTypeFlag,
    budget: budgetFlag,
    clientHires: clientHiresFlag,
    duration: durationFlag,
    workload: workloadFlag,
    contractToHire: contractToHireFlag,
    postedWithin: postedWithinFlag,
    maxPages: maxPagesFlag,
  },
  (config) =>
    findShortlist(
      {
        ...config,
        cliVersion: packageJson.version,
      },
      { findJobsForQuery, getRequiredConnects },
    ).pipe(Effect.flatMap(printJson)),
).pipe(Command.withDescription("Combine, deduplicate, and filter job searches"));

const app = Command.make("upwork").pipe(
  Command.withDescription("Read-only Upwork CLI for agents"),
  Command.withSubcommands([authCommand, jobCommand, findCommand]),
);

const observabilityLayer = Layer.unwrap(
  Effect.gen(function* () {
    const configuredEndpoint = yield* Config.option(Config.string("OTEL_EXPORTER_OTLP_ENDPOINT"));
    if (Option.isNone(configuredEndpoint)) return Layer.empty;

    let endpoint = configuredEndpoint.value;
    if (endpoint.endsWith("/")) endpoint = endpoint.slice(0, -1);
    const resource = {
      serviceName: "upwork-cli",
      serviceVersion: packageJson.version,
    };
    return Layer.merge(
      OtlpTracer.layer({
        url: `${endpoint}/v1/traces`,
        resource,
        exportInterval: "100 millis",
        shutdownTimeout: "2 seconds",
      }),
      OtlpLogger.layer({
        url: `${endpoint}/v1/logs`,
        resource,
        mergeWithExisting: false,
        shutdownTimeout: "2 seconds",
      }),
    ).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer));
  }),
);

const mainLayer = Layer.mergeAll(
  BunServices.layer,
  FetchHttpClient.layer,
  BunSocket.layerWebSocketConstructor,
  observabilityLayer,
  Layer.succeed(Headers.CurrentRedactedNames, [
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "x-upwork-api-tenantid",
  ]),
);

Command.run(app, { version: packageJson.version }).pipe(
  Effect.provide(mainLayer),
  BunRuntime.runMain,
);
