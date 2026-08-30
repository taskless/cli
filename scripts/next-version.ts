import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Print the version the CLI would be released as if the pending changesets
 * were applied right now, or its committed version when none are pending.
 *
 * `build:self` uses this to stamp `<next>-self`. Without it a self build
 * reports the last RELEASE, which describes neither the tree it was built from
 * nor the artifact it produced: on a `main` carrying 35 changesets it wrote
 * `0.10.2` into `.taskless/taskless.json`, silently replacing the committed
 * value, twice in one afternoon.
 */

const ROOT = resolve(import.meta.dirname, "..");
const CLI_PACKAGE_JSON = join(ROOT, "packages", "cli", "package.json");
const PACKAGE_NAME = "@taskless/cli";

/**
 * `changeset status --output=` resolves its path against the CWD, so an
 * absolute-looking `/tmp/x.json` silently becomes `<cwd>/tmp/x.json` and the
 * read that follows fails on a file nothing wrote. Measured; the same trap is
 * documented in `.github/scripts/nightly-pack.cjs`. Keep this relative.
 */
const STATUS_FILE = "changeset-status.tmp.json";

/** The version in version control, which is the last released one. */
function committedVersion(): string {
  const manifest = JSON.parse(readFileSync(CLI_PACKAGE_JSON, "utf8")) as {
    version: string;
  };
  return manifest.version;
}

/**
 * What the pending changesets propose for the CLI, or `undefined`.
 *
 * Selected BY NAME rather than by `releases[0]`. The six `@taskless/vale-*`
 * packages already sit in the same changesets workspace, so index 0 is the CLI
 * only for as long as nothing else is released alongside it, and being wrong
 * would stamp a self build with a Vale binary's version.
 */
function proposedVersion(): string | undefined {
  try {
    execFileSync("pnpm", ["changeset", "status", `--output=${STATUS_FILE}`], {
      cwd: ROOT,
      stdio: "ignore",
    });
  } catch {
    // Non-zero exit still writes the file in the cases that matter; if it did
    // not, the read below throws and the caller falls back.
  }

  try {
    const status = JSON.parse(
      readFileSync(join(ROOT, STATUS_FILE), "utf8")
    ) as { releases?: Array<{ name?: string; newVersion?: string }> };
    return status.releases?.find((r) => r.name === PACKAGE_NAME)?.newVersion;
  } catch {
    return undefined;
  } finally {
    rmSync(join(ROOT, STATUS_FILE), { force: true });
  }
}

// Falls back rather than throwing: with no changesets pending — which is the
// state of `main` for the whole window after a release — there is no proposal
// and the committed version IS the next one. A self build must keep working
// there.
process.stdout.write(proposedVersion() ?? committedVersion());
