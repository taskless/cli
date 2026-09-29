import { vi } from "vitest";

import { canonicalHash } from "../../src/rules/rule-hash";

/**
 * A stubbed v2 rule API for driving the real `rule create` / `rule improve`
 * commands: submit and iterate hand back a request id, polling reports the
 * produced `{ ruleId, revisionId }` pairs, and `GET rule/{ruleId}` serves each
 * rule's file set.
 *
 * Served sets are SIGNED here with the CLI's own `canonicalHash`, the way the
 * service signs them, so a test that wants a bad signature has to break one
 * on purpose rather than inherit a set that was never valid.
 */

export interface StubFile {
  path: string;
  content: string;
}

export interface StubRule {
  id: string;
  engine: "sg" | "vale" | "runtime";
  files: StubFile[];
}

/** A served rule body: one signed file set plus its revision. */
export async function servedBody(
  rule: StubRule,
  revisionId: string,
  extra: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const signatures = await Promise.all(
    rule.files
      .filter((file) => !file.path.startsWith(".tests/"))
      .map(async (file) => ({
        path: file.path,
        signature: await canonicalHash(file.content),
      }))
  );
  const check = signatures.find((entry) => entry.path === "check.ts");
  return {
    ruleId: rule.id,
    revisionId,
    rules: [
      {
        ...rule,
        // Copied, so a test that tampers with the served set cannot reach
        // back into the rule every later test signs.
        files: rule.files.map((file) => ({ ...file })),
        signatures,
        ...(rule.engine === "runtime" && check !== undefined
          ? { signature: check.signature }
          : {}),
      },
    ],
    ...extra,
  };
}

export interface StubServerOptions {
  /** Rules the request produces, each with the body `GET rule/{id}` serves. */
  produced: Array<{ rule: StubRule; body: Record<string, unknown> }>;
  /** Terminal request status. Defaults to `generated`. */
  status?: string;
  /** `error` on the terminal status, for `failed` / `unsupported`. */
  error?: string;
}

export const REQUEST_ID = "11111111-1111-1111-1111-111111111111";
export const ITERATE_REQUEST_ID = "22222222-2222-2222-2222-222222222222";

/** Install the stub as the global `fetch`. Returns the mock for assertions. */
export function stubV2Server(
  options: StubServerOptions
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: string | URL | Request): Response => {
    const request = input instanceof Request ? input : new Request(input);
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    if (pathname === "/cli/api/whoami") {
      // Swallowed by the org lookup, which falls back to the token.
      return Response.json({}, { status: 500 });
    }
    if (method === "POST" && pathname === "/cli/api/v2/request") {
      return Response.json({ requestId: REQUEST_ID, status: "accepted" });
    }
    if (method === "POST" && pathname.endsWith("/iterate")) {
      return Response.json({
        requestId: ITERATE_REQUEST_ID,
        status: "accepted",
      });
    }
    if (method === "GET" && pathname.startsWith("/cli/api/v2/request/")) {
      return Response.json({
        requestId: pathname.split("/").at(-1),
        status: options.status ?? "generated",
        revisions: options.produced.map(({ rule, body }) => ({
          ruleId: rule.id,
          revisionId: body.revisionId,
        })),
        ...(options.error === undefined ? {} : { error: options.error }),
      });
    }
    if (method === "GET" && pathname.startsWith("/cli/api/v2/rule/")) {
      const ruleId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const match = options.produced.find(({ rule }) => rule.id === ruleId);
      return match === undefined
        ? Response.json({ error: "rule_not_found" }, { status: 404 })
        : Response.json(match.body);
    }
    throw new Error(`unexpected ${method} ${pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
