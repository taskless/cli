import { describe, expect, it } from "vitest";

import {
  detectCliInvocation,
  detectLauncher,
  getCliPrefix,
  processLauncherContext,
  type Launcher,
  type LauncherContext,
} from "../src/util/package-manager";

/**
 * These tests replace a suite that asserted `npm_config_user_agent` alone
 * decided the launcher. That premise is the bug: `pnpm run`, `pnpm exec`,
 * `pnpm dlx`, and every pnpm lifecycle script set the same `pnpm/…` agent, so
 * the old suite passed while the CLI told developers running a `package.json`
 * script to `pnpm dlx` a package they already had installed.
 *
 * Detection is pure over an injected context, so every launcher below is a
 * table row rather than a spawned process and a mutated `process.env`.
 */

const PNPM_AGENT = "pnpm/9.1.0 node/v22.0.0";
const NPM_AGENT = "npm/10.0.0 node/v22.0.0";

function context(
  argv1: string,
  env: Record<string, string | undefined> = {}
): LauncherContext {
  return { env, argv: ["/usr/local/bin/node", argv1] };
}

describe("detectLauncher", () => {
  const cases: Array<[string, LauncherContext, Launcher | undefined]> = [
    [
      "npx, by its cache path",
      context("/Users/dev/.npm/_npx/a1b2c3/node_modules/.bin/taskless", {
        npm_config_user_agent: NPM_AGENT,
      }),
      "npx",
    ],
    [
      "npx, by the environment it sets for the script it runs",
      context("/somewhere/opaque/taskless", {
        npm_command: "exec",
        npm_lifecycle_event: "npx",
      }),
      "npx",
    ],
    [
      "pnpm dlx, by agent and cache path together",
      context(
        "/Users/dev/Library/Caches/pnpm/dlx/9f8e7d/node_modules/.bin/taskless",
        { npm_config_user_agent: PNPM_AGENT }
      ),
      "pnpm-dlx",
    ],
    [
      // The regression this change exists to fix. `pnpm cli` in this very repo
      // is exactly this shape.
      "pnpm run is NOT pnpm dlx",
      context("/repo/node_modules/.bin/taskless", {
        npm_config_user_agent: PNPM_AGENT,
        npm_command: "run-script",
        npm_lifecycle_event: "cli",
        PNPM_SCRIPT_SRC_DIR: "/repo",
      }),
      undefined,
    ],
    [
      "pnpm exec is NOT pnpm dlx",
      context("/repo/node_modules/.bin/taskless", {
        npm_config_user_agent: PNPM_AGENT,
      }),
      undefined,
    ],
    [
      "a dlx path without the pnpm agent is not enough",
      context("/repo/dlx/node_modules/.bin/taskless"),
      undefined,
    ],
    [
      "a node_modules/.bin shim under npm says nothing",
      context("/repo/node_modules/.bin/taskless", {
        npm_config_user_agent: NPM_AGENT,
      }),
      undefined,
    ],
    [
      "a bare node launch",
      context("/repo/packages/cli/dist/index.js"),
      undefined,
    ],
    ["an empty argv", { env: {}, argv: [] }, undefined],
    [
      // Yarn and bun are deliberately not detected: the user agent is the only
      // thing that distinguishes them, and the pnpm case is the proof that the
      // user agent is not evidence of how anyone invoked anything.
      "yarn is not detected",
      context("/repo/node_modules/.bin/taskless", {
        npm_config_user_agent: "yarn/4.1.0 node/v22.0.0",
      }),
      undefined,
    ],
    [
      "bun is not detected",
      context("/repo/node_modules/.bin/taskless", {
        npm_config_user_agent: "bun/1.0.0 node/v22.0.0",
      }),
      undefined,
    ],
  ];

  it.each(cases)("%s", (_name, given, expected) => {
    expect(detectLauncher(given)).toBe(expected);
  });

  it("reads Windows separators too", () => {
    expect(
      detectLauncher({
        env: {},
        argv: [
          String.raw`C:\node.exe`,
          String.raw`C:\Users\dev\AppData\npm-cache\_npx\a1b2\node_modules\.bin\taskless`,
        ],
      })
    ).toBe("npx");
  });
});

describe("detectCliInvocation", () => {
  // The test suite runs against a prod build, so the specifier is the released
  // package pinned to @latest.
  it("composes the launcher with the pinned package specifier", () => {
    expect(
      detectCliInvocation(
        context("/Users/dev/.npm/_npx/a1b2c3/node_modules/.bin/taskless")
      )
    ).toBe("npx @taskless/cli@latest");
    expect(
      detectCliInvocation(
        context("/Users/dev/Library/Caches/pnpm/dlx/9f8/node_modules/.bin/x", {
          npm_config_user_agent: PNPM_AGENT,
        })
      )
    ).toBe("pnpm dlx @taskless/cli@latest");
  });

  it("is undefined when the launcher is unknown", () => {
    // The renderer turns this into its agent-fill marker rather than naming a
    // launcher the reader may not have.
    expect(detectCliInvocation(context("/repo/dist/index.js"))).toBeUndefined();
  });
});

describe("getCliPrefix", () => {
  it("prints npx when detection is unknown, because a human needs something runnable", () => {
    // Whatever launcher the test runner used, the printed command must resolve.
    expect(getCliPrefix()).toMatch(/^(?:npx|pnpm dlx) @taskless\/cli@latest$/);
  });

  it("never suggests pnpm dlx from a pnpm script", () => {
    // getCliPrefix reads the real process, so assert the underlying decision
    // over the context a pnpm script actually presents.
    const pnpmScript = context("/repo/node_modules/.bin/taskless", {
      npm_config_user_agent: PNPM_AGENT,
      npm_command: "run-script",
    });
    expect(detectCliInvocation(pnpmScript)).toBeUndefined();
  });

  it("reads argv and env from the live process", () => {
    const live = processLauncherContext();
    expect(live.argv).toBe(process.argv);
    expect(live.env).toBe(process.env);
  });
});
