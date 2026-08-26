import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);

// Mock posthog-node before importing telemetry
const mockCapture = vi.fn();
const mockIdentify = vi.fn();
const mockGroupIdentify = vi.fn();
const mockShutdown = vi.fn<() => Promise<void>>();
mockShutdown.mockResolvedValue();

vi.mock("posthog-node", () => {
  return {
    PostHog: class {
      capture = mockCapture;
      identify = mockIdentify;
      groupIdentify = mockGroupIdentify;
      shutdown = mockShutdown;
    },
  };
});

/** Create a minimal JWT with arbitrary claims */
function makeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
    "base64url"
  );
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.`;
}

/** Write a fake auth token file to a temp project directory */
async function writeTokenFile(cwd: string, token: string): Promise<void> {
  const directory = join(cwd, ".taskless");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, ".env.local.json"),
    JSON.stringify({
      access_token: token,
      expires_at: Date.now() + 60_000,
    })
  );
}

let getTelemetry: (cwd?: string) => Promise<{
  capture: (event: string, properties?: Record<string, unknown>) => void;
  shutdown: () => Promise<void>;
}>;
let configDirectory: string;

beforeEach(async () => {
  // Reset module-level singleton between tests
  vi.resetModules();
  const telemetryModule = await import("../src/telemetry");
  getTelemetry = telemetryModule.getTelemetry;

  // Reset mocks
  mockCapture.mockClear();
  mockIdentify.mockClear();
  mockGroupIdentify.mockClear();
  mockShutdown.mockClear();

  // Create a temp XDG config directory
  configDirectory = await mkdtemp(join(tmpdir(), "taskless-telemetry-test-"));
  vi.stubEnv("XDG_CONFIG_HOME", configDirectory);

  // Ensure telemetry is enabled (empty string != "1", so checks pass)
  vi.stubEnv("TASKLESS_TELEMETRY_DISABLED", "");
  vi.stubEnv("DO_NOT_TRACK", "");
  vi.stubEnv("TASKLESS_TOKEN", "");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(configDirectory, { recursive: true, force: true });
});

describe("telemetry disabled", () => {
  it("returns no-op stub when TASKLESS_TELEMETRY_DISABLED=1", async () => {
    vi.stubEnv("TASKLESS_TELEMETRY_DISABLED", "1");
    const telemetry = await getTelemetry();

    telemetry.capture("cli_run");
    await telemetry.shutdown();

    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockIdentify).not.toHaveBeenCalled();
    expect(mockShutdown).not.toHaveBeenCalled();
  });

  it("returns no-op stub when DO_NOT_TRACK=1", async () => {
    vi.stubEnv("DO_NOT_TRACK", "1");
    const telemetry = await getTelemetry();

    telemetry.capture("cli_run");
    await telemetry.shutdown();

    expect(mockCapture).not.toHaveBeenCalled();
  });
});

describe("anonymous identity", () => {
  it("generates a UUID v4 on first call and persists it", async () => {
    await getTelemetry();

    const idPath = join(configDirectory, "taskless", "anonymous_id");
    const id = await readFile(idPath, "utf8");
    expect(id).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
    );
  });

  it("reads existing anonymous ID on subsequent calls", async () => {
    const existingId = "12345678-1234-4123-8123-123456789abc";
    const tasklessDirectory = join(configDirectory, "taskless");
    await mkdir(tasklessDirectory, { recursive: true });
    await writeFile(join(tasklessDirectory, "anonymous_id"), existingId);

    await getTelemetry();

    expect(mockIdentify).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: existingId,
        properties: expect.objectContaining({
          cli: existingId,
        }) as Record<string, unknown>,
      })
    );
  });

  it("creates the config directory if missing", async () => {
    // Point to a non-existent subdirectory
    const freshDirectory = join(configDirectory, "fresh-xdg");
    vi.stubEnv("XDG_CONFIG_HOME", freshDirectory);

    await getTelemetry();

    const idPath = join(freshDirectory, "taskless", "anonymous_id");
    const id = await readFile(idPath, "utf8");
    expect(id).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
    );
  });

  it("regenerates UUID when file contains invalid content", async () => {
    const tasklessDirectory = join(configDirectory, "taskless");
    await mkdir(tasklessDirectory, { recursive: true });
    await writeFile(join(tasklessDirectory, "anonymous_id"), "not-a-uuid");

    await getTelemetry();

    const id = await readFile(join(tasklessDirectory, "anonymous_id"), "utf8");
    expect(id).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
    );
    expect(id).not.toBe("not-a-uuid");
  });
});

describe("authenticated identity", () => {
  it("uses JWT sub as distinctId when JWT is available", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "taskless-auth-test-"));
    try {
      const jwt = makeJwt({ sub: "user-123", orgId: 42 });
      await writeTokenFile(cwd, jwt);

      const telemetry = await getTelemetry(cwd);
      telemetry.capture("cli_run");

      expect(mockIdentify).toHaveBeenCalledWith(
        expect.objectContaining({
          distinctId: "user-123",
        })
      );
      expect(mockCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          distinctId: "user-123",
          groups: { organization: "42" },
        })
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("calls groupIdentify with orgId when authenticated", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "taskless-auth-test-"));
    try {
      const jwt = makeJwt({ sub: "user-456", orgId: 99 });
      await writeTokenFile(cwd, jwt);

      await getTelemetry(cwd);

      expect(mockGroupIdentify).toHaveBeenCalledWith({
        groupType: "organization",
        groupKey: "99",
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("groups on the canonical `id` claim when present, not the legacy orgId", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "taskless-auth-test-"));
    try {
      const jwt = makeJwt({ sub: "user-789", id: "org-uuid", orgId: 99 });
      await writeTokenFile(cwd, jwt);

      await getTelemetry(cwd);

      expect(mockGroupIdentify).toHaveBeenCalledWith({
        groupType: "organization",
        groupKey: "org-uuid",
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("groups a logged-in user with no org on the nil-UUID", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "taskless-auth-test-"));
    try {
      const jwt = makeJwt({ sub: "user-000" });
      await writeTokenFile(cwd, jwt);

      await getTelemetry(cwd);

      expect(mockGroupIdentify).toHaveBeenCalledWith({
        groupType: "organization",
        groupKey: "00000000-0000-0000-0000-000000000000",
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("falls back to anonymous UUID when no JWT is available", async () => {
    const telemetry = await getTelemetry();
    telemetry.capture("cli_run");

    // distinctId should be the anonymous UUID, not a JWT sub
    const captureArgument = mockCapture.mock.calls[0]![0] as {
      distinctId: string;
    };
    expect(captureArgument.distinctId).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
    );
    expect(mockGroupIdentify).not.toHaveBeenCalled();
  });
});

describe("capture", () => {
  it("includes cli property on every event", async () => {
    const telemetry = await getTelemetry();
    telemetry.capture("cli_run");

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          cli: expect.stringMatching(
            /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
          ) as string,
        }) as Record<string, unknown>,
      })
    );
  });

  it("merges custom properties with standard properties", async () => {
    const telemetry = await getTelemetry();
    telemetry.capture("cli_run", { foo: "bar" });

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "cli_run",
        properties: expect.objectContaining({
          cli: expect.any(String) as string,
          foo: "bar",
        }) as Record<string, unknown>,
      })
    );
  });

  it("does not include groups when unauthenticated", async () => {
    const telemetry = await getTelemetry();
    telemetry.capture("cli_run");

    const captureArgument = mockCapture.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(captureArgument).not.toHaveProperty("groups");
  });

  it("includes cliVersion and scaffoldVersion on every anonymous capture", async () => {
    const telemetry = await getTelemetry();
    telemetry.capture("cli_run");

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          cliVersion: expect.any(String) as string,
          scaffoldVersion: expect.any(Number) as number,
        }) as Record<string, unknown>,
      })
    );
  });

  it("includes cliVersion and scaffoldVersion on authenticated capture", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "taskless-auth-props-"));
    try {
      // Seed a manifest with a known scaffold version
      const tasklessDirectory = join(cwd, ".taskless");
      await mkdir(tasklessDirectory, { recursive: true });
      await writeFile(
        join(tasklessDirectory, "taskless.json"),
        JSON.stringify({ version: 2, install: {} }),
        "utf8"
      );
      const jwt = makeJwt({ sub: "user-77", orgId: 123 });
      await writeTokenFile(cwd, jwt);

      const telemetry = await getTelemetry(cwd);
      telemetry.capture("cli_rule_created");

      expect(mockCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          groups: { organization: "123" },
          properties: expect.objectContaining({
            cliVersion: expect.any(String) as string,
            scaffoldVersion: 2,
          }) as Record<string, unknown>,
        })
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("falls back to scaffoldVersion: 0 when manifest is missing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "taskless-no-manifest-"));
    try {
      const telemetry = await getTelemetry(cwd);
      telemetry.capture("cli_run");

      expect(mockCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({
            scaffoldVersion: 0,
          }) as Record<string, unknown>,
        })
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("singleton", () => {
  it("returns the same instance on subsequent calls", async () => {
    const first = await getTelemetry();
    const second = await getTelemetry();
    expect(first).toBe(second);
  });
});

describe("shutdown", () => {
  it("calls posthog.shutdown()", async () => {
    const telemetry = await getTelemetry();
    await telemetry.shutdown();
    expect(mockShutdown).toHaveBeenCalledOnce();
  });
});

/** The `gh_owner` on the most recent call recorded by a posthog mock. */
function lastGhOwner(mock: { mock: { calls: unknown[][] } }): unknown {
  const call = mock.mock.calls.at(-1)?.[0] as {
    properties?: Record<string, unknown>;
  };
  return call.properties?.gh_owner;
}

/**
 * Which GitHub owner is using the CLI, including anonymously. The property is
 * resolved from the git remote rather than the token, so it is present on
 * unauthenticated runs — which is the population it exists to measure.
 */
describe("gh_owner", () => {
  it("carries the owner on an anonymous run in a GitHub repository", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "taskless-ghowner-"));
    try {
      // No token written: this is the anonymous case.
      await execFileAsync("git", ["init"], { cwd });
      await execFileAsync(
        "git",
        ["remote", "add", "origin", "git@github.com:acme/widgets.git"],
        { cwd }
      );

      const telemetry = await getTelemetry(cwd);
      telemetry.capture("cli_run");

      expect(lastGhOwner(mockIdentify)).toBe("acme");
      expect(lastGhOwner(mockCapture)).toBe("acme");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("carries the owner on an authenticated run", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "taskless-ghowner-auth-"));
    try {
      await writeTokenFile(cwd, makeJwt({ sub: "user-1", orgId: 7 }));
      await execFileAsync("git", ["init"], { cwd });
      await execFileAsync(
        "git",
        ["remote", "add", "origin", "https://github.com/globex/tools.git"],
        { cwd }
      );

      await getTelemetry(cwd);

      expect(lastGhOwner(mockIdentify)).toBe("globex");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("is [unknown], not omitted, when no owner resolves", async () => {
    // A temp directory is not a git repository. The property must still be
    // present: an omitted field makes these runs vanish from aggregates,
    // which is the opposite of what it is for.
    const cwd = await mkdtemp(join(tmpdir(), "taskless-ghowner-none-"));
    try {
      const telemetry = await getTelemetry(cwd);
      telemetry.capture("cli_run");

      const identifyCall = mockIdentify.mock.calls.at(-1)?.[0] as {
        properties: Record<string, unknown>;
      };
      expect(identifyCall.properties).toHaveProperty("gh_owner");
      expect(lastGhOwner(mockIdentify)).toBe("[unknown]");
      expect(lastGhOwner(mockCapture)).toBe("[unknown]");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("is [unknown] for a non-GitHub origin", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "taskless-ghowner-gitlab-"));
    try {
      await execFileAsync("git", ["init"], { cwd });
      await execFileAsync(
        "git",
        ["remote", "add", "origin", "https://gitlab.com/acme/widgets.git"],
        { cwd }
      );

      await getTelemetry(cwd);

      expect(lastGhOwner(mockIdentify)).toBe("[unknown]");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
