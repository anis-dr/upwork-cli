#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Clock, Console, Effect, Layer, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
import { captureAuth, CliError } from "./auth.ts";
import {
  getJob,
  searchJobs,
  type BudgetRange,
  type ClientHires,
  type ExperienceLevel,
  type JobType,
  type ProjectDuration,
  type ProposalRange,
  type SearchOptions,
  type Workload,
} from "./upwork.ts";

const encodeJson = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown, { space: 2 }));

const printJson = <A>(value: A) =>
  encodeJson(value).pipe(
    Effect.mapError((cause) => new CliError({ message: "Could not encode CLI output", cause })),
    Effect.flatMap(Console.log),
  );

const cdpFlag = Flag.integer("cdp").pipe(
  Flag.withDefault(9222),
  Flag.withDescription("Chrome DevTools Protocol port"),
);
const captureCommand = Command.make("capture", { cdp: cdpFlag }, ({ cdp }) =>
  captureAuth(cdp).pipe(Effect.flatMap(printJson)),
).pipe(Command.withDescription("Capture authenticated Upwork state from Chrome"));

const authCommand = Command.make("auth").pipe(
  Command.withDescription("Manage local Upwork authentication"),
  Command.withSubcommands([captureCommand]),
);

const queryArgument = Argument.string("query").pipe(
  Argument.withDescription("Upwork job search query"),
);
const pageFlag = Flag.integer("page").pipe(
  Flag.withDefault(1),
  Flag.withDescription("Results page, starting at 1"),
);
const limitFlag = Flag.integer("limit").pipe(
  Flag.withDefault(10),
  Flag.withDescription("Jobs per page, from 1 to 50"),
);
const sortFlag = Flag.choice("sort", ["relevance", "recency"]).pipe(
  Flag.withDefault("relevance"),
  Flag.withDescription("Result ordering"),
);
const verifiedFlag = Flag.boolean("verified").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Only return payment-verified clients"),
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
const POSTED_WITHIN_MILLIS = {
  "24h": 24 * 60 * 60 * 1_000,
  "3d": 3 * 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
};

type PostedWithin = "any" | keyof typeof POSTED_WITHIN_MILLIS;

interface CliSearchFilters {
  readonly proposals: "any" | ProposalRange;
  readonly experience: "any" | ExperienceLevel;
  readonly jobType: "any" | JobType;
  readonly budget: "any" | BudgetRange;
  readonly clientHires: "any" | ClientHires;
  readonly duration: "any" | ProjectDuration;
  readonly workload: "any" | Workload;
}

const getPostedAfter = Effect.fnUntraced(function* (postedWithin: PostedWithin) {
  if (postedWithin === "any") return Option.none<number>();
  const now = yield* Clock.currentTimeMillis;
  return Option.some(now - POSTED_WITHIN_MILLIS[postedWithin]);
});

const applySearchFilters = (base: SearchOptions, filters: CliSearchFilters): SearchOptions => {
  let configured = base;
  if (filters.proposals !== "any") {
    configured = { ...configured, proposals: Option.some(filters.proposals) };
  }
  if (filters.experience !== "any") {
    configured = { ...configured, experience: Option.some(filters.experience) };
  }
  if (filters.jobType !== "any") {
    configured = { ...configured, jobType: Option.some(filters.jobType) };
  }
  if (filters.budget !== "any") {
    configured = { ...configured, budget: Option.some(filters.budget) };
  }
  if (filters.clientHires !== "any") {
    configured = {
      ...configured,
      clientHires: Option.some(filters.clientHires),
    };
  }
  if (filters.duration !== "any") {
    configured = { ...configured, duration: Option.some(filters.duration) };
  }
  if (filters.workload !== "any") {
    configured = { ...configured, workload: Option.some(filters.workload) };
  }
  return configured;
};

const searchCommand = Command.make(
  "search",
  {
    query: queryArgument,
    page: pageFlag,
    limit: limitFlag,
    sort: sortFlag,
    verified: verifiedFlag,
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
    Effect.gen(function* () {
      const postedAfter = yield* getPostedAfter(config.postedWithin);
      const options = applySearchFilters(
        {
          query: config.query,
          page: config.page,
          limit: config.limit,
          sort: config.sort,
          verified: config.verified,
          proposals: Option.none(),
          experience: Option.none(),
          jobType: Option.none(),
          budget: Option.none(),
          clientHires: Option.none(),
          duration: Option.none(),
          workload: Option.none(),
          contractToHire: config.contractToHire,
          postedAfter,
          maxPages: config.maxPages,
        },
        config,
      );
      const result = yield* searchJobs(options);
      return yield* printJson(result);
    }),
).pipe(Command.withDescription("Search Upwork jobs"));

const jobInput = Argument.string("job").pipe(
  Argument.withDescription("Upwork job URL, ciphertext, or ID"),
);
const jobCommand = Command.make("job", { job: jobInput }, ({ job }) =>
  getJob(job).pipe(Effect.flatMap(printJson)),
).pipe(Command.withDescription("Return complete data for one Upwork job"));

const findQueries = Argument.string("query").pipe(
  Argument.variadic({ min: 1 }),
  Argument.withDescription("Queries to combine"),
);
const maxProposalsFlag = Flag.integer("max-proposals").pipe(
  Flag.withDefault(20),
  Flag.withDescription("Drop jobs above this applicant count"),
);
const perQueryFlag = Flag.integer("per-query").pipe(
  Flag.withDefault(20),
  Flag.withDescription("Jobs fetched for each query, from 1 to 50"),
);
const includeUnverifiedFlag = Flag.boolean("include-unverified").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Include clients without verified payment"),
);

const findCommand = Command.make(
  "find",
  {
    queries: findQueries,
    maxProposals: maxProposalsFlag,
    perQuery: perQueryFlag,
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
    Effect.gen(function* () {
      if (config.maxProposals < 0) {
        return yield* new CliError({
          message: "Maximum proposals cannot be negative",
        });
      }

      const postedAfter = yield* getPostedAfter(config.postedWithin);
      const selectedQueries = config.queries;
      const responses = yield* Effect.forEach(
        selectedQueries,
        (query) => {
          const options = applySearchFilters(
            {
              query,
              page: 1,
              limit: config.perQuery,
              sort: "recency",
              verified: !config.includeUnverified,
              proposals: Option.none(),
              experience: Option.none(),
              jobType: Option.none(),
              budget: Option.none(),
              clientHires: Option.none(),
              duration: Option.none(),
              workload: Option.none(),
              contractToHire: config.contractToHire,
              postedAfter,
              maxPages: config.maxPages,
            },
            config,
          );
          return searchJobs(options);
        },
        { concurrency: 2 },
      );

      const seen = new Set<string>();
      const jobs = responses
        .flatMap((response) => response.jobs)
        .filter((job) => {
          if (seen.has(job.id) || job.proposals > config.maxProposals) return false;
          seen.add(job.id);
          return true;
        });
      jobs.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));

      return yield* printJson({
        contentTrust: "untrusted",
        queries: selectedQueries,
        filters: {
          paymentVerified: !config.includeUnverified,
          maxProposals: config.maxProposals,
          proposals: config.proposals,
          experience: config.experience,
          jobType: config.jobType,
          fixedBudget: config.budget,
          clientHires: config.clientHires,
          duration: config.duration,
          workload: config.workload,
          contractToHire: config.contractToHire,
          postedWithin: config.postedWithin,
        },
        scannedPages: responses.reduce((total, response) => total + response.scannedPages, 0),
        jobs,
      });
    }),
).pipe(Command.withDescription("Combine, deduplicate, and filter job searches"));

const app = Command.make("upwork").pipe(
  Command.withDescription("Read-only Upwork CLI for agents"),
  Command.withSubcommands([authCommand, searchCommand, jobCommand, findCommand]),
);

const mainLayer = Layer.merge(BunServices.layer, FetchHttpClient.layer);

Command.run(app, { version: "0.1.0" }).pipe(Effect.provide(mainLayer), BunRuntime.runMain);
