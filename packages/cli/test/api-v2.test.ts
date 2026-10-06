import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchRule,
  getRequestStatus,
  iterateRule,
  listRevisions,
  reconcileRules,
  restoreRule,
  rollbackRule,
  submitRequest,
  whoami,
} from "../src/api/v2";
import { CLI_VERSION, CLI_VERSION_HEADER } from "../src/version";

const REPO = "https://github.com/acme/app";

const SERVED = {
  ruleId: "no-eval-3fa9c21b",
  revisionId: "rev-1",
  rules: [
    {
      id: "no-eval-3fa9c21b",
      engine: "sg",
      files: [{ path: "no-eval-3fa9c21b.yml", content: "id: x\n" }],
      signatures: [
        { path: "no-eval-3fa9c21b.yml", signature: "1;h=sha-256;d=00" },
      ],
    },
  ],
};

const REFUSAL = {
  restoreRules: false,
  reason: "RESTORE_RULES_NOT_IN_PLAN",
  message: "Restoring rules is not included in your Free plan.",
  upgradeUrl: "https://app.taskless.io/org/1/upgrade?from=restore",
};

let fetchMock: ReturnType<typeof vi.fn>;

function respond(status: number, body: unknown): void {
  fetchMock.mockResolvedValue(
    typeof body === "string"
      ? new Response(body, { status })
      : Response.json(body, { status })
  );
}

/** The single request the call made. */
function sent(): Request {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return fetchMock.mock.calls[0]?.[0] as Request;
}

describe("v2 client", () => {
  const originalUrl = process.env.TASKLESS_API_URL;

  beforeEach(() => {
    process.env.TASKLESS_API_URL = "https://example.invalid/cli";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.TASKLESS_API_URL;
    else process.env.TASKLESS_API_URL = originalUrl;
    vi.unstubAllGlobals();
  });

  describe("the wire", () => {
    it("sends every call under /cli/api/v2/ with the CLI version and the token", async () => {
      respond(200, { rules: [], unknown: [], entitlement: {} });
      await reconcileRules("tok", { repositoryUrl: REPO, rules: [] });

      const request = sent();
      expect(new URL(request.url).pathname).toBe("/cli/api/v2/reconcile");
      expect(request.headers.get(CLI_VERSION_HEADER)).toBe(CLI_VERSION);
      expect(request.headers.get("authorization")).toBe("Bearer tok");
    });

    it("puts the repository in the query for a GET, never the path", async () => {
      respond(200, SERVED);
      await fetchRule("tok", "no-eval-3fa9c21b", { repositoryUrl: REPO });

      const url = new URL(sent().url);
      expect(url.pathname).toBe("/cli/api/v2/rule/no-eval-3fa9c21b");
      expect(url.searchParams.get("repositoryUrl")).toBe(REPO);
      expect(url.searchParams.has("revision")).toBe(false);
    });

    it("addresses restore by rule id, with the repository in the body", async () => {
      respond(200, { ...SERVED, restoreRules: true });
      await restoreRule("tok", "no-eval-3fa9c21b", { repositoryUrl: REPO });

      const request = sent();
      expect(new URL(request.url).pathname).toBe(
        "/cli/api/v2/rule/no-eval-3fa9c21b/restore"
      );
      expect(await request.json()).toEqual({ repositoryUrl: REPO });
    });
  });

  describe("served rules", () => {
    it("returns a restored rule without its restoreRules marker", async () => {
      respond(200, { ...SERVED, restoreRules: true });
      const outcome = await restoreRule("tok", "no-eval-3fa9c21b", {
        repositoryUrl: REPO,
      });
      expect(outcome).toEqual({ status: "ok", data: SERVED });
    });

    it("returns a fetched head, which carries no marker at all", async () => {
      respond(200, SERVED);
      const outcome = await fetchRule("tok", "no-eval-3fa9c21b", {
        repositoryUrl: REPO,
      });
      expect(outcome).toEqual({ status: "ok", data: SERVED });
    });

    it.each([
      ["restore", () => restoreRule("tok", "r", { repositoryUrl: REPO })],
      [
        "rollback",
        () =>
          rollbackRule("tok", "r", { repositoryUrl: REPO, revisionId: "v" }),
      ],
      [
        "fetch",
        () => fetchRule("tok", "r", { repositoryUrl: REPO, revision: "v" }),
      ],
    ])(
      "reads a 200 refusal from %s as an answer, not a failure",
      async (_, call) => {
        respond(200, REFUSAL);
        const outcome = await call();
        expect(outcome).toEqual({
          status: "refused",
          refusal: {
            reason: REFUSAL.reason,
            message: REFUSAL.message,
            upgradeUrl: REFUSAL.upgradeUrl,
          },
        });
      }
    );

    it("never reads a body that is neither a rule nor a refusal as success", async () => {
      respond(200, { restoreRules: true });
      const outcome = await restoreRule("tok", "r", { repositoryUrl: REPO });
      expect(outcome.status).toBe("unavailable");
    });
  });

  describe("generation requests", () => {
    const REQUEST_ID = "6f1c2b9e-4d3a-4e8b-9c7f-0a1b2c3d4e5f";

    it.each([
      [
        "submit",
        () => submitRequest("tok", { repositoryUrl: REPO, prompt: "p" }),
      ],
      [
        "iterate",
        () => iterateRule("tok", "r", { repositoryUrl: REPO, guidance: "g" }),
      ],
    ])("accepts a UUID request id from %s", async (_, call) => {
      respond(200, { requestId: REQUEST_ID, status: "accepted" });
      expect(await call()).toEqual({
        status: "ok",
        data: { requestId: REQUEST_ID, status: "accepted" },
      });
    });

    // The id is printed inside a `--resume` command an agent is told to run,
    // so server text that is not a request id never gets that far.
    it.each([
      ["shell metacharacters", "x; rm -rf ~"],
      ["a substitution", "$(id)"],
      ["control characters", `${REQUEST_ID}\u001B[2J`],
      ["a non-string", 42],
      ["nothing", undefined],
    ])(
      "refuses a request id carrying %s as an invalid body",
      async (_, requestId) => {
        const calls = [
          () => submitRequest("tok", { repositoryUrl: REPO, prompt: "p" }),
          () => iterateRule("tok", "r", { repositoryUrl: REPO, guidance: "g" }),
        ];
        for (const call of calls) {
          respond(200, { requestId, status: "accepted" });
          expect(await call()).toEqual({
            status: "unavailable",
            reason: "invalid response body",
            retryable: false,
          });
        }
      }
    );
  });

  describe("revisions", () => {
    const LISTING = {
      ruleId: "no-eval-3fa9c21b",
      revisions: [
        {
          revisionId: "rev-2",
          createdAt: "2026-09-29T12:00:00.000Z",
          delivery: "cli",
          requestId: "req-2",
          current: true,
        },
      ],
      truncated: false,
    };

    it("lists by rule id, with the repository in the query", async () => {
      respond(200, LISTING);
      const outcome = await listRevisions("tok", "no-eval-3fa9c21b", {
        repositoryUrl: REPO,
        orgId: 42,
      });

      const url = new URL(sent().url);
      expect(url.pathname).toBe("/cli/api/v2/rule/no-eval-3fa9c21b/revisions");
      expect(url.searchParams.get("repositoryUrl")).toBe(REPO);
      expect(url.searchParams.get("orgId")).toBe("42");
      expect(outcome).toEqual({ status: "ok", data: LISTING });
    });

    it("maps rule_not_found, so a caller can report RULE_NOT_FOUND", async () => {
      respond(404, { error: "rule_not_found" });
      const outcome = await listRevisions("tok", "r", { repositoryUrl: REPO });
      expect(outcome).toMatchObject({
        status: "error",
        code: "rule_not_found",
      });
    });

    it("never reads a body that is not a listing as an empty history", async () => {
      respond(200, { ruleId: "r", revisions: [] });
      const outcome = await listRevisions("tok", "r", { repositoryUrl: REPO });
      expect(outcome).toEqual({
        status: "unavailable",
        reason: "the response was not a revision listing",
        retryable: false,
      });
    });
  });

  describe("errors", () => {
    it("maps a documented code to an error outcome, keeping details", async () => {
      respond(400, {
        error: "validation_error",
        details: ["prompt: required"],
      });
      const outcome = await submitRequest("tok", {
        repositoryUrl: REPO,
        prompt: "",
      });
      expect(outcome).toEqual({
        status: "error",
        code: "validation_error",
        httpStatus: 400,
        details: ["prompt: required"],
      });
    });

    it("strips control characters from server-authored details and codes", async () => {
      respond(400, {
        error: "validation_error",
        details: ["prompt: required\u001B[2J", 42],
      });
      expect(
        await submitRequest("tok", { repositoryUrl: REPO, prompt: "" })
      ).toMatchObject({ details: ["prompt: required[2J"] });

      respond(404, { error: "not_documented\u001B]0;title\u0007" });
      expect(
        await getRequestStatus("tok", "req-1", { repositoryUrl: REPO })
      ).toMatchObject({ reason: "HTTP 404 (not_documented]0;title)" });
    });

    it("maps rule_not_found on iterate, so a caller can report RULE_NOT_FOUND", async () => {
      respond(404, { error: "rule_not_found" });
      const outcome = await iterateRule("tok", "gone-00000000", {
        repositoryUrl: REPO,
        guidance: "tighten",
      });
      expect(outcome).toMatchObject({
        status: "error",
        code: "rule_not_found",
      });
    });

    it("maps revision_not_found on rollback", async () => {
      respond(404, { error: "revision_not_found" });
      const outcome = await rollbackRule("tok", "r", {
        repositoryUrl: REPO,
        revisionId: "other-rule-rev",
      });
      expect(outcome).toMatchObject({
        status: "error",
        code: "revision_not_found",
      });
    });

    it("gives 401 its own outcome", async () => {
      respond(401, { error: "unauthorized" });
      expect(await whoami("tok")).toEqual({ status: "unauthorized" });
    });

    it("reads a code the operation does not document as unavailable, naming it", async () => {
      respond(404, { error: "rule_not_found" });
      const outcome = await getRequestStatus("tok", "req-1", {
        repositoryUrl: REPO,
      });
      expect(outcome).toEqual({
        status: "unavailable",
        reason: "HTTP 404 (rule_not_found)",
        retryable: false,
      });
    });

    it("reads an undocumented status as unavailable", async () => {
      respond(503, "upstream gone");
      const outcome = await reconcileRules("tok", {
        repositoryUrl: REPO,
        rules: [],
      });
      expect(outcome).toEqual({
        status: "unavailable",
        reason: "HTTP 503",
        retryable: true,
      });
    });

    it.each([408, 429, 500, 502])(
      "marks an undocumented %i as retryable",
      async (status) => {
        respond(status, "slow down");
        const outcome = await reconcileRules("tok", {
          repositoryUrl: REPO,
          rules: [],
        });
        expect(outcome).toMatchObject({
          status: "unavailable",
          retryable: true,
        });
      }
    );

    it("does not mark an undocumented 403 as retryable", async () => {
      respond(403, "forbidden");
      const outcome = await reconcileRules("tok", {
        repositoryUrl: REPO,
        rules: [],
      });
      expect(outcome).toEqual({
        status: "unavailable",
        reason: "HTTP 403",
        retryable: false,
      });
    });

    it("reads a network failure as unavailable, never a throw", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      const outcome = await reconcileRules("tok", {
        repositoryUrl: REPO,
        rules: [],
      });
      expect(outcome).toEqual({
        status: "unavailable",
        reason: "network error: fetch failed",
        retryable: true,
      });
    });

    it("names a network failure by its cause, which is where Node's fetch puts it", async () => {
      const cause = Object.assign(
        new Error("getaddrinfo ENOTFOUND example.invalid"),
        { code: "ENOTFOUND" }
      );
      fetchMock.mockRejectedValue(new TypeError("fetch failed", { cause }));
      const outcome = await reconcileRules("tok", {
        repositoryUrl: REPO,
        rules: [],
      });
      expect(outcome).toEqual({
        status: "unavailable",
        reason: "network error: getaddrinfo ENOTFOUND example.invalid",
        retryable: true,
      });
    });

    it("falls back to the cause's code when its message is empty", async () => {
      // A refused connection to a dual-stack host: one error per address,
      // gathered into an AggregateError whose own message is empty.
      // eslint-disable-next-line unicorn/error-message -- the empty message is the case under test
      const cause = Object.assign(new AggregateError([], ""), {
        code: "ECONNREFUSED",
      });
      fetchMock.mockRejectedValue(new TypeError("fetch failed", { cause }));
      const outcome = await reconcileRules("tok", {
        repositoryUrl: REPO,
        rules: [],
      });
      expect(outcome).toMatchObject({
        reason: "network error: ECONNREFUSED",
      });
    });

    it("reads a 200 whose body is not JSON as unavailable, never a throw", async () => {
      respond(200, "<html>proxy error</html>");
      const outcome = await reconcileRules("tok", {
        repositoryUrl: REPO,
        rules: [],
      });
      expect(outcome).toEqual({
        status: "unavailable",
        reason: "invalid response body",
        retryable: false,
      });
    });
  });
});
