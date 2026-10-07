import { describe, expect, test } from "bun:test";
import { speakable } from "../speakable";

describe("speakable", () => {
  test("leaves acronyms Kokoro already spells alone", () => {
    expect(speakable("The API and CLI, npm, jq and a PR over SSH.")).toBe("The API and CLI, npm, jq and a PR over SSH.");
  });

  test("says word-like acronyms as words", () => {
    expect(speakable("Update the README, CHANGELOG and JSON config")).toBe("Update the read me, change log and jay-son config");
    expect(speakable("YAML or TOML, src and k8s")).toBe("yammel or tommel, source and kubernetes");
  });

  test("reads file names with their extension", () => {
    expect(speakable("Edit voice.json and cli.sh, then auth.ts")).toBe("Edit voice dot jay-son and cli dot SH, then auth dot TS");
    expect(speakable("Open notes.xyz")).toBe("Open notes.xyz");
  });

  test("keeps the points in version numbers", () => {
    expect(speakable("Plugin 0.25.0 replaces v0.24.2.")).toBe("Plugin 0 point 25 point 0 replaces version 0 point 24 point 2.");
    expect(speakable("speed 1.2")).toBe("speed 1.2");
  });

  test("says units and multipliers after numbers", () => {
    expect(speakable("1.2x speed, waits 5s, took 150ms, every 30m, 1s, 40k tokens, 2GB")).toBe(
      "1.2 times speed, waits 5 seconds, took 150 milliseconds, every 30 minutes, 1 second, 40 thousand tokens, 2 gigabytes",
    );
    expect(speakable("2xx errors")).toBe("2xx errors");
  });

  test("expands e.g., i.e. and vs", () => {
    expect(speakable("Short terms, e.g. API, i.e. letters. Kokoro vs Piper")).toBe(
      "Short terms, for example API, that is letters. Kokoro versus Piper",
    );
  });

  test("splits identifiers into words", () => {
    expect(speakable("useActivityStore calls _ds_voice_speak")).toBe("use Activity Store calls ds voice speak");
    expect(speakable("SessionTimeline and GitHub")).toBe("Session Timeline and Git Hub");
    expect(speakable("macOS, iOS, API")).toBe("macOS, iOS, API");
  });

  test("is idempotent", () => {
    const once = speakable("README.md in 0.25.0 at 1.2x after 5s, e.g. useActivityStore with JSON");
    expect(speakable(once)).toBe(once);
  });
});
