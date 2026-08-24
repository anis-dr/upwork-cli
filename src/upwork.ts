import { DateTime, Effect, Option, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { CliError, loadAuth } from "./auth.ts";

const Money = Schema.Struct({
  isoCurrencyCode: Schema.NullOr(Schema.String),
  amount: Schema.String,
});

const Skill = Schema.Struct({
  uid: Schema.String,
  prefLabel: Schema.String,
});

const SearchResponse = Schema.Struct({
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
              applied: Schema.Boolean,
              ontologySkills: Schema.Array(Skill),
              upworkHistoryData: Schema.Struct({
                client: Schema.Struct({
                  paymentVerificationStatus: Schema.NullOr(Schema.String),
                  country: Schema.NullOr(Schema.String),
                  totalReviews: Schema.Int,
                  totalFeedback: Schema.Finite,
                  totalSpent: Money,
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
                  totalApplicants: Schema.Int,
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

const JobDetailsResponse = Schema.Struct({
  data: Schema.Struct({
    jobAuthDetails: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
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

const JOB_DETAILS_QUERY = `
query JobAuthDetailsQuery(
  $id: ID!
  $isFreelancerOrAgency: Boolean!
  $isLoggedIn: Boolean!
) {
  jobAuthDetails(id: $id) {
    topClient
    hiredApplicantNames
    opening {
      job {
        status
        postedOn
        publishTime
        sourcingTime
        startDate
        deliveryDate
        workload
        contractorTier
        description
        info {
          ciphertext
          id
          type
          access
          title
          hideBudget
          createdOn
          premium
        }
        segmentationData {
          customValue
          label
          name
          sortOrder
          type
          value
          skill {
            description
            externalLink
            prettyName
            skill
            id
          }
        }
        sandsData {
          occupation {
            freeText
            ontologyId
            prefLabel
            id
          }
          ontologySkills {
            groupId
            id
            freeText
            prefLabel
            groupPrefLabel
            relevance
          }
          additionalSkills {
            groupId
            id
            freeText
            prefLabel
            relevance
          }
        }
        category {
          name
          urlSlug
        }
        categoryGroup {
          name
          urlSlug
        }
        budget {
          amount
          currencyCode
        }
        annotations {
          customFields
          tags
        }
        engagementDuration {
          label
          weeks
        }
        extendedBudgetInfo {
          hourlyBudgetMin
          hourlyBudgetMax
          hourlyBudgetType
        }
        attachments @include(if: $isLoggedIn) {
          fileName
          length
          uri
        }
        clientActivity {
          lastBuyerActivity
          totalApplicants
          totalHired
          totalInvitedToInterview
          unansweredInvites
          invitationsSent
          numberOfPositionsToHire
        }
        deliverables
        deadline
        tools {
          name
        }
      }
      qualifications {
        countries
        earnings
        languages
        localDescription
        localFlexibilityDescription
        localMarket
        minJobSuccessScore
        minOdeskHours
        onSiteType
        prefEnglishSkill
        regions
        risingTalent
        shouldHavePortfolio
        states
        tests
        timezones
        type
        locationCheckRequired
        group {
          groupId
          groupLogo
          groupName
        }
        location {
          city
          country
          countryTimezone
          offsetFromUtcMillis
          state
          worldRegion
        }
        locations {
          id
          type
        }
        minHoursWeek @skip(if: $isLoggedIn)
        readyToStartToday {
          expiresAt
        }
      }
      questions {
        question
        position
      }
    }
    buyer {
      enterprise
      isPaymentMethodVerified
      info {
        location {
          offsetFromUtcMillis
          countryTimezone
          city
          country
        }
        stats {
          totalAssignments
          activeAssignmentsCount
          hoursCount
          feedbackCount
          score
          totalJobsWithHires
          totalCharges {
            amount
          }
        }
        company {
          name @include(if: $isLoggedIn)
          companyId @include(if: $isLoggedIn)
          contractDate
          profile {
            industry
            size
          }
        }
        jobs {
          openCount @include(if: $isLoggedIn)
          postedCount @include(if: $isLoggedIn)
          openJobs @include(if: $isLoggedIn) {
            id
            ciphertext
            title
            type
          }
        }
        avgHourlyJobsRate @include(if: $isLoggedIn) {
          amount
        }
      }
      workHistory {
        status
        startDate
        endDate
        totalCharge
        totalHours
        jobInfo {
          title
          id
          access
          type
          ciphertext
        }
        contractorInfo {
          contractorName
          accessType
          ciphertext
        }
        rate {
          amount
        }
        feedback {
          feedbackSuppressed
          score
          comment
        }
        feedbackToClient {
          feedbackSuppressed
          score
          comment
        }
      }
    }
    currentUserInfo {
      owner
      freelancerInfo {
        profileState
        applied
        devProfileCiphertext
        hired
        application {
          vjApplicationId
        }
        pendingInvite {
          inviteId
        }
        contract {
          contractId
          status
        }
        hourlyRate {
          amount
        }
        qualificationsMatches {
          matches {
            clientPreferred
            clientPreferredLabel
            freelancerValue
            freelancerValueLabel
            qualification
            qualified
          }
        }
      }
    }
    similarJobs {
      id
      ciphertext
      title
      snippet
    }
    workLocation {
      onSiteCity
      onSiteCountry
      onSiteReason
      onSiteReasonFlexible
      onSiteState
      onSiteType
    }
    phoneVerificationStatus {
      status
    }
    applicantsBidsStats {
      avgRateBid {
        amount
        currencyCode
      }
      minRateBid {
        amount
        currencyCode
      }
      maxRateBid {
        amount
        currencyCode
      }
    }
    specializedProfileOccupationId @include(if: $isFreelancerOrAgency)
    applicationContext @include(if: $isFreelancerOrAgency) {
      freelancerAllowed
      clientAllowed
    }
  }
}`;

export type SearchSort = "relevance" | "recency";
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

export interface SearchOptions {
  readonly query: string;
  readonly page: number;
  readonly limit: number;
  readonly sort: SearchSort;
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

const requestError = (message: string) => (cause: unknown) => new CliError({ message, cause });

const validateSearchOptions = (options: SearchOptions) => {
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

export const searchJobs = Effect.fn("Upwork.searchJobs")(function* (options: SearchOptions) {
  const validationError = validateSearchOptions(options);
  if (Option.isSome(validationError)) {
    return yield* new CliError({ message: validationError.value });
  }

  const auth = yield* loadAuth();
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const fetchPage = Effect.fnUntraced(function* (page: number) {
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
      HttpClientRequest.bearerToken(auth.bearerToken),
      HttpClientRequest.setHeader("x-upwork-api-tenantid", auth.tenantId),
      HttpClientRequest.setHeader("referer", "https://www.upwork.com/"),
      HttpClientRequest.bodyJsonUnsafe({
        query: USER_JOB_SEARCH_QUERY,
        variables: { requestVariables },
      }),
      client.execute,
      Effect.flatMap(HttpClientResponse.schemaBodyJson(SearchResponse)),
      Effect.mapError(requestError("Upwork search failed")),
    );

    const search = response.data.search.universalSearchNuxt.userJobSearchV1;
    const jobs = search.results.map((result) => {
      const job = result.jobTile.job;
      const clientInfo = result.upworkHistoryData.client;
      const hourlyBudget = Option.all({
        min: Option.fromNullishOr(job.hourlyBudgetMin),
        max: Option.fromNullishOr(job.hourlyBudgetMax),
      }).pipe(
        Option.map(({ min, max }) => ({ min, max, currency: "USD" })),
        Option.getOrNull,
      );
      return {
        id: result.id,
        ciphertext: job.ciphertext,
        url: `https://www.upwork.com/jobs/${job.ciphertext}`,
        title: result.title,
        description: result.description,
        skills: result.ontologySkills.map((skill) => ({ id: skill.uid, name: skill.prefLabel })),
        type: job.jobType,
        hourlyBudget,
        fixedPriceBudget: job.fixedPriceAmount,
        experienceLevel: job.contractorTier,
        publishedAt: job.publishTime,
        proposals: job.totalApplicants,
        applied: result.applied,
        client: {
          paymentVerified: clientInfo.paymentVerificationStatus === "VERIFIED",
          country: clientInfo.country,
          rating: clientInfo.totalFeedback,
          reviews: clientInfo.totalReviews,
          totalSpent: clientInfo.totalSpent,
        },
      };
    });
    return { paging: search.paging, jobs };
  });

  const first = yield* fetchPage(options.page);
  const postedAfter = options.postedAfter;
  if (Option.isNone(postedAfter)) {
    return {
      contentTrust: "untrusted",
      paging: first.paging,
      scannedPages: 1,
      jobs: first.jobs,
    };
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
    current = yield* fetchPage(options.page + scannedPages);
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
  };
});

const normalizeJobId = (input: string) => {
  const embedded = Option.fromNullishOr(input.match(/~[A-Za-z0-9]+/)?.[0]);
  if (Option.isSome(embedded)) return embedded;
  if (/^[A-Za-z0-9]+$/.test(input)) return Option.some(`~${input}`);
  return Option.none<string>();
};

export const getJob = Effect.fn("Upwork.getJob")(function* (input: string) {
  const normalizedId = normalizeJobId(input);
  if (Option.isNone(normalizedId)) {
    return yield* new CliError({ message: `Invalid Upwork job ID or URL: ${input}` });
  }
  const id = normalizedId.value;

  const auth = yield* loadAuth();
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const response = yield* HttpClientRequest.post(
    "https://www.upwork.com/api/graphql/v1?alias=gql-query-get-auth-job-details-v2",
  ).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bearerToken(auth.bearerToken),
    HttpClientRequest.setHeader("x-upwork-api-tenantid", auth.tenantId),
    HttpClientRequest.setHeader("referer", "https://www.upwork.com/"),
    HttpClientRequest.bodyJsonUnsafe({
      query: JOB_DETAILS_QUERY,
      variables: {
        id,
        isFreelancerOrAgency: true,
        isLoggedIn: true,
      },
    }),
    client.execute,
    Effect.flatMap(HttpClientResponse.schemaBodyJson(JobDetailsResponse)),
    Effect.mapError(requestError(`Could not load Upwork job ${id}`)),
  );

  const details = Option.fromNullishOr(response.data.jobAuthDetails);
  if (Option.isNone(details)) {
    return yield* new CliError({ message: `Upwork job ${id} was not found` });
  }

  return {
    contentTrust: "untrusted",
    id,
    url: `https://www.upwork.com/jobs/${id}`,
    details: details.value,
  };
});
