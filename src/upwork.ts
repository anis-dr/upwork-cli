import { Array as EffectArray, Effect, Option, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { type AuthenticatedSession, UpworkCliError, loadAuthenticatedSession } from "./auth.ts";

const JobDetailsResponse = Schema.Struct({
  data: Schema.Struct({
    jobAuthDetails: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  }),
});

const JobConnectsResponse = Schema.Struct({
  data: Schema.Record(
    Schema.String,
    Schema.NullOr(
      Schema.Struct({
        price: Schema.Int,
      }),
    ),
  ),
});

const JobDetailsOpening = Schema.Struct({
  opening: Schema.Struct({
    job: Schema.Struct({
      info: Schema.Struct({
        id: Schema.String,
      }),
    }),
  }),
});

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

const CONNECTS_SUBORDINATE_CLIENT_ID = "bf67b73f06270a0cc87c5957bf1963fb";
const CONNECTS_BATCH_SIZE = 9;

const toUpworkRequestError = (message: string) => (cause: unknown) =>
  new UpworkCliError({ message, cause });

const loadConnectsToken = Effect.fnUntraced(function* (session: AuthenticatedSession) {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const script = yield* HttpClientRequest.get(
    `https://auth.upwork.com/api/v3/oauth2/token/subordinate/v3/${CONNECTS_SUBORDINATE_CLIENT_ID}`,
  ).pipe(
    HttpClientRequest.setHeader("cookie", session.cookieHeader),
    HttpClientRequest.setHeader("referer", "https://www.upwork.com/"),
    client.execute,
    Effect.flatMap((response) => response.text),
    Effect.mapError(toUpworkRequestError("Could not load Upwork Connects authentication")),
  );
  const token = Option.fromNullishOr(script.match(/"token":"([^"]+)"/)).pipe(
    Option.flatMap((match) => EffectArray.get(match, 1)),
  );
  if (Option.isNone(token)) {
    return yield* new UpworkCliError({
      message: "Upwork Connects authentication returned an unsupported response",
    });
  }
  return token.value;
});

const fetchRequiredConnects = Effect.fnUntraced(function* (
  session: AuthenticatedSession,
  jobIds: ReadonlyArray<string>,
) {
  if (jobIds.length === 0) return {} satisfies Record<string, number>;
  const token = yield* loadConnectsToken(session);
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const batches: Array<ReadonlyArray<string>> = [];
  for (let index = 0; index < jobIds.length; index += CONNECTS_BATCH_SIZE) {
    batches.push(jobIds.slice(index, index + CONNECTS_BATCH_SIZE));
  }
  const batchResults = yield* Effect.forEach(
    batches,
    Effect.fnUntraced(function* (batch) {
      const variables = Object.fromEntries(batch.map((jobId, index) => [`job${index}`, jobId]));
      const variableDefinitions = batch.map((_, index) => `$job${index}: ID!`).join(", ");
      const fields = batch
        .map((_, index) => `job${index}: jobConnectsPriceFreelancer(jobId: $job${index}) { price }`)
        .join("\n");
      const response = yield* HttpClientRequest.post(
        "https://www.upwork.com/api/graphql/v1?alias=gql-query-get-connects-data",
      ).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(token),
        HttpClientRequest.setHeader("cookie", session.cookieHeader),
        HttpClientRequest.setHeader("x-upwork-api-tenantid", session.tenantId),
        HttpClientRequest.setHeader("referer", "https://www.upwork.com/"),
        HttpClientRequest.bodyJsonUnsafe({
          query: `query RequiredConnects(${variableDefinitions}) {\n${fields}\n}`,
          variables,
        }),
        client.execute,
        Effect.flatMap(HttpClientResponse.schemaBodyJson(JobConnectsResponse)),
        Effect.mapError(toUpworkRequestError("Could not load required Upwork Connects")),
      );
      return batch.map((jobId, index) => ({
        jobId,
        requiredConnects: Option.fromNullishOr(response.data[`job${index}`]).pipe(
          Option.map(({ price }) => price),
        ),
      }));
    }),
    { concurrency: 3 },
  );
  const requiredConnects: Record<string, number> = {};
  for (const batch of batchResults) {
    for (const result of batch) {
      if (Option.isSome(result.requiredConnects)) {
        requiredConnects[result.jobId] = result.requiredConnects.value;
      }
    }
  }
  return requiredConnects;
});

export const getRequiredConnects = Effect.fn("Upwork.getRequiredConnects")(function* (
  jobIds: ReadonlyArray<string>,
) {
  const session = yield* loadAuthenticatedSession();
  return yield* fetchRequiredConnects(session, jobIds);
});

const parseJobReference = (input: string) =>
  Option.fromNullishOr(input.match(/~[A-Za-z0-9]+/)?.[0]);

export const getJobDetails = Effect.fn("Upwork.getJobDetails")(function* (input: string) {
  const parsedReference = parseJobReference(input);
  if (Option.isNone(parsedReference)) {
    return yield* new UpworkCliError({
      message: `Invalid Upwork job reference or URL: ${input}`,
    });
  }
  const jobReference = parsedReference.value;

  const session = yield* loadAuthenticatedSession();
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const response = yield* HttpClientRequest.post(
    "https://www.upwork.com/api/graphql/v1?alias=gql-query-get-auth-job-details-v2",
  ).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bearerToken(session.bearerToken),
    HttpClientRequest.setHeader("x-upwork-api-tenantid", session.tenantId),
    HttpClientRequest.setHeader("referer", "https://www.upwork.com/"),
    HttpClientRequest.bodyJsonUnsafe({
      query: JOB_DETAILS_QUERY,
      variables: {
        id: jobReference,
        isFreelancerOrAgency: true,
        isLoggedIn: true,
      },
    }),
    client.execute,
    Effect.flatMap(HttpClientResponse.schemaBodyJson(JobDetailsResponse)),
    Effect.mapError(toUpworkRequestError(`Could not load Upwork job ${jobReference}`)),
  );

  const details = Option.fromNullishOr(response.data.jobAuthDetails);
  if (Option.isNone(details)) {
    return yield* new UpworkCliError({
      message: `Upwork job ${jobReference} was not found`,
    });
  }

  const opening = yield* Schema.decodeUnknownEffect(JobDetailsOpening)(details.value).pipe(
    Effect.mapError(toUpworkRequestError(`Upwork job ${jobReference} has no opening identifier`)),
  );
  const requiredConnects = yield* fetchRequiredConnects(session, [opening.opening.job.info.id]);

  return {
    contentTrust: "untrusted",
    jobReference,
    url: `https://www.upwork.com/jobs/${jobReference}`,
    requiredConnects: Option.fromNullishOr(requiredConnects[opening.opening.job.info.id]).pipe(
      Option.getOrNull,
    ),
    details: details.value,
  };
});
