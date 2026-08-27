import { join, resolve } from "node:path";
import { defineCommand } from "citty";

import { checkStaleness } from "../install/install";
import { getToken } from "../auth/token";
import { fetchWhoami } from "../auth/whoami";
import { outputSchema as infoOutputSchema } from "../schemas/info";
import { makeErrorEnvelope } from "../types/errors";
import { resolveRepositoryContext } from "../util/git-remote";
import { readManifest } from "../filesystem/migrate";
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
    const [tools, token, repository, manifest] = await Promise.all([
      checkStaleness(cwd),
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
      install: { cliVersion: manifest?.install?.cliVersion ?? null },
      rules: {
        reconciledTo: manifest?.rules?.reconciledTo ?? null,
        engines: {
          sg: manifest?.rules?.engines?.sg ?? null,
          vale: manifest?.rules?.engines?.vale ?? null,
        },
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

    if (tools.length === 0) {
      console.log("Tools: none detected");
    } else {
      console.log("Tools:");
      for (const tool of tools) {
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
    if (auth) {
      const orgs = auth.orgs.length > 0 ? ` (${auth.orgs.join(", ")})` : "";
      console.log(`Auth: logged in as ${auth.user}${orgs}`);
    } else {
      console.log("Auth: not logged in");
    }
  },
});
