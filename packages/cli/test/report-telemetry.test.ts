import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";

import { ensureTasklessDirectory } from "../src/filesystem/directory";

// The report command's events, captured by mocking the module it imports, as
// feedback-command.test.ts does.
const capture = vi.fn();
vi.mock("../src/telemetry", () => ({
  getTelemetry: vi.fn(() =>
    Promise.resolve({ capture, shutdown: () => Promise.resolve() })
  ),
  isTelemetryEnabled: () => true,
  shutdownTelemetry: () => Promise.resolve(),
}));

const { reportCommand } = await import("../src/commands/report");

interface RunnableCommand {
  run: (context: {
    args: Record<string, unknown>;
    rawArgs: string[];
  }) => Promise<void>;
}

const DELETE_PATH = "/api/v1/reports/abc/secret-key";
const TITLE = "Call the API through the shared client";

describe("report telemetry", () => {
  let cwd: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "tskl-report-telemetry-"));
    await ensureTasklessDirectory(cwd, { onNotice: () => {} });
    for (const id of ["alpha", "beta", "gamma"]) {
      const directory = join(cwd, ".taskless", "rules", "sg", id);
      await mkdir(join(directory, "tests", "pass", "clean"), {
        recursive: true,
      });
      await mkdir(join(directory, "tests", "fail", "fires"), {
        recursive: true,
      });
      await writeFile(
        join(directory, `${id}.yml`),
        stringify({
          id,
          language: "TypeScript",
          severity: "error",
          message: `no ${id}`,
          rule: { pattern: `${id}($$$)` },
        })
      );
      await writeFile(
        join(directory, "tests", "pass", "clean", "clean.ts"),
        "const a = 1;\n"
      );
      await writeFile(
        join(directory, "tests", "fail", "fires", "fires.ts"),
        `${id}(x);\n`
      );
    }
    server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.writeHead(request.method === "POST" ? 201 : 204, {
          "content-type": "application/json",
        });
        response.end(
          request.method === "POST"
            ? JSON.stringify({
                url: `${base}/r/abc`,
                deleteUrl: `${base}${DELETE_PATH}`,
                expiresAt: "2026-11-12T00:00:00Z",
              })
            : ""
        );
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    vi.stubEnv("TASKLESS_REPORT_URL", `${base}/api/v1/reports`);
    capture.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = undefined;
    await new Promise((resolve) => server.close(resolve));
    await rm(cwd, { recursive: true, force: true });
  });

  it("carries counts, never the link, the delete URL, a title or a fixture", async () => {
    const factsPath = join(cwd, ".taskless", ".tmp-report.json");
    await writeFile(
      factsPath,
      JSON.stringify({
        window: { from: "2026-07-14", to: "2026-10-11" },
        history: {
          mergedPrs: 1,
          reviewComments: 1,
          agentAssistedPrs: 0,
          patterns: { ruleShaped: 3, judgment: 0 },
        },
        rules: ["alpha", "beta", "gamma"].map((id) => ({
          id,
          title: TITLE,
          explain: "Holding it keeps review on design instead of style.",
          surfaced: { prs: 1, reviewComments: 1 },
        })),
      }),
      "utf8"
    );

    await (reportCommand as RunnableCommand).run({
      args: { dir: cwd, from: factsPath, json: false },
      rawArgs: [],
    });

    const published = capture.mock.calls.find(
      ([event]) => event === "cli_report_published"
    );
    expect(published?.[1]).toMatchObject({ cli: 3, legacy: 0, cloud: 0 });

    const everything = JSON.stringify(capture.mock.calls);
    expect(everything).not.toContain("/r/abc");
    expect(everything).not.toContain(DELETE_PATH);
    expect(everything).not.toContain(TITLE);
    expect(everything).not.toContain("alpha(x)");
  });
});
