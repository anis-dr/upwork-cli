import { expect, it } from "@effect/vitest";
import { Array, ConfigProvider, Context, Effect, FileSystem, Layer, Ref, Schema } from "effect";
import { HttpClient, HttpServerResponse } from "effect/unstable/http";
import { checkQualifications, getRequiredConnects } from "../src/upwork.ts";

const BodyJson = Schema.TaggedStruct("Uint8Array", {
  body: Schema.String,
});
const decodeBodyJson = Schema.decodeUnknownEffect(BodyJson);
const authState = `{"cookies":[{"name":"oauth2_global_js_token","value":"valid-opaque-token","domain":".upwork.com","path":"/"},{"name":"current_organization_uid","value":"tenant","domain":".upwork.com","path":"/"}]}`;

const GraphQlRequest = Schema.Struct({
  query: Schema.String,
  variables: Schema.Record(Schema.String, Schema.String),
});
const decodeGraphQlRequest = Schema.decodeUnknownEffect(Schema.fromJsonString(GraphQlRequest));
const QualificationRequest = Schema.Struct({
  query: Schema.String,
  variables: Schema.Struct({
    id: Schema.String,
  }),
});
const decodeQualificationRequest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(QualificationRequest),
);

const qualificationDetails = (matches: ReadonlyArray<{ readonly qualified: boolean }>) => ({
  currentUserInfo: {
    freelancerInfo: {
      qualificationsMatches: { matches },
    },
  },
});

const qualificationDetailsFor = (jobReference: string) => {
  if (jobReference === "~qualified") {
    return qualificationDetails([{ qualified: true }, { qualified: true }]);
  }
  if (jobReference === "~unqualified") {
    return qualificationDetails([{ qualified: true }, { qualified: false }]);
  }
  return {};
};

class ConnectsTestHarness extends Context.Service<
  ConnectsTestHarness,
  {
    readonly batchSizes: Effect.Effect<ReadonlyArray<number>>;
  }
>()("upwork-cli/test/ConnectsTestHarness") {}

const connectsLayer = Layer.unwrap(
  Effect.gen(function* () {
    const batchSizes = yield* Ref.make<ReadonlyArray<number>>([]);
    const client = HttpClient.make(
      Effect.fnUntraced(function* (request) {
        if (request.url.includes("/oauth2/token/subordinate/")) {
          const response = HttpServerResponse.text(
            '!function(){const clientConf={"token":"connects-token"}}();',
          );
          return HttpServerResponse.toClientResponse(response, { request });
        }
        const bodyJson = yield* decodeBodyJson(request.body.toJSON()).pipe(Effect.orDie);
        if (bodyJson.body.includes("AuthValidation")) {
          const response = yield* HttpServerResponse.json({
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
          return HttpServerResponse.toClientResponse(response, { request });
        }
        const body = yield* decodeGraphQlRequest(bodyJson.body).pipe(Effect.orDie);
        if (body.query.includes("JobQualificationMatches")) {
          const qualificationRequest = yield* decodeQualificationRequest(bodyJson.body).pipe(
            Effect.orDie,
          );
          const jobAuthDetails = qualificationDetailsFor(qualificationRequest.variables.id);
          const response = yield* HttpServerResponse.json({
            data: { jobAuthDetails },
          }).pipe(Effect.orDie);
          return HttpServerResponse.toClientResponse(response, { request });
        }
        yield* Ref.update(batchSizes, (sizes) => [...sizes, Object.keys(body.variables).length]);
        const data = Object.fromEntries(
          Object.entries(body.variables).map(([key, id]) => [key, { price: Number(id) }]),
        );
        const response = yield* HttpServerResponse.json({ data }).pipe(Effect.orDie);
        return HttpServerResponse.toClientResponse(response, { request });
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
      Layer.succeed(ConnectsTestHarness)(
        ConnectsTestHarness.of({ batchSizes: Ref.get(batchSizes) }),
      ),
    );
  }),
);

it.layer(connectsLayer)("required Connects", (it) => {
  it.effect("loads prices in API-safe batches", () =>
    Effect.gen(function* () {
      const harness = yield* ConnectsTestHarness;
      const jobIds = Array.range(1, 10).map(String);
      const result = yield* getRequiredConnects(jobIds);

      expect(result["1"]).toBe(1);
      expect(result["10"]).toBe(10);
      expect(yield* harness.batchSizes).toEqual([9, 1]);
    }),
  );
});

it.layer(connectsLayer)("preferred qualifications", (it) => {
  it.effect("checks each job independently and reports malformed responses", () =>
    Effect.gen(function* () {
      const result = yield* checkQualifications(["~qualified", "~unqualified", "~malformed"]);

      expect(result).toEqual([
        {
          jobReference: "~qualified",
          status: "ok",
          matches: [{ qualified: true }, { qualified: true }],
        },
        {
          jobReference: "~unqualified",
          status: "ok",
          matches: [{ qualified: true }, { qualified: false }],
        },
        {
          jobReference: "~malformed",
          status: "error",
          error: "Could not load Upwork qualifications for ~malformed",
        },
      ]);
    }),
  );
});
