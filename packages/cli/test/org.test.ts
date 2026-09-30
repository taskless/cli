import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWhoami } from "../src/auth/whoami";
import {
  resolveActingOrg,
  selectOrgForOwners,
  type WhoamiOrg,
} from "../src/auth/org";

vi.mock("../src/auth/whoami", () => ({ fetchWhoami: vi.fn() }));

const execFileAsync = promisify(execFile);
const mockedFetchWhoami = vi.mocked(fetchWhoami);

// Minimal unsigned JWT (header: {"alg":"none","typ":"JWT"}) for the claim fallback.
const JWT_HEADER = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0";
const makeJwt = (payload: Record<string, unknown>): string =>
  `${JWT_HEADER}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.`;

const whoamiWith = (orgs: WhoamiOrg[]) =>
  ({ user: "Ada", orgs }) as Awaited<ReturnType<typeof fetchWhoami>>;

// fetchWhoami resolves to undefined when the call fails; name it so the
// unavailable case reads clearly and doesn't trip no-useless-undefined.
const WHOAMI_UNAVAILABLE = undefined as Awaited<ReturnType<typeof fetchWhoami>>;

// `source` is cast because the generated schema pins it to the literal
// "github"; the source-filter test deliberately injects another provider.
const org = (id: string, url: string, source = "github"): WhoamiOrg =>
  ({
    githubOrgId: 1,
    id,
    name: url.split("/").pop() ?? "",
    source,
    url,
  }) as WhoamiOrg;

const entitled = (restoreRules: boolean): WhoamiOrg => ({
  ...org("uuid-acme", "https://github.com/acme"),
  entitlements: {
    remoteGeneration: true,
    runtimeSignatures: true,
    restoreRules,
  },
});

describe("selectOrgForOwners", () => {
  const orgs = [
    org("uuid-acme", "https://github.com/acme"),
    org("uuid-me", "https://github.com/me"),
  ];

  it("returns the first owner (origin precedence) that matches an org", () => {
    // origin=me, upstream=acme → me wins (it comes first in the owner list).
    expect(
      selectOrgForOwners(
        ["https://github.com/me", "https://github.com/acme"],
        orgs
      )?.id
    ).toBe("uuid-me");
  });

  it("falls through to a later remote when the first has no matching org", () => {
    expect(
      selectOrgForOwners(
        ["https://github.com/stranger", "https://github.com/acme"],
        orgs
      )?.id
    ).toBe("uuid-acme");
  });

  it("returns undefined when no owner matches", () => {
    expect(
      selectOrgForOwners(["https://github.com/stranger"], orgs)
    ).toBeUndefined();
  });

  it("ignores non-github-sourced orgs", () => {
    const gitlab = [org("uuid-x", "https://github.com/acme", "gitlab")];
    expect(
      selectOrgForOwners(["https://github.com/acme"], gitlab)
    ).toBeUndefined();
  });
});

describe("resolveActingOrg", () => {
  let directory: string;
  const token = makeJwt({ orgId: 4242 });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "tskl-subject-"));
    await execFileAsync("git", ["init"], { cwd: directory });
    await execFileAsync(
      "git",
      ["remote", "add", "origin", "git@github.com:acme/widgets.git"],
      { cwd: directory }
    );
    mockedFetchWhoami.mockReset();
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("prefers the matched org's UUID when a remote matches a whoami org", async () => {
    mockedFetchWhoami.mockResolvedValue(
      whoamiWith([org("uuid-acme", "https://github.com/acme")])
    );
    await expect(resolveActingOrg(directory, token)).resolves.toMatchObject({
      subject: "uuid-acme",
    });
  });

  it("falls back to the numeric claim when no whoami org matches the repo", async () => {
    mockedFetchWhoami.mockResolvedValue(
      whoamiWith([org("uuid-other", "https://github.com/other")])
    );
    await expect(resolveActingOrg(directory, token)).resolves.toMatchObject({
      subject: 4242,
    });
  });

  it("falls back to the numeric claim when whoami is unavailable", async () => {
    mockedFetchWhoami.mockResolvedValue(WHOAMI_UNAVAILABLE);
    await expect(resolveActingOrg(directory, token)).resolves.toMatchObject({
      subject: 4242,
    });
  });

  it("falls back to the nil-UUID when whoami is unavailable and the token has no org claim", async () => {
    mockedFetchWhoami.mockResolvedValue(WHOAMI_UNAVAILABLE);
    await expect(
      resolveActingOrg(directory, makeJwt({ sub: "u" }))
    ).resolves.toMatchObject({
      subject: "00000000-0000-0000-0000-000000000000",
    });
  });

  it.each([true, false])(
    "carries the matched org's restoreRules (%s) from the same whoami call",
    async (restoreRules) => {
      mockedFetchWhoami.mockResolvedValue(whoamiWith([entitled(restoreRules)]));
      expect(await resolveActingOrg(directory, token)).toEqual({
        subject: "uuid-acme",
        restoreRules,
      });
      expect(mockedFetchWhoami).toHaveBeenCalledTimes(1);
    }
  );

  it("leaves restoreRules unknown when the matched org has no entitlements", async () => {
    mockedFetchWhoami.mockResolvedValue(
      whoamiWith([org("uuid-acme", "https://github.com/acme")])
    );
    expect(await resolveActingOrg(directory, token)).toEqual({
      subject: "uuid-acme",
    });
  });

  it("leaves restoreRules unknown when entitlements carries no boolean for it", async () => {
    mockedFetchWhoami.mockResolvedValue(
      whoamiWith([
        {
          ...org("uuid-acme", "https://github.com/acme"),
          entitlements: { remoteGeneration: true } as WhoamiOrg["entitlements"],
        },
      ])
    );
    expect(await resolveActingOrg(directory, token)).toEqual({
      subject: "uuid-acme",
    });
  });

  it("leaves restoreRules unknown when no org matches, even if another org has it", async () => {
    mockedFetchWhoami.mockResolvedValue(
      whoamiWith([
        { ...entitled(false), url: "https://github.com/other" } as WhoamiOrg,
      ])
    );
    expect(await resolveActingOrg(directory, token)).toEqual({
      subject: 4242,
    });
  });

  it("leaves restoreRules unknown when whoami is unavailable", async () => {
    mockedFetchWhoami.mockResolvedValue(WHOAMI_UNAVAILABLE);
    expect(await resolveActingOrg(directory, token)).toEqual({ subject: 4242 });
  });
});
