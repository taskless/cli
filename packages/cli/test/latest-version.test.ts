import { describe, expect, it, vi } from "vitest";

import {
  fetchLatestVersion,
  isStrictSemver,
} from "../src/install/latest-version";

function respond(body: unknown, status = 200): typeof fetch {
  return vi.fn(() =>
    Promise.resolve(
      Response.json(body, {
        status,
        headers: { "content-type": "application/json" },
      })
    )
  ) as unknown as typeof fetch;
}

describe("fetchLatestVersion", () => {
  it("returns latest from the registry's dist-tags", async () => {
    const fetcher = respond({ latest: "0.14.0", next: "0.15.0-1" });
    await expect(
      fetchLatestVersion("@taskless/cli", { fetch: fetcher })
    ).resolves.toBe("0.14.0");
    expect(fetcher).toHaveBeenCalledWith(
      "https://registry.npmjs.org/-/package/@taskless/cli/dist-tags",
      expect.any(Object)
    );
  });

  it("accepts a nightly prerelease version", async () => {
    await expect(
      fetchLatestVersion("@taskless/cli-nightly", {
        fetch: respond({ latest: "0.13.5-20261102164414x312732c" }),
      })
    ).resolves.toBe("0.13.5-20261102164414x312732c");
  });

  it("is unknown on a non-2xx response", async () => {
    await expect(
      fetchLatestVersion("@taskless/cli", {
        fetch: respond({ latest: "0.14.0" }, 503),
      })
    ).resolves.toBeUndefined();
  });

  it("is unknown when fetch throws", async () => {
    const fetcher = vi.fn(() =>
      Promise.reject(new Error("offline"))
    ) as unknown as typeof fetch;
    await expect(
      fetchLatestVersion("@taskless/cli", { fetch: fetcher })
    ).resolves.toBeUndefined();
  });

  it("is unknown when the timeout passes", async () => {
    const fetcher = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        })
    ) as unknown as typeof fetch;
    await expect(
      fetchLatestVersion("@taskless/cli", { fetch: fetcher, timeoutMs: 10 })
    ).resolves.toBeUndefined();
  });

  it("is unknown when the payload has no latest", async () => {
    await expect(
      fetchLatestVersion("@taskless/cli", { fetch: respond({ next: "1.0.0" }) })
    ).resolves.toBeUndefined();
  });

  it.each([
    "latest",
    "1.0",
    "1.0.0 && echo x",
    "1.0.0\n",
    "v1.0.0",
    "1.0.0; rm -rf /",
    "01.0.0",
  ])("refuses %j as a version", async (latest) => {
    await expect(
      fetchLatestVersion("@taskless/cli", { fetch: respond({ latest }) })
    ).resolves.toBeUndefined();
  });
});

describe("isStrictSemver", () => {
  it.each(["0.0.0", "1.2.3", "1.2.3-alpha.1", "1.2.3+build.5", "1.2.3-x+y"])(
    "accepts %s",
    (value) => {
      expect(isStrictSemver(value)).toBe(true);
    }
  );
});
