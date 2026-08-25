import { Array, Clock, Effect, Option, Result } from "effect";
import type {
  BudgetRange,
  ClientHires,
  ExperienceLevel,
  JobQuery,
  JobQueryResult,
  JobSort,
  JobType,
  ProjectDuration,
  ProposalRange,
  Workload,
} from "./job-query.ts";
import { UpworkCliError } from "./auth.ts";

const POSTED_WITHIN_MILLIS = {
  "24h": 24 * 60 * 60 * 1_000,
  "3d": 3 * 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
};

type PostedWithin = "any" | keyof typeof POSTED_WITHIN_MILLIS;

export interface ShortlistConfig {
  readonly cliVersion: string;
  readonly queries: ReadonlyArray<string>;
  readonly maxProposals: number;
  readonly maxConnects: Option.Option<number>;
  readonly pageSize: number;
  readonly maxResults: number;
  readonly sort: JobSort;
  readonly includeUnverified: boolean;
  readonly proposals: "any" | ProposalRange;
  readonly experience: "any" | ExperienceLevel;
  readonly jobType: "any" | JobType;
  readonly budget: "any" | BudgetRange;
  readonly clientHires: "any" | ClientHires;
  readonly duration: "any" | ProjectDuration;
  readonly workload: "any" | Workload;
  readonly contractToHire: boolean;
  readonly postedWithin: PostedWithin;
  readonly maxPages: number;
}

export interface ShortlistDependencies<
  Error extends { readonly message: string } = UpworkCliError,
  Requirements = never,
> {
  readonly findJobsForQuery: (
    query: JobQuery,
  ) => Effect.Effect<JobQueryResult, Error, Requirements>;
  readonly getRequiredConnects: (
    jobIds: ReadonlyArray<string>,
  ) => Effect.Effect<Readonly<Record<string, number>>, Error, Requirements>;
}

interface FindFilters {
  readonly proposals: "any" | ProposalRange;
  readonly experience: "any" | ExperienceLevel;
  readonly jobType: "any" | JobType;
  readonly budget: "any" | BudgetRange;
  readonly clientHires: "any" | ClientHires;
  readonly duration: "any" | ProjectDuration;
  readonly workload: "any" | Workload;
}

interface MergeableJob {
  readonly id: string;
  readonly proposals: Option.Option<number>;
  readonly publishedAt: string;
}

interface QueryJobList<Job extends MergeableJob> {
  readonly query: string;
  readonly jobs: ReadonlyArray<Job>;
}

interface FailedQueryOutcome {
  readonly query: string;
  readonly status: "error";
  readonly error: string;
}

interface SuccessfulQueryOutcome {
  readonly query: string;
  readonly status: "ok";
  readonly paging: JobQueryResult["paging"];
  readonly scannedPages: number;
}

type QueryOutcome = FailedQueryOutcome | SuccessfulQueryOutcome;

const resolvePostedAfter = Effect.fnUntraced(function* (postedWithin: PostedWithin) {
  if (postedWithin === "any") return Option.none<number>();
  const now = yield* Clock.currentTimeMillis;
  return Option.some(now - POSTED_WITHIN_MILLIS[postedWithin]);
});

const applyFindFilters = (base: JobQuery, filters: FindFilters): JobQuery => {
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

const mergeQueryJobLists = <Job extends MergeableJob>(
  queryResults: ReadonlyArray<QueryJobList<Job>>,
  sort: JobSort,
  maxProposals: number,
): Array<Job & { readonly matchedQueries: ReadonlyArray<string> }> => {
  const seen = new Set<string>();
  const matchedQueriesById = new Map<string, Array<string>>();
  const jobs: Array<Job> = [];
  const isEligible = (job: Job) =>
    Option.exists(job.proposals, (proposals) => proposals <= maxProposals);
  const addJob = (job: Job) => {
    if (seen.has(job.id) || !isEligible(job)) return;
    seen.add(job.id);
    jobs.push(job);
  };

  for (const result of queryResults) {
    for (const job of result.jobs) {
      if (!isEligible(job)) continue;
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

export const findShortlist = Effect.fn("Shortlist.find")(function* <
  Error extends { readonly message: string },
  Requirements,
>(config: ShortlistConfig, dependencies: ShortlistDependencies<Error, Requirements>) {
  if (config.maxProposals < 0) {
    return yield* new UpworkCliError({
      message: "Maximum proposals cannot be negative",
    });
  }
  if (Option.exists(config.maxConnects, (maxConnects) => maxConnects < 0)) {
    return yield* new UpworkCliError({
      message: "Maximum Connects cannot be negative",
    });
  }
  if (config.maxResults < 1) {
    return yield* new UpworkCliError({
      message: "Maximum results must be at least 1",
    });
  }
  if (config.postedWithin !== "any" && config.sort === "relevance") {
    return yield* new UpworkCliError({
      message: "--posted-within requires --sort recency",
    });
  }

  const postedAfter = yield* resolvePostedAfter(config.postedWithin);
  const queryResults = yield* Effect.forEach(
    config.queries,
    (query) => {
      const jobQuery = applyFindFilters(
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
      return dependencies
        .findJobsForQuery(jobQuery)
        .pipe(Effect.annotateSpans({ "upwork.query": query }), Effect.result);
    },
    { concurrency: 2 },
  );
  const pairedResults = Array.zip(config.queries, queryResults);
  const successfulQueries = pairedResults.flatMap(([query, result]) => {
    if (Result.isFailure(result)) return [];
    return [{ query, response: result.success }];
  });
  const queryOutcomes = pairedResults.map(([query, result]): QueryOutcome => {
    if (Result.isFailure(result)) {
      return {
        query,
        status: "error",
        error: result.failure.message,
      };
    }
    return {
      query,
      status: "ok",
      paging: result.success.paging,
      scannedPages: result.success.scannedPages,
    };
  });
  if (successfulQueries.length === 0) {
    const failures = pairedResults.flatMap(([query, result]) => {
      if (Result.isSuccess(result)) return [];
      return [`${query}: ${result.failure.message}`];
    });
    return yield* new UpworkCliError({
      message: `upwork-cli ${config.cliVersion}: all queries failed. ${failures.join("; ")}`,
    });
  }

  const mergedJobs = mergeQueryJobLists(
    successfulQueries.map(({ query, response }) => ({ query, jobs: response.jobs })),
    config.sort,
    config.maxProposals,
  );
  const connectsCandidates = Option.match(config.maxConnects, {
    onNone: () => mergedJobs.slice(0, config.maxResults),
    onSome: () => mergedJobs,
  });
  const requiredConnects = yield* dependencies.getRequiredConnects(
    connectsCandidates.map((job) => job.id),
  );
  const selectedJobs = connectsCandidates
    .filter((job) =>
      Option.match(config.maxConnects, {
        onNone: () => true,
        onSome: (maximum) =>
          Option.fromNullishOr(requiredConnects[job.id]).pipe(
            Option.exists((required) => required <= maximum),
          ),
      }),
    )
    .slice(0, config.maxResults);
  const jobSummaries = selectedJobs.map((job) => ({
    searchResultId: job.id,
    jobReference: job.jobReference,
    url: job.url,
    title: job.title,
    skills: job.skills.map((skill) => skill.name),
    type: job.type,
    hourlyBudget: Option.getOrNull(job.hourlyBudget),
    fixedPriceBudget: job.fixedPriceBudget.pipe(
      Option.map(({ isoCurrencyCode, amount }) => ({
        isoCurrencyCode: Option.getOrNull(isoCurrencyCode),
        amount,
      })),
      Option.getOrNull,
    ),
    experienceLevel: job.experienceLevel,
    publishedAt: job.publishedAt,
    proposals: Option.getOrNull(job.proposals),
    requiredConnects: Option.fromNullishOr(requiredConnects[job.id]).pipe(Option.getOrNull),
    applied: Option.getOrNull(job.applied),
    client: {
      paymentVerified: job.client.paymentVerified,
      country: Option.getOrNull(job.client.country),
      reviews: job.client.reviews,
      totalSpent: job.client.totalSpent.pipe(
        Option.map(({ isoCurrencyCode, amount }) => ({
          isoCurrencyCode: Option.getOrNull(isoCurrencyCode),
          amount,
        })),
        Option.getOrNull,
      ),
    },
    matchedQueries: job.matchedQueries,
  }));

  return {
    meta: {
      cliVersion: config.cliVersion,
    },
    contentTrust: "untrusted",
    queries: queryOutcomes,
    filters: {
      paymentVerified: !config.includeUnverified,
      maxProposals: config.maxProposals,
      maxConnects: Option.getOrNull(config.maxConnects),
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
    scannedPages: successfulQueries.reduce(
      (total, { response }) => total + response.scannedPages,
      0,
    ),
    jobs: jobSummaries,
  };
});
