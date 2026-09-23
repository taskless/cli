import { join, resolve } from "node:path";
import process from "node:process";
import { defineCommand } from "citty";

import { detectHostTools } from "../detect/host-tools";
import { checkStaleness } from "../install/install";
import { getToken } from "../auth/token";
import { fetchWhoami } from "../auth/whoami";
import { outputSchema as infoOutputSchema } from "../schemas/info";
import { makeErrorEnvelope } from "../types/errors";
import { resolveRepositoryContext } from "../util/git-remote";
import { readManifest } from "../filesystem/manifest";
import { reconciliationStart } from "../rules/reconcile-marker";
import { TASKLESS_DIRECTORY } from "../rules/vale/formats";

export const infoCommand = defineCommand({
  meta: {
    name: "info",
    description: "Show Taskless CLI information",
  },
  args: {
    dir: {
      type: "string",
      alias: "d",
      description: "Working directory",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
      default: false,
    },
    anonymous: {
      type: "boolean",
      description: "Skip the API/auth probe and report local state only",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = resolve(args.dir ?? process.cwd());

    // The repository context resolves regardless of `--anonymous`: it comes
    // from the local git remote, not from the API, so suppressing it would
    // hide capability state that has nothing to do with the auth probe.
    const [harnesses, tools, token, repository, manifest] = await Promise.all([
      checkStaleness(cwd),
      // Presence on `PATH`, nothing executed. Resolves its own repository
      // context, which is the same never-throwing call as `repository` below
      // and cheap enough not to be worth threading through.
      detectHostTools(cwd),
      args.anonymous ? Promise.resolve() : getToken(cwd),
      resolveRepositoryContext(cwd),
      // Never fails: an absent or unreadable manifest is an ordinary state for
      // a project that has not been initialised, and `info` still has plenty
      // to report about one.
      readManifest(join(cwd, TASKLESS_DIRECTORY)).then(
        (read) => read.manifest,
        () => null
      ),
    ]);

    let auth: { user: string; email?: string; orgs: string[] } | undefined;
    if (!args.anonymous && token) {
      const whoami = await fetchWhoami(token);
      if (whoami) {
        auth = {
          user: whoami.user,
          email: whoami.email,
          orgs: whoami.orgs.map((o) => o.name),
        };
      }
    }

    const result = {
      success: true as const,
      version: __VERSION__,
      // `harnesses` carried the key `tools` until the word was needed for what
      // it actually says. The array is unchanged; only the key moved.
      harnesses,
      tools,
      loggedIn: token !== undefined,
      auth,
      // Reported so a caller deciding whether remote generation is available
      // reads the same resolution the CLI enforces, rather than shelling out
      // to git itself and reaching a different answer. `route` consults this
      // payload already; these fields ride along on a call it makes anyway.
      repositoryUrl: repository.repositoryUrl,
      ghOwner: repository.ghOwner,
      // Two namespaces, reported separately because they answer different
      // questions and drift apart. `install` is how the scaffold got here.
      // `rules` is what the rules are valid against, and it moves only when a
      // reconciliation is recorded.
      install: {
        cliVersion: manifest?.install?.cliVersion ?? null,
        // Mirrors the gate `onboard` itself applies (strict `=== true`), so
        // an absent field reads as "not onboarded" here too, not as an
        // unknown state.
        onboarded: manifest?.install?.onboarded === true,
      },
      rules: {
        reconciledTo: manifest?.rules?.reconciledTo ?? null,
        engines: {
          sg: manifest?.rules?.engines?.sg ?? null,
          vale: manifest?.rules?.engines?.vale ?? null,
        },
        // The walk boundary, decided once here rather than by each caller.
        // A missing marker resolves to the baseline, so a project predating
        // the ledger reports a walk rather than "nothing to do".
        walk: reconciliationStart(manifest?.rules?.reconciledTo) ?? null,
      },
    };

    if (args.json) {
      const parsed = infoOutputSchema.safeParse(result);
      if (!parsed.success) {
        console.log(
          JSON.stringify(
            makeErrorEnvelope(
              "INTERNAL_ERROR",
              "Internal schema validation failed"
            )
          )
        );
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(parsed.data));
      return;
    }

    // Human-readable output
    console.log(`Taskless CLI v${__VERSION__}\n`);

    if (harnesses.length === 0) {
      console.log("Harnesses: none detected");
    } else {
      console.log("Harnesses:");
      for (const tool of harnesses) {
        const total = tool.skills.length;
        const upToDate = tool.skills.filter((s) => s.current).length;
        const stale = total - upToDate;

        if (stale === 0) {
          console.log(
            `  ${tool.name}: ${String(total)} skills (all up to date)`
          );
        } else {
          console.log(
            `  ${tool.name}: ${String(total)} skills (${String(stale)} outdated)`
          );
          for (const skill of tool.skills) {
            if (!skill.current) {
              console.log(
                `    - ${skill.name}: ${skill.installedVersion ?? "missing"} → ${skill.currentVersion}`
              );
            }
          }
        }
      }
    }

    console.log("");
    // Presence, phrased as presence. Nothing here was run, so nothing here
    // may be reported as working.
    console.log("Tools on PATH:");
    for (const tool of tools) {
      const where = tool.applicable
        ? tool.present
          ? `found${tool.path === undefined ? "" : ` at ${tool.path}`}`
          : "not found"
        : "not applicable here";
      console.log(`  ${tool.name}: ${where}`);
    }

    console.log("");
    if (auth) {
      const orgs = auth.orgs.length > 0 ? ` (${auth.orgs.join(", ")})` : "";
      console.log(`Auth: logged in as ${auth.user}${orgs}`);
    } else {
      console.log("Auth: not logged in");
    }
  },
});
