#!/usr/bin/env bun
import { BunRuntime, BunServices, BunSocket } from "@effect/platform-bun";
import { Array, Clock, Console, Effect, Layer, Option, Result, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
import packageJson from "../package.json" with { type: "json" };
import { captureAuth, CliError, loginAuth } from "./auth.ts";
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
      const result = yield* loginAuth(cdp, timeoutMinutes);
      if (result.wasAlreadyAuthenticated) {
        yield* Console.log("Already authenticated with Upwork.");
      } else {
        yield* Console.log("Authenticated with Upwork.");
        if (result.browserClosed) {
          yield* Console.log("Chrome closed.");
        } else {
          yield* Console.log("Chrome could not be closed automatically. You can close it now.");
        }
      }
      yield* Console.log(`Session saved to ${result.path}.`);
    }),
).pipe(Command.withDescription("Open Chrome and wait for Upwork authentication"));
const captureCommand = Command.make("capture", { cdp: cdpFlag }, ({ cdp }) =>
  Effect.gen(function* () {
    const result = yield* captureAuth(cdp);
    yield* Console.log("Authentication captured.");
    yield* Console.log(`Session saved to ${result.path}.`);
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

const jobInput = Argument.string("job").pipe(
  Argument.withDescription("Upwork job URL, ciphertext, or ID"),
);
const jobCommand = Command.make("job", { job: jobInput }, ({ job }) =>
  Effect.gen(function* () {
    const result = yield* getJob(job);
    return yield* printJson({
      meta: { cliVersion: packageJson.version },
      ...result,
    });
  }),
).pipe(Command.withDescription("Return complete data for one Upwork job"));

const findQueries = Argument.string("query").pipe(
  Argument.variadic({ min: 1 }),
  Argument.withDescription("Queries to combine"),
);
const maxProposalsFlag = Flag.integer("max-proposals").pipe(
  Flag.withDefault(20),
  Flag.withDescription("Drop jobs above this applicant count"),
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

interface FindJob {
  readonly id: string;
  readonly proposals: number;
  readonly publishedAt: string;
}

interface FindQueryJobs<Job extends FindJob> {
  readonly query: string;
  readonly jobs: ReadonlyArray<Job>;
}

const mergeFindJobLists = <Job extends FindJob>(
  queryResults: ReadonlyArray<FindQueryJobs<Job>>,
  sort: "relevance" | "recency",
  maxProposals: number,
): Array<Job & { readonly matchedQueries: ReadonlyArray<string> }> => {
  const seen = new Set<string>();
  const matchedQueriesById = new Map<string, Array<string>>();
  const jobs: Array<Job> = [];
  const addJob = (job: Job) => {
    if (seen.has(job.id) || job.proposals > maxProposals) return;
    seen.add(job.id);
    jobs.push(job);
  };

  for (const result of queryResults) {
    for (const job of result.jobs) {
      if (job.proposals > maxProposals) continue;
      const matchedQueries = Option.fromNullishOr(matchedQueriesById.get(job.id));
      if (Option.isSome(matchedQueries)) {
        if (!matchedQueries.value.includes(result.query)) matchedQueries.value.push(result.query);
      } else {
        matchedQueriesById.set(job.id, [result.query]);
      }
    }
  }

  if (sort === "recency") {
    for (const result of queryResults) {
      for (const job of result.jobs) addJob(job);
    }
    jobs.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
  } else {
    let index = 0;
    let hasJobs = true;
    while (hasJobs) {
      hasJobs = false;
      for (const result of queryResults) {
        const candidate = Option.fromNullishOr(result.jobs[index]);
        if (Option.isSome(candidate)) {
          hasJobs = true;
          addJob(candidate.value);
        }
      }
      index += 1;
    }
  }

  return jobs.map((job) => ({
    ...job,
    matchedQueries: Option.fromNullishOr(matchedQueriesById.get(job.id)).pipe(
      Option.getOrElse(() => []),
    ),
  }));
};

const findCommand = Command.make(
  "find",
  {
    queries: findQueries,
    maxProposals: maxProposalsFlag,
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
    Effect.gen(function* () {
      if (config.maxProposals < 0) {
        return yield* new CliError({
          message: "Maximum proposals cannot be negative",
        });
      }
      if (config.maxResults < 1) {
        return yield* new CliError({
          message: "Maximum results must be at least 1",
        });
      }
      if (config.postedWithin !== "any" && config.sort === "relevance") {
        return yield* new CliError({
          message: "--posted-within requires --sort recency",
        });
      }

      const postedAfter = yield* getPostedAfter(config.postedWithin);
      const selectedQueries = config.queries;
      const outcomes = yield* Effect.forEach(
        selectedQueries,
        (query) => {
          const options = applySearchFilters(
            {
              query,
              page: 1,
              limit: config.pageSize,
              sort: config.sort,
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
          return searchJobs(options).pipe(Effect.result);
        },
        { concurrency: 2 },
      );
      const queryOutcomes = Array.zip(selectedQueries, outcomes);
      const successful = queryOutcomes.flatMap(([query, outcome]) => {
        if (Result.isFailure(outcome)) return [];
        return [{ query, response: outcome.success }];
      });
      const queryMetadata = queryOutcomes.map(([query, outcome]) => {
        if (Result.isFailure(outcome)) {
          return {
            query,
            status: "error",
            error: outcome.failure.message,
          };
        }
        return {
          query,
          status: "ok",
          paging: outcome.success.paging,
          scannedPages: outcome.success.scannedPages,
        };
      });
      if (successful.length === 0) {
        const failures = queryOutcomes.flatMap(([query, outcome]) => {
          if (Result.isSuccess(outcome)) return [];
          return [`${query}: ${outcome.failure.message}`];
        });
        return yield* new CliError({
          message: `upwork-cli ${packageJson.version}: all queries failed. ${failures.join("; ")}`,
        });
      }

      const mergedJobs = mergeFindJobLists(
        successful.map(({ query, response }) => ({ query, jobs: response.jobs })),
        config.sort,
        config.maxProposals,
      );
      const jobs = mergedJobs.slice(0, config.maxResults).map((job) => ({
        id: job.id,
        ciphertext: job.ciphertext,
        url: job.url,
        title: job.title,
        skills: job.skills.map((skill) => skill.name),
        type: job.type,
        hourlyBudget: job.hourlyBudget,
        fixedPriceBudget: job.fixedPriceBudget,
        experienceLevel: job.experienceLevel,
        publishedAt: job.publishedAt,
        proposals: job.proposals,
        applied: job.applied,
        client: job.client,
        matchedQueries: job.matchedQueries,
      }));

      return yield* printJson({
        meta: {
          cliVersion: packageJson.version,
        },
        contentTrust: "untrusted",
        queries: queryMetadata,
        filters: {
          paymentVerified: !config.includeUnverified,
          maxProposals: config.maxProposals,
          maxResults: config.maxResults,
          sort: config.sort,
          pageSize: config.pageSize,
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
        scannedPages: successful.reduce((total, { response }) => total + response.scannedPages, 0),
        jobs,
      });
    }),
).pipe(Command.withDescription("Combine, deduplicate, and filter job searches"));

const app = Command.make("upwork").pipe(
  Command.withDescription("Read-only Upwork CLI for agents"),
  Command.withSubcommands([authCommand, jobCommand, findCommand]),
);

const mainLayer = Layer.mergeAll(
  BunServices.layer,
  FetchHttpClient.layer,
  BunSocket.layerWebSocketConstructor,
);

Command.run(app, { version: packageJson.version }).pipe(
  Effect.provide(mainLayer),
  BunRuntime.runMain,
);
