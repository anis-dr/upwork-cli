import { expect, it } from "@effect/vitest";
import { ConfigProvider, Context, Effect, FileSystem, Layer, Option, Ref } from "effect";
import { Headers, HttpClient, HttpServerResponse } from "effect/unstable/http";
import { loadAuthenticatedSession } from "../src/auth.ts";

class AuthTestHarness extends Context.Service<
  AuthTestHarness,
  {
    readonly authorizationHeaders: Effect.Effect<ReadonlyArray<string>>;
  }
>()("upwork-cli/test/AuthTestHarness") {}

const authState = `{"cookies":[{"name":"oauth2_global_js_token","value":"invalid-opaque-token","domain":".upwork.com","path":"/"},{"name":"a1b2c3sb","value":"valid-opaque-token","domain":".upwork.com","path":"/"},{"name":"current_organization_uid","value":"tenant","domain":".upwork.com","path":"/"}]}`;

const authLayer = Layer.unwrap(
  Effect.gen(function* () {
    const authorizationHeaders = yield* Ref.make<ReadonlyArray<string>>([]);
    const client = HttpClient.make(
      Effect.fnUntraced(function* (request) {
        const authorization = Headers.get(request.headers, "authorization").pipe(
          Option.getOrElse(() => ""),
        );
        yield* Ref.update(authorizationHeaders, (headers) => [...headers, authorization]);

        if (authorization === "Bearer valid-opaque-token") {
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

        return HttpServerResponse.toClientResponse(HttpServerResponse.empty({ status: 401 }), {
          request,
        });
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
      Layer.succeed(AuthTestHarness)(
        AuthTestHarness.of({ authorizationHeaders: Ref.get(authorizationHeaders) }),
      ),
    );
  }),
);

it.layer(authLayer)("authentication state", (it) => {
  it.effect("discovers and validates an opaque bearer cookie", () =>
    Effect.gen(function* () {
      const harness = yield* AuthTestHarness;
      const auth = yield* loadAuthenticatedSession();
      const authorizationHeaders = yield* harness.authorizationHeaders;

      expect({
        bearerToken: auth.bearerToken,
        authorizationHeaders,
      }).toEqual({
        bearerToken: "valid-opaque-token",
        authorizationHeaders: ["Bearer invalid-opaque-token", "Bearer valid-opaque-token"],
      });
    }),
  );
});
