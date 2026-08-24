import { Config, Console, Effect, FileSystem, Option, Path, Schedule, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const BrowserCookie = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
  domain: Schema.String,
  path: Schema.String,
});

const BrowserState = Schema.Struct({
  cookies: Schema.Array(BrowserCookie),
});

const AuthValidationResponse = Schema.Struct({
  data: Schema.Struct({
    search: Schema.Struct({
      universalSearchNuxt: Schema.Struct({
        userJobSearchV1: Schema.Struct({
          paging: Schema.Struct({
            total: Schema.Int,
          }),
        }),
      }),
    }),
  }),
});

const AUTH_VALIDATION_QUERY = `
query AuthValidation($requestVariables: UserJobSearchV1Request!) {
  search {
    universalSearchNuxt {
      userJobSearchV1(request: $requestVariables) {
        paging { total }
      }
    }
  }
}`;

const isJwtLike = (value: string) => {
  const segments = value.split(".");
  return (
    segments.length === 3 &&
    segments.every((segment) => segment.length > 0 && /^[A-Za-z0-9_-]+$/.test(segment))
  );
};

const bearerCandidatePriority = (cookie: typeof BrowserCookie.Type) => {
  if (cookie.name === "oauth2_global_js_token") return 0;
  if (/^[a-f0-9]+sb$/i.test(cookie.name)) return 1;
  if (/token/i.test(cookie.name)) return 2;
  return 3;
};

const validateBearerToken = Effect.fnUntraced(function* (bearerToken: string, tenantId: string) {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  yield* HttpClientRequest.post("https://www.upwork.com/api/graphql/v1?alias=userJobSearch").pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bearerToken(bearerToken),
    HttpClientRequest.setHeader("x-upwork-api-tenantid", tenantId),
    HttpClientRequest.setHeader("referer", "https://www.upwork.com/"),
    HttpClientRequest.bodyJsonUnsafe({
      query: AUTH_VALIDATION_QUERY,
      variables: {
        requestVariables: {
          userQuery: "TypeScript",
          sort: "recency+desc",
          highlight: false,
          paging: {
            offset: 0,
            count: 1,
          },
        },
      },
    }),
    client.execute,
    Effect.flatMap(HttpClientResponse.schemaBodyJson(AuthValidationResponse)),
  );
  return bearerToken;
});

const decodeBrowserState = Schema.decodeUnknownEffect(Schema.fromJsonString(BrowserState));

export class CliError extends Schema.TaggedError<CliError>()("CliError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface AuthState {
  readonly bearerToken: string;
  readonly tenantId: string;
  readonly cookieHeader: string;
  readonly cookieCount: number;
  readonly path: string;
}

const userHome = Config.string("HOME").pipe(
  Config.orElse(() => Config.string("USERPROFILE")),
  Effect.mapError(
    (cause) => new CliError({ message: "User home directory is not configured", cause }),
  ),
);

export interface ChromeLaunchSpec {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
}

export const chromeLaunchSpecs = (
  cdpPort: number,
  profilePath: string,
  url: string,
): readonly [ChromeLaunchSpec, ...ReadonlyArray<ChromeLaunchSpec>] => {
  const chromeArgs = [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profilePath}`, url];
  return [
    {
      executable: "open",
      args: ["-na", "Google Chrome", "--args", ...chromeArgs],
    },
    {
      executable: "cmd.exe",
      args: ["/d", "/s", "/c", "start", "", "chrome", ...chromeArgs],
    },
    { executable: "google-chrome", args: chromeArgs },
    { executable: "google-chrome-stable", args: chromeArgs },
    { executable: "chromium", args: chromeArgs },
    { executable: "chromium-browser", args: chromeArgs },
  ];
};

export const authStatePath = Effect.fn("Auth.statePath")(function* () {
  const home = yield* userHome;
  return yield* Config.string("UPWORK_CLI_STATE").pipe(
    Config.withDefault(`${home}/.config/upwork-cli/state.json`),
  );
});

export const loadAuth = Effect.fn("Auth.load")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* authStatePath();
  const contents = yield* fileSystem.readFileString(path).pipe(
    Effect.mapError(
      (cause) =>
        new CliError({
          message: `No Upwork auth state at ${path}. Run: upwork auth login`,
          cause,
        }),
    ),
  );
  const state = yield* decodeBrowserState(contents).pipe(
    Effect.mapError(
      (cause) => new CliError({ message: `Invalid browser state at ${path}`, cause }),
    ),
  );
  const tenantId = Option.fromNullishOr(
    state.cookies.find((cookie) => cookie.name === "current_organization_uid")?.value,
  );
  if (Option.isNone(tenantId)) {
    return yield* new CliError({
      message: "The captured browser state has no Upwork organization",
    });
  }

  const seenCandidates = new Set<string>();
  const candidates: Array<string> = [];
  const cookiesByPriority = [...state.cookies].sort(
    (left, right) => bearerCandidatePriority(left) - bearerCandidatePriority(right),
  );
  for (const cookie of cookiesByPriority) {
    if (!cookie.domain.endsWith("upwork.com")) continue;
    if (bearerCandidatePriority(cookie) === 3 && !isJwtLike(cookie.value)) continue;
    if (seenCandidates.has(cookie.value)) continue;
    seenCandidates.add(cookie.value);
    candidates.push(cookie.value);
  }
  let bearerToken = Option.none<string>();
  for (const candidate of candidates) {
    const validated = yield* validateBearerToken(candidate, tenantId.value).pipe(Effect.option);
    if (Option.isSome(validated)) {
      bearerToken = validated;
      break;
    }
  }
  if (Option.isNone(bearerToken)) {
    return yield* new CliError({
      message: "The captured browser state has no valid Upwork session",
    });
  }

  const cookieHeader = state.cookies
    .filter((cookie) => cookie.domain.endsWith("upwork.com"))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");

  return {
    bearerToken: bearerToken.value,
    tenantId: tenantId.value,
    cookieHeader,
    cookieCount: state.cookies.length,
    path,
  } satisfies AuthState;
});

export const captureAuth = Effect.fn("Auth.capture")(function* (cdpPort: number) {
  const fileSystem = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const path = yield* authStatePath();

  yield* fileSystem
    .makeDirectory(pathService.dirname(path), { recursive: true })
    .pipe(
      Effect.mapError(
        (cause) => new CliError({ message: `Cannot create ${pathService.dirname(path)}`, cause }),
      ),
    );

  yield* spawner
    .string(
      ChildProcess.make("agent-browser", [
        "--session",
        "upwork-cli-auth",
        "--cdp",
        String(cdpPort),
        "state",
        "save",
        path,
      ]),
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new CliError({
            message: `Could not capture Chrome state from CDP port ${cdpPort}`,
            cause,
          }),
      ),
    );

  yield* fileSystem
    .chmod(path, 0o600)
    .pipe(Effect.mapError((cause) => new CliError({ message: `Cannot secure ${path}`, cause })));

  const auth = yield* loadAuth();
  return { path: auth.path, cookies: auth.cookieCount };
});

const UPWORK_LOGIN_URL = "https://www.upwork.com/nx/find-work/";

export const loginAuth = Effect.fn("Auth.login")(function* (
  cdpPort: number,
  timeoutMinutes: number,
) {
  if (timeoutMinutes < 1) {
    return yield* new CliError({ message: "Authentication timeout must be at least one minute" });
  }

  const existingAuth = yield* captureAuth(cdpPort).pipe(Effect.option);
  if (Option.isSome(existingAuth)) return existingAuth.value;

  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  yield* spawner.string(ChildProcess.make("agent-browser", ["--version"])).pipe(
    Effect.mapError(
      (cause) =>
        new CliError({
          message: "agent-browser is required for Upwork authentication",
          cause,
        }),
    ),
  );

  const home = yield* userHome;
  const specs = chromeLaunchSpecs(cdpPort, `${home}/.upwork-cli-chrome`, UPWORK_LOGIN_URL);
  const [first, ...rest] = specs;
  let launch = spawner.string(ChildProcess.make(first.executable, first.args));
  for (const spec of rest) {
    launch = launch.pipe(
      Effect.matchEffect({
        onFailure: () => spawner.string(ChildProcess.make(spec.executable, spec.args)),
        onSuccess: Effect.succeed,
      }),
    );
  }
  yield* launch.pipe(
    Effect.mapError(
      (cause) =>
        new CliError({
          message: "Could not find or launch Google Chrome",
          cause,
        }),
    ),
  );

  yield* Console.log("Chrome is ready. Log in to Upwork in the opened window.");
  yield* Console.log(`Waiting up to ${timeoutMinutes} minutes for authentication...`);

  return yield* captureAuth(cdpPort).pipe(
    Effect.retry({
      schedule: Schedule.spaced("2 seconds"),
      times: timeoutMinutes * 30,
    }),
    Effect.timeoutOrElse({
      duration: `${timeoutMinutes} minutes`,
      orElse: () =>
        Effect.fail(
          new CliError({
            message: "Timed out waiting for Upwork authentication",
          }),
        ),
    }),
  );
});
