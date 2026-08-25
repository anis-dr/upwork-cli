import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { UpworkCliError } from "../src/auth.ts";
import type { JobQuery, JobQueryJob, JobQueryResult } from "../src/job-query.ts";
import {
  findShortlist,
  type ShortlistConfig,
  type ShortlistDependencies,
} from "../src/shortlist.ts";

const makeJob = (id: string, publishedAt: string, proposals: number): JobQueryJob => ({
  id,
  jobReference: `~${id}`,
  url: `https://www.upwork.com/jobs/~${id}`,
  title: `Job ${id}`,
  description: `Description ${id}`,
  skills: [{ id: "typescript", name: "TypeScript" }],
  type: "HOURLY",
  hourlyBudget: Option.none(),
  fixedPriceBudget: Option.none(),
  experienceLevel: "ExpertLevel",
  publishedAt,
  proposals: Option.some(proposals),
  applied: Option.some(false),
  client: {
    paymentVerified: true,
    country: Option.some("US"),
    reviews: 10,
    totalSpent: Option.none(),
  },
});

const makeResponse = (jobs: ReadonlyArray<JobQueryJob>, scannedPages = 1): JobQueryResult => ({
  contentTrust: "untrusted",
  paging: { total: jobs.length, offset: 0, count: jobs.length },
  scannedPages,
  jobs,
});

const makeConfig = (overrides: Partial<ShortlistConfig> = {}): ShortlistConfig => ({
  cliVersion: "0.5.0",
  queries: ["alpha", "beta"],
  maxProposals: 20,
  maxConnects: Option.none(),
  pageSize: 20,
  maxResults: 20,
  sort: "recency",
  includeUnverified: false,
  proposals: "any",
  experience: "any",
  jobType: "any",
  budget: "any",
  clientHires: "any",
  duration: "any",
  workload: "any",
  contractToHire: false,
  postedWithin: "any",
  maxPages: 10,
  ...overrides,
});

const makeDependencies = (
  responses: Readonly<Record<string, JobQueryResult>>,
  connects: Readonly<Record<string, number>>,
  failures: Readonly<Record<string, string>> = {},
): ShortlistDependencies => ({
  findJobsForQuery: (query: JobQuery) => {
    const failure = Option.fromNullishOr(failures[query.query]);
    if (Option.isSome(failure)) {
      return Effect.fail(new UpworkCliError({ message: failure.value }));
    }
    const response = Option.fromNullishOr(responses[query.query]);
    if (Option.isNone(response)) {
      return Effect.fail(new UpworkCliError({ message: `Missing response for ${query.query}` }));
    }
    return Effect.succeed(response.value);
  },
  getRequiredConnects: () => Effect.succeed({ ...connects }),
});

it.effect("deduplicates, orders, filters, and reports partial query failures", () =>
  Effect.gen(function* () {
    const shared = makeJob("shared", "2026-08-20T00:00:00.000Z", 4);
    const dependencies = makeDependencies(
      {
        alpha: makeResponse([shared, makeJob("over-proposals", "2026-08-23T00:00:00.000Z", 25)]),
        beta: makeResponse([
          makeJob("recent-expensive", "2026-08-22T00:00:00.000Z", 2),
          makeJob("second", "2026-08-21T00:00:00.000Z", 1),
          shared,
        ]),
      },
      {
        "recent-expensive": 7,
        second: 4,
        shared: 3,
      },
      { bad: "query failed" },
    );

    const result = yield* findShortlist(
      makeConfig({
        queries: ["alpha", "bad", "beta"],
        maxConnects: Option.some(5),
        maxResults: 2,
      }),
      dependencies,
    );

    expect(result.queries).toEqual([
      { query: "alpha", status: "ok", paging: { total: 2, offset: 0, count: 2 }, scannedPages: 1 },
      { query: "bad", status: "error", error: "query failed" },
      { query: "beta", status: "ok", paging: { total: 3, offset: 0, count: 3 }, scannedPages: 1 },
    ]);
    expect(result.jobs.map((job) => job.searchResultId)).toEqual(["second", "shared"]);
    expect(result.jobs[1]?.matchedQueries).toEqual(["alpha", "beta"]);
    expect(result.jobs.map((job) => job.requiredConnects)).toEqual([4, 3]);
    expect(result.jobs[0]?.hourlyBudget).toBe(Option.getOrNull(Option.none()));
    expect(result.jobs[0]?.fixedPriceBudget).toBe(Option.getOrNull(Option.none()));
    expect(result.jobs[0]?.applied).toBe(false);
    expect(result.jobs[0]?.client).toEqual({
      paymentVerified: true,
      country: "US",
      reviews: 10,
      totalSpent: Option.getOrNull(Option.none()),
    });
    expect(result.scannedPages).toBe(2);
  }),
);

it.effect("round-robins relevance results before applying the result cap", () =>
  Effect.gen(function* () {
    const dependencies = makeDependencies(
      {
        alpha: makeResponse([
          makeJob("alpha-1", "2026-08-20T00:00:00.000Z", 1),
          makeJob("alpha-2", "2026-08-23T00:00:00.000Z", 1),
        ]),
        beta: makeResponse([
          makeJob("beta-1", "2026-08-22T00:00:00.000Z", 1),
          makeJob("beta-2", "2026-08-21T00:00:00.000Z", 1),
        ]),
      },
      { "alpha-1": 1, "beta-1": 1 },
    );

    const result = yield* findShortlist(
      makeConfig({ sort: "relevance", maxResults: 2 }),
      dependencies,
    );

    expect(result.jobs.map((job) => job.searchResultId)).toEqual(["alpha-1", "beta-1"]);
  }),
);

it.effect("reports every query failure with the CLI version", () =>
  Effect.gen(function* () {
    const dependencies = makeDependencies({}, {}, { alpha: "first", beta: "second" });
    const error = yield* Effect.flip(findShortlist(makeConfig(), dependencies)).pipe(Effect.orDie);

    expect(error.message).toBe("upwork-cli 0.5.0: all queries failed. alpha: first; beta: second");
  }),
);
