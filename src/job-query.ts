import { DateTime, Effect, Option, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { UpworkCliError, loadAuthenticatedSession } from "./auth.ts";

const Money = Schema.Struct({
  isoCurrencyCode: Schema.NullOr(Schema.String),
  amount: Schema.String,
});

const Skill = Schema.Struct({
  uid: Schema.String,
  prefLabel: Schema.String,
});

const JobQueryResponse = Schema.Struct({
  data: Schema.Struct({
    search: Schema.Struct({
      universalSearchNuxt: Schema.Struct({
        userJobSearchV1: Schema.Struct({
          paging: Schema.Struct({
            total: Schema.Int,
            offset: Schema.Int,
            count: Schema.Int,
          }),
          results: Schema.Array(
            Schema.Struct({
              id: Schema.String,
              title: Schema.String,
              description: Schema.String,
              applied: Schema.NullOr(Schema.Boolean),
              ontologySkills: Schema.Array(Skill),
              upworkHistoryData: Schema.Struct({
                client: Schema.Struct({
                  paymentVerificationStatus: Schema.NullOr(Schema.String),
                  country: Schema.NullOr(Schema.String),
                  totalReviews: Schema.Int,
                  totalFeedback: Schema.Finite,
                  totalSpent: Schema.NullOr(Money),
                }),
              }),
              jobTile: Schema.Struct({
                job: Schema.Struct({
                  ciphertext: Schema.String,
                  jobType: Schema.String,
                  hourlyBudgetMin: Schema.NullOr(Schema.String),
                  hourlyBudgetMax: Schema.NullOr(Schema.String),
                  contractorTier: Schema.String,
                  publishTime: Schema.String,
                  totalApplicants: Schema.NullOr(Schema.Int),
                  fixedPriceAmount: Schema.NullOr(Money),
                }),
              }),
            }),
          ),
        }),
      }),
    }),
  }),
});

const USER_JOB_SEARCH_QUERY = `
query UserJobSearch($requestVariables: UserJobSearchV1Request!) {
  search {
    universalSearchNuxt {
      userJobSearchV1(request: $requestVariables) {
        paging { total offset count }
        results {
          id
          title
          description
          applied
          ontologySkills { uid prefLabel }
          upworkHistoryData {
            client {
              paymentVerificationStatus
              country
              totalReviews
              totalFeedback
              totalSpent { isoCurrencyCode amount }
            }
          }
          jobTile {
            job {
              ciphertext: cipherText
              jobType
              hourlyBudgetMin
              hourlyBudgetMax
              contractorTier
              publishTime
              totalApplicants
              fixedPriceAmount { isoCurrencyCode amount }
            }
          }
        }
      }
    }
  }
}`;

export type JobSort = "relevance" | "recency";
export type ProposalRange = "0-4" | "5-9" | "10-14" | "15-19" | "20-49";
export type ExperienceLevel = "entry" | "intermediate" | "expert";
export type JobType = "hourly" | "fixed";
export type BudgetRange = "under-100" | "100-499" | "500-999" | "1000-4999" | "5000-plus";
export type ClientHires = "none" | "1-9" | "10-plus";
export type ProjectDuration = "under-1-month" | "1-3-months" | "3-6-months" | "over-6-months";
export type Workload = "part-time" | "full-time" | "as-needed";

const EXPERIENCE_LEVEL_API = {
  entry: "EntryLevel",
  intermediate: "IntermediateLevel",
  expert: "ExpertLevel",
} satisfies Record<ExperienceLevel, string>;
const BUDGET_API = {
  "under-100": "0-99",
  "100-499": "100-499",
  "500-999": "500-999",
  "1000-4999": "1000-4999",
  "5000-plus": "5000-",
} satisfies Record<BudgetRange, string>;
const CLIENT_HIRES_API = {
  none: "0",
  "1-9": "1-9",
  "10-plus": "10-",
} satisfies Record<ClientHires, string>;
const PROJECT_DURATION_API = {
  "under-1-month": "week",
  "1-3-months": "month",
  "3-6-months": "semester",
  "over-6-months": "ongoing",
} satisfies Record<ProjectDuration, string>;
const WORKLOAD_API = {
  "part-time": "part_time",
  "full-time": "full_time",
  "as-needed": "as_needed",
} satisfies Record<Workload, string>;

export interface JobQuery {
  readonly query: string;
  readonly page: number;
  readonly limit: number;
  readonly sort: JobSort;
  readonly verified: boolean;
  readonly proposals: Option.Option<ProposalRange>;
  readonly experience: Option.Option<ExperienceLevel>;
  readonly jobType: Option.Option<JobType>;
  readonly budget: Option.Option<BudgetRange>;
  readonly clientHires: Option.Option<ClientHires>;
  readonly duration: Option.Option<ProjectDuration>;
  readonly workload: Option.Option<Workload>;
  readonly contractToHire: boolean;
  readonly postedAfter: Option.Option<number>;
  readonly maxPages: number;
}

export interface JobQueryMoney {
  readonly isoCurrencyCode: Option.Option<string>;
  readonly amount: string;
}

export interface JobQueryHourlyBudget {
  readonly min: string;
  readonly max: string;
  readonly currency: "USD";
}

export interface JobQueryJob {
  readonly id: string;
  readonly jobReference: string;
  readonly url: string;
  readonly title: string;
  readonly description: string;
  readonly skills: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
  }>;
  readonly type: string;
  readonly hourlyBudget: Option.Option<JobQueryHourlyBudget>;
  readonly fixedPriceBudget: Option.Option<JobQueryMoney>;
  readonly experienceLevel: string;
  readonly publishedAt: string;
  readonly proposals: Option.Option<number>;
  readonly applied: Option.Option<boolean>;
  readonly client: {
    readonly paymentVerified: boolean;
    readonly country: Option.Option<string>;
    readonly reviews: number;
    readonly totalSpent: Option.Option<JobQueryMoney>;
  };
}

export interface JobQueryResult {
  readonly contentTrust: "untrusted";
  readonly paging: {
    readonly total: number;
    readonly offset: number;
    readonly count: number;
  };
  readonly scannedPages: number;
  readonly jobs: ReadonlyArray<JobQueryJob>;
}

interface UserJobSearchVariables {
  userQuery: string;
  sort: string;
  highlight: boolean;
  paging: {
    offset: number;
    count: number;
  };
  verifiedPaymentOnly?: true;
  proposals?: ReadonlyArray<ProposalRange>;
  contractorTier?: ReadonlyArray<string>;
  jobType?: ReadonlyArray<JobType>;
  budget?: ReadonlyArray<string>;
  clientHires?: ReadonlyArray<string>;
  durationV3?: ReadonlyArray<string>;
  workload?: ReadonlyArray<string>;
  contractToHire?: true;
}

const validateJobQuery = (options: JobQuery) => {
  if (options.query.trim().length === 0) return Option.some("Search query cannot be empty");
  if (options.page < 1) return Option.some("Page must be at least 1");
  if (options.limit < 1 || options.limit > 50) {
    return Option.some("Limit must be between 1 and 50");
  }
  if (options.maxPages < 1 || options.maxPages > 50) {
    return Option.some("Maximum pages must be between 1 and 50");
  }
  return Option.none<string>();
};

export const findJobsForQuery = Effect.fn("Upwork.findJobsForQuery")(function* (options: JobQuery) {
  const validationError = validateJobQuery(options);
  if (Option.isSome(validationError)) {
    return yield* new UpworkCliError({ message: validationError.value });
  }

  const session = yield* loadAuthenticatedSession();
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const fetchJobPage = Effect.fnUntraced(function* (page: number) {
    let sort = options.sort;
    if (Option.isSome(options.postedAfter)) sort = "recency";

    const requestVariables: UserJobSearchVariables = {
      userQuery: options.query.trim(),
      sort: `${sort}+desc`,
      highlight: false,
      paging: {
        offset: (page - 1) * options.limit,
        count: options.limit,
      },
    };
    if (options.verified) requestVariables.verifiedPaymentOnly = true;
    if (Option.isSome(options.proposals)) {
      requestVariables.proposals = [options.proposals.value];
    }
    if (Option.isSome(options.experience)) {
      requestVariables.contractorTier = [EXPERIENCE_LEVEL_API[options.experience.value]];
    }
    if (Option.isSome(options.jobType)) {
      requestVariables.jobType = [options.jobType.value];
    }
    if (Option.isSome(options.budget)) {
      requestVariables.budget = [BUDGET_API[options.budget.value]];
    }
    if (Option.isSome(options.clientHires)) {
      requestVariables.clientHires = [CLIENT_HIRES_API[options.clientHires.value]];
    }
    if (Option.isSome(options.duration)) {
      requestVariables.durationV3 = [PROJECT_DURATION_API[options.duration.value]];
    }
    if (Option.isSome(options.workload)) {
      requestVariables.workload = [WORKLOAD_API[options.workload.value]];
    }
    if (options.contractToHire) requestVariables.contractToHire = true;

    const response = yield* HttpClientRequest.post(
      "https://www.upwork.com/api/graphql/v1?alias=userJobSearch",
    ).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bearerToken(session.bearerToken),
      HttpClientRequest.setHeader("x-upwork-api-tenantid", session.tenantId),
      HttpClientRequest.setHeader("referer", "https://www.upwork.com/"),
      HttpClientRequest.bodyJsonUnsafe({
        query: USER_JOB_SEARCH_QUERY,
        variables: { requestVariables },
      }),
      client.execute,
      Effect.flatMap(HttpClientResponse.schemaBodyJson(JobQueryResponse)),
      Effect.withSpan("Upwork.findJobsPage", {
        attributes: {
          "upwork.page": page,
          "upwork.offset": requestVariables.paging.offset,
        },
      }),
      Effect.mapError((cause) => new UpworkCliError({ message: "Upwork search failed", cause })),
    );

    const search = response.data.search.universalSearchNuxt.userJobSearchV1;
    const jobs = search.results.map((result): JobQueryJob => {
      const job = result.jobTile.job;
      const clientInfo = result.upworkHistoryData.client;
      const hourlyBudget = Option.all({
        min: Option.fromNullishOr(job.hourlyBudgetMin),
        max: Option.fromNullishOr(job.hourlyBudgetMax),
      }).pipe(
        Option.map(({ min, max }): JobQueryHourlyBudget => ({
          min,
          max,
          currency: "USD",
        })),
      );
      return {
        id: result.id,
        jobReference: job.ciphertext,
        url: `https://www.upwork.com/jobs/${job.ciphertext}`,
        title: result.title,
        description: result.description,
        skills: result.ontologySkills.map((skill) => ({ id: skill.uid, name: skill.prefLabel })),
        type: job.jobType,
        hourlyBudget,
        fixedPriceBudget: Option.fromNullishOr(job.fixedPriceAmount).pipe(
          Option.map(({ isoCurrencyCode, amount }): JobQueryMoney => ({
            isoCurrencyCode: Option.fromNullishOr(isoCurrencyCode),
            amount,
          })),
        ),
        experienceLevel: job.contractorTier,
        publishedAt: job.publishTime,
        proposals: Option.fromNullishOr(job.totalApplicants),
        applied: Option.fromNullishOr(result.applied),
        client: {
          paymentVerified: clientInfo.paymentVerificationStatus === "VERIFIED",
          country: Option.fromNullishOr(clientInfo.country),
          reviews: clientInfo.totalReviews,
          totalSpent: Option.fromNullishOr(clientInfo.totalSpent).pipe(
            Option.map(({ isoCurrencyCode, amount }): JobQueryMoney => ({
              isoCurrencyCode: Option.fromNullishOr(isoCurrencyCode),
              amount,
            })),
          ),
        },
      };
    });
    return { paging: search.paging, jobs };
  });

  const first = yield* fetchJobPage(options.page);
  const postedAfter = options.postedAfter;
  if (Option.isNone(postedAfter)) {
    return {
      contentTrust: "untrusted",
      paging: first.paging,
      scannedPages: 1,
      jobs: first.jobs,
    } satisfies JobQueryResult;
  }

  const cutoff = postedAfter.value;
  const jobs = first.jobs.filter((job) =>
    Option.match(DateTime.make(job.publishedAt), {
      onNone: () => false,
      onSome: (dateTime) => DateTime.toEpochMillis(dateTime) >= cutoff,
    }),
  );
  let scannedPages = 1;
  let current = first;
  let done =
    jobs.length < current.jobs.length ||
    current.jobs.length < options.limit ||
    current.paging.offset + current.paging.count >= current.paging.total;

  while (!done && scannedPages < options.maxPages) {
    current = yield* fetchJobPage(options.page + scannedPages);
    const recent = current.jobs.filter((job) =>
      Option.match(DateTime.make(job.publishedAt), {
        onNone: () => false,
        onSome: (dateTime) => DateTime.toEpochMillis(dateTime) >= cutoff,
      }),
    );
    jobs.push(...recent);
    scannedPages += 1;
    done =
      recent.length < current.jobs.length ||
      current.jobs.length < options.limit ||
      current.paging.offset + current.paging.count >= current.paging.total;
  }

  return {
    contentTrust: "untrusted",
    paging: {
      ...first.paging,
      count: jobs.length,
    },
    scannedPages,
    jobs,
  } satisfies JobQueryResult;
});
