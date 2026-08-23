import { Config, Effect, FileSystem, Option, Path, Schema } from "effect";
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

export const authStatePath = Effect.fn("Auth.statePath")(function* () {
  const home = yield* Config.string("HOME").pipe(
    Effect.mapError((cause) => new CliError({ message: "HOME is not configured", cause })),
  );
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
          message: `No Upwork auth state at ${path}. Run: upwork auth capture --cdp 9222`,
          cause,
        }),
    ),
  );
  const state = yield* decodeBrowserState(contents).pipe(
    Effect.mapError(
      (cause) => new CliError({ message: `Invalid browser state at ${path}`, cause }),
    ),
  );
  const bearerToken = Option.fromNullishOr(
    state.cookies.find((cookie) => cookie.name === "80a415d2sb")?.value,
  );
  const tenantId = Option.fromNullishOr(
    state.cookies.find((cookie) => cookie.name === "current_organization_uid")?.value,
  );

  if (Option.isNone(bearerToken) || Option.isNone(tenantId)) {
    return yield* new CliError({
      message: "The captured browser state is not an authenticated Upwork session",
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
