import { expect, it } from "@effect/vitest";
import {
  Array,
  ConfigProvider,
  Context,
  DateTime,
  Effect,
  FileSystem,
  Layer,
  Option,
  Ref,
  Schema,
} from "effect";
import { HttpClient, HttpServerResponse } from "effect/unstable/http";
import { findJobsForQuery } from "../src/upwork.ts";

const CapturedRequest = Schema.Struct({
  query: Schema.String,
  variables: Schema.Struct({
    requestVariables: Schema.Struct({
      sort: Schema.String,
      paging: Schema.Struct({
        offset: Schema.Int,
        count: Schema.Int,
      }),
      verifiedPaymentOnly: Schema.optional(Schema.Boolean),
      proposals: Schema.optional(Schema.Array(Schema.String)),
      contractorTier: Schema.optional(Schema.Array(Schema.String)),
      jobType: Schema.optional(Schema.Array(Schema.String)),
      budget: Schema.optional(Schema.Array(Schema.String)),
      clientHires: Schema.optional(Schema.Array(Schema.String)),
      durationV3: Schema.optional(Schema.Array(Schema.String)),
      workload: Schema.optional(Schema.Array(Schema.String)),
      contractToHire: Schema.optional(Schema.Boolean),
    }),
  }),
});

const BodyJson = Schema.TaggedStruct("Uint8Array", {
  body: Schema.String,
});

const decodeBodyJson = Schema.decodeUnknownEffect(BodyJson);
const decodeCapturedRequest = Schema.decodeUnknownEffect(Schema.fromJsonString(CapturedRequest));

const authState = `{"cookies":[{"name":"oauth2_global_js_token","value":"valid-opaque-token","domain":".upwork.com","path":"/"},{"name":"current_organization_uid","value":"tenant","domain":".upwork.com","path":"/"}]}`;

class SearchTestHarness extends Context.Service<
  SearchTestHarness,
  {
    readonly requests: Effect.Effect<ReadonlyArray<typeof CapturedRequest.Type>>;
  }
>()("upwork-cli/test/SearchTestHarness") {}

const clientSpend = Option.some({ isoCurrencyCode: "USD", amount: "1000" });

const makeJob = (
  id: string,
  publishedAt: string,
  country: Option.Option<string>,
  totalSpent: Option.Option<{ isoCurrencyCode: string; amount: string }>,
  applied: Option.Option<boolean>,
  totalApplicants: Option.Option<number> = Option.some(4),
) => ({
  id,
  title: `Job ${id}`,
  description: `Description ${id}`,
  applied: Option.getOrNull(applied),
  ontologySkills: [{ uid: "skill-1", prefLabel: "TypeScript" }],
  upworkHistoryData: {
    client: {
      paymentVerificationStatus: "VERIFIED",
      country: Option.getOrNull(country),
      totalReviews: 10,
      totalFeedback: 5,
      totalSpent: Option.getOrNull(totalSpent),
    },
  },
  jobTile: {
    job: {
      ciphertext: `~${id}`,
      jobType: "HOURLY",
      hourlyBudgetMin: "50",
      hourlyBudgetMax: "100",
      contractorTier: "ExpertLevel",
      publishTime: publishedAt,
      totalApplicants: Option.getOrNull(totalApplicants),
      fixedPriceAmount: { isoCurrencyCode: "USD", amount: "1000" },
    },
  },
});

const makeResponse = <Job extends Schema.Json>(
  results: ReadonlyArray<Job>,
  offset: number,
  total: number,
) => ({
  data: {
    search: {
      universalSearchNuxt: {
        userJobSearchV1: {
          paging: { total, offset, count: results.length },
          results,
        },
      },
    },
  },
});

const searchTestLayer = <Response extends Schema.Json>(responses: ReadonlyArray<Response>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const captured = yield* Ref.make<ReadonlyArray<typeof CapturedRequest.Type>>([]);
      const responseIndex = yield* Ref.make(0);
      const client = HttpClient.make(
        Effect.fnUntraced(function* (request) {
          const bodyJson = yield* decodeBodyJson(request.body.toJSON()).pipe(Effect.orDie);
          const body = yield* decodeCapturedRequest(bodyJson.body).pipe(Effect.orDie);
          if (body.query.includes("AuthValidation")) {
            const validation = yield* HttpServerResponse.json({
              data: {
                search: {
                  universalSearchNuxt: {
                    userJobSearchV1: {
                      paging: { total: 1 },
                    },
                  },
                },
              },
            }).pipe(Effect.orDie);
            return HttpServerResponse.toClientResponse(validation, { request });
          }
          yield* Ref.update(captured, (requests) => [...requests, body]);

          const index = yield* Ref.getAndUpdate(responseIndex, (current) => current + 1);
          const response = yield* Array.get(responses, index).pipe(
            Effect.fromOption(() => "Missing fake response"),
            Effect.orDie,
          );
          const serverResponse = yield* HttpServerResponse.json(response).pipe(Effect.orDie);
          return HttpServerResponse.toClientResponse(serverResponse, { request });
        }),
      );

      return Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient)(client),
        FileSystem.layerNoop({
          readFileString: () => Effect.succeed(authState),
        }),
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            HOME: "/test",
            UPWORK_CLI_STATE: "/test/upwork-state.json",
          }),
        ),
        Layer.succeed(SearchTestHarness)(SearchTestHarness.of({ requests: Ref.get(captured) })),
      );
    }),
  );

const filterLayer = searchTestLayer([makeResponse([], 10, 0)]);

it.layer(filterLayer)("search request filters", (it) => {
  it.effect("encodes practical filters into the Upwork GraphQL request", () =>
    Effect.gen(function* () {
      const harness = yield* SearchTestHarness;
      yield* findJobsForQuery({
        query: "TypeScript",
        page: 2,
        limit: 10,
        sort: "relevance",
        verified: true,
        proposals: Option.some("0-4"),
        experience: Option.some("expert"),
        jobType: Option.some("fixed"),
        budget: Option.some("1000-4999"),
        clientHires: Option.some("10-plus"),
        duration: Option.some("over-6-months"),
        workload: Option.some("full-time"),
        contractToHire: true,
        postedAfter: Option.none(),
        maxPages: 10,
      });
      const requests = yield* harness.requests;
      const request = yield* Array.get(requests, 0).pipe(
        Effect.fromOption(() => "Missing captured request"),
      );

      expect(request.variables.requestVariables).toMatchObject({
        sort: "relevance+desc",
        paging: { offset: 10, count: 10 },
        verifiedPaymentOnly: true,
        proposals: ["0-4"],
        contractorTier: ["ExpertLevel"],
        jobType: ["fixed"],
        budget: ["1000-4999"],
        clientHires: ["10-"],
        durationV3: ["ongoing"],
        workload: ["full_time"],
        contractToHire: true,
      });
    }),
  );
});

const recencyLayer = searchTestLayer([
  makeResponse(
    [
      makeJob("1", "2026-08-23T00:00:00.000Z", Option.some("US"), clientSpend, Option.some(false)),
      makeJob("2", "2026-08-22T12:00:00.000Z", Option.some("US"), clientSpend, Option.some(false)),
    ],
    0,
    4,
  ),
  makeResponse(
    [
      makeJob("3", "2026-08-22T01:00:00.000Z", Option.some("US"), clientSpend, Option.some(false)),
      makeJob("4", "2026-08-21T23:59:59.000Z", Option.some("US"), clientSpend, Option.some(false)),
    ],
    2,
    4,
  ),
]);

it.layer(recencyLayer)("search recency pagination", (it) => {
  it.effect("stops after a job predates the cutoff", () =>
    Effect.gen(function* () {
      const harness = yield* SearchTestHarness;
      const cutoff = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-08-22T00:00:00.000Z"));
      const result = yield* findJobsForQuery({
        query: "TypeScript",
        page: 1,
        limit: 2,
        sort: "relevance",
        verified: false,
        proposals: Option.none(),
        experience: Option.none(),
        jobType: Option.none(),
        budget: Option.none(),
        clientHires: Option.none(),
        duration: Option.none(),
        workload: Option.none(),
        contractToHire: false,
        postedAfter: Option.some(cutoff),
        maxPages: 5,
      });
      const requests = yield* harness.requests;

      expect({
        jobIds: result.jobs.map((job) => job.id),
        scannedPages: result.scannedPages,
        offsets: requests.map((request) => request.variables.requestVariables.paging.offset),
        sorts: requests.map((request) => request.variables.requestVariables.sort),
      }).toEqual({
        jobIds: ["1", "2", "3"],
        scannedPages: 2,
        offsets: [0, 2],
        sorts: ["recency+desc", "recency+desc"],
      });
    }),
  );
});

const nullableCountryLayer = searchTestLayer([
  makeResponse(
    [
      makeJob(
        "nullable-country",
        "2026-08-23T00:00:00.000Z",
        Option.none(),
        clientSpend,
        Option.some(false),
      ),
    ],
    0,
    1,
  ),
]);

it.layer(nullableCountryLayer)("nullable search fields", (it) => {
  it.effect("accepts a client without a country", () =>
    Effect.gen(function* () {
      const result = yield* findJobsForQuery({
        query: "TypeScript",
        page: 1,
        limit: 1,
        sort: "relevance",
        verified: true,
        proposals: Option.none(),
        experience: Option.none(),
        jobType: Option.none(),
        budget: Option.none(),
        clientHires: Option.none(),
        duration: Option.none(),
        workload: Option.none(),
        contractToHire: false,
        postedAfter: Option.none(),
        maxPages: 1,
      });
      const job = yield* Array.get(result.jobs, 0).pipe(
        Effect.fromOption(() => "Missing nullable-country job"),
      );

      expect(Option.isNone(Option.fromNullishOr(job.client.country))).toBe(true);
    }),
  );
});

const nullableSpendLayer = searchTestLayer([
  makeResponse(
    [
      makeJob(
        "nullable-spend",
        "2026-08-23T00:00:00.000Z",
        Option.some("US"),
        Option.none(),
        Option.some(false),
      ),
    ],
    0,
    1,
  ),
]);

it.layer(nullableSpendLayer)("nullable client spend", (it) => {
  it.effect("accepts a client without recorded spend", () =>
    Effect.gen(function* () {
      const result = yield* findJobsForQuery({
        query: "TypeScript",
        page: 1,
        limit: 1,
        sort: "relevance",
        verified: true,
        proposals: Option.none(),
        experience: Option.none(),
        jobType: Option.none(),
        budget: Option.none(),
        clientHires: Option.none(),
        duration: Option.none(),
        workload: Option.none(),
        contractToHire: false,
        postedAfter: Option.none(),
        maxPages: 1,
      });
      const job = yield* Array.get(result.jobs, 0).pipe(
        Effect.fromOption(() => "Missing nullable-spend job"),
      );

      expect(Option.isNone(Option.fromNullishOr(job.client.totalSpent))).toBe(true);
    }),
  );
});

const nullableAppliedLayer = searchTestLayer([
  makeResponse(
    [
      makeJob(
        "nullable-applied",
        "2026-08-23T00:00:00.000Z",
        Option.some("US"),
        clientSpend,
        Option.none(),
      ),
    ],
    0,
    1,
  ),
]);

it.layer(nullableAppliedLayer)("nullable application state", (it) => {
  it.effect("accepts a job without application state", () =>
    Effect.gen(function* () {
      const result = yield* findJobsForQuery({
        query: "TypeScript",
        page: 1,
        limit: 1,
        sort: "relevance",
        verified: true,
        proposals: Option.none(),
        experience: Option.none(),
        jobType: Option.none(),
        budget: Option.none(),
        clientHires: Option.none(),
        duration: Option.none(),
        workload: Option.none(),
        contractToHire: false,
        postedAfter: Option.none(),
        maxPages: 1,
      });
      const job = yield* Array.get(result.jobs, 0).pipe(
        Effect.fromOption(() => "Missing nullable-applied job"),
      );

      expect(Option.isNone(Option.fromNullishOr(job.applied))).toBe(true);
    }),
  );
});

const nullableApplicantsLayer = searchTestLayer([
  makeResponse(
    [
      makeJob(
        "nullable-applicants",
        "2026-08-23T00:00:00.000Z",
        Option.some("US"),
        clientSpend,
        Option.some(false),
        Option.none(),
      ),
    ],
    0,
    1,
  ),
]);

it.layer(nullableApplicantsLayer)("nullable applicant count", (it) => {
  it.effect("accepts a job without an applicant count", () =>
    Effect.gen(function* () {
      const result = yield* findJobsForQuery({
        query: "Flutter",
        page: 1,
        limit: 1,
        sort: "relevance",
        verified: true,
        proposals: Option.none(),
        experience: Option.none(),
        jobType: Option.none(),
        budget: Option.none(),
        clientHires: Option.none(),
        duration: Option.none(),
        workload: Option.none(),
        contractToHire: false,
        postedAfter: Option.none(),
        maxPages: 1,
      });
      const job = yield* Array.get(result.jobs, 0).pipe(
        Effect.fromOption(() => "Missing nullable-applicants job"),
      );

      expect(Option.isNone(job.proposals)).toBe(true);
    }),
  );
});
