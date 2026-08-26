import { describe, expect, it, vi, beforeEach } from "vitest";

// `resolveRepositoryContext` is the one resolution behind both `info` and
// telemetry, and its contract is that it NEVER throws: every reason an owner
// might not resolve is an ordinary state. Two of those reasons cannot be
// produced by a real fixture repository — git missing from the host, and git
// failing for some other reason entirely — so the spawn is mocked rather than
// the environment altered. Doctoring `PATH` would make the test
// platform-specific (symlink permissions, `node.exe`, `;` as separator) to
// simulate something a stub states directly.
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const { execFile } = await import("node:child_process");
const { resolveRepositoryContext, UNKNOWN_GH_OWNER } =
  await import("../src/util/git-remote");

type ExecFileCallback = (
  error: (Error & { code?: string }) | null,
  stdout: string,
  stderr: string
) => void;

const mockedExecFile = vi.mocked(execFile);

/** Answer every `git` invocation with `error`, as a failed spawn would. */
function failEveryGitCall(error: Error & { code?: string }): void {
  mockedExecFile.mockImplementation(((..._arguments: unknown[]): unknown => {
    const callback = _arguments.at(-1) as ExecFileCallback;
    callback(error, "", "");
    return undefined;
  }) as unknown as typeof execFile);
}

describe("resolveRepositoryContext never throws", () => {
  beforeEach(() => {
    mockedExecFile.mockReset();
  });

  it("reports [unknown] when git is not installed", async () => {
    // ENOENT from the spawn itself: the binary is absent. This is NOT one of
    // the three no-remote populations — the lookup cannot run at all — and it
    // must still resolve rather than surface as an error.
    const enoent = Object.assign(new Error("spawn git ENOENT"), {
      code: "ENOENT",
    });
    failEveryGitCall(enoent);

    const context = await resolveRepositoryContext("/any/path");
    expect(context.repositoryUrl).toBeNull();
    expect(context.ghOwner).toBe(UNKNOWN_GH_OWNER);
  });

  it("reports [unknown] when git fails for any other reason", async () => {
    // A permissions failure, a corrupt repository, a git that exits non-zero
    // for a reason this code does not model. The contract is the same.
    failEveryGitCall(
      Object.assign(new Error("fatal: detected dubious ownership"), {
        code: "128",
      })
    );

    const context = await resolveRepositoryContext("/any/path");
    expect(context.repositoryUrl).toBeNull();
    expect(context.ghOwner).toBe(UNKNOWN_GH_OWNER);
  });

  it("returns the owner when git reports a GitHub origin", async () => {
    // Proves the stub can also produce the success path, so the two failure
    // cases above are not passing merely because nothing works under mock.
    mockedExecFile.mockImplementation(((..._arguments: unknown[]): unknown => {
      const callback = _arguments.at(-1) as ExecFileCallback;
      callback(null, "git@github.com:acme/widgets.git\n", "");
      return undefined;
    }) as unknown as typeof execFile);

    const context = await resolveRepositoryContext("/any/path");
    expect(context.repositoryUrl).toBe("https://github.com/acme/widgets");
    expect(context.ghOwner).toBe("acme");
  });
});
