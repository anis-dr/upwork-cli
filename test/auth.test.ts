import { expect, it } from "@effect/vitest";
import { chromeLaunchSpecs } from "../src/auth.ts";

it("builds Chrome launch commands for macOS, Windows, and Linux", () => {
  const specs = chromeLaunchSpecs(9333, "/home/user/.upwork-cli-chrome", "https://upwork.test");

  expect({
    executables: specs.map((spec) => spec.executable),
    allHavePort: specs.every((spec) => spec.args.includes("--remote-debugging-port=9333")),
    allHaveProfile: specs.every((spec) =>
      spec.args.includes("--user-data-dir=/home/user/.upwork-cli-chrome"),
    ),
    allHaveUrl: specs.every((spec) => spec.args.includes("https://upwork.test")),
  }).toEqual({
    executables: [
      "open",
      "cmd.exe",
      "google-chrome",
      "google-chrome-stable",
      "chromium",
      "chromium-browser",
    ],
    allHavePort: true,
    allHaveProfile: true,
    allHaveUrl: true,
  });
});
