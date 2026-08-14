import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { defineCommand } from "citty";

import { ZodError } from "zod";

import { resolveIdentity } from "../auth/identity";
import { verifyRule } from "../rules/verify";
import { verifyValeRule } from "../rules/vale/verify";
import { rulefileOwners, ruleFileLocation } from "../rules/owner";
import { submitRule, pollRuleStatus, iterateRule } from "../api/rules";
import {
  writeRuleFile,
  writeRuleTestFile,
  writeRuleMetaFiles,
  readRuleMetaFile,
  deleteRuleFiles,
} from "../rules/files";
import { ENGINE_LAYOUTS, LEGACY_RULES_DIRECTORY } from "../rules/engines";
import {
  inputSchema as createInputSchema,
  outputSchema as createOutputSchema,
} from "../schemas/rules-create";
import {
  inputSchema as improveInputSchema,
  outputSchema as improveOutputSchema,
} from "../schemas/rules-improve";
import { outputSchema as metaOutputSchema } from "../schemas/rules-meta";
import {
  verifyOutputSchema,
  valeVerifyOutputSchema,
} from "../schemas/rules-verify";
import { getTelemetry } from "../telemetry";
import { CLIError } from "../util/cli-error";
import { type CLIErrorCode, makeErrorEnvelope } from "../types/errors";

/** Format today's date as YYYYMMDD */
function getTimestamp(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

const POLL_INTERVAL_MS = 15_000;

/**
 * `unsupported` is a terminal status: the request asked for a rule generation
 * the account can't access — e.g. runtime rules that aren't enabled on the
 * current plan. It is not a transient failure to retry; the plan or entitlement
 * has to change first.
 */
function unsupportedMessage(): string {
  return [
    "This rule generation isn't available on your current Taskless plan.",
    "",
    "It may need a capability that isn't enabled for your organization yet (for example, runtime rules). Ask your Taskless administrator or upgrade your plan to enable it.",
  ].join("\n");
}

const createCommand = defineCommand({
  meta: {
    name: "create",
    description:
      "Create a new rule from a JSON file (use --from to specify the input file)",
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
    from: {
      type: "string",
      description:
        "Path to a JSON file containing the rule request (required). Example: --from .taskless/.tmp-rule-request.json",
    },
    anonymous: {
      type: "boolean",
      description:
        "Direct the agent to use the local-only recipe (no API call)",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = resolve(args.dir ?? process.cwd());
    const telemetry = await getTelemetry(cwd);

    /** Emit an error and exit, respecting --json mode */
    function fail(
      message: string,
      code: CLIErrorCode = "INTERNAL_ERROR"
    ): never {
      if (args.json) {
        console.log(JSON.stringify(makeErrorEnvelope(code, message)));
      } else {
        console.error(`Error: ${message}`);
      }
      process.exitCode = 1;
      throw new CLIError(message, code, { reported: true });
    }

    if (args.anonymous) {
      // Anonymous rule creation runs in the agent, not the CLI. Point the
      // agent at the local-only recipe and exit cleanly. That recipe is
      // `create-sg-rule`: authoring an ast-grep rule on-device with no service
      // call is exactly what anonymous mode asks for, so it is the destination
      // rather than an `--anonymous` variant of the service recipe.
      const message =
        "Anonymous rule generation runs in the agent. Run `taskless agent create-sg-rule` to fetch the local-only recipe.";
      if (args.json) {
        console.log(
          JSON.stringify(makeErrorEnvelope("INVALID_INPUT", message))
        );
      } else {
        console.error(message);
      }
      process.exitCode = 1;
      return;
    }

    // Set to the number of rules written when generation succeeds; drives the
    // cli_rule_created event in the finally.
    let createdRuleCount: number | undefined;
    try {
      // 1. Read and validate --from file
      if (!args.from) {
        fail(
          "--from is required. Provide a path to a JSON file.\n  Example: taskless rule create --from request.json",
          "INVALID_INPUT"
        );
      }

      const filePath = resolve(cwd, args.from);
      let fileContent: string;
      try {
        fileContent = await readFile(filePath, "utf8");
      } catch {
        fail(`Could not read file "${args.from}".`, "INVALID_INPUT");
      }

      let rawJson: unknown;
      try {
        rawJson = JSON.parse(fileContent) as unknown;
      } catch {
        fail(`"${args.from}" is not valid JSON.`, "INVALID_INPUT");
      }

      let request: ReturnType<typeof createInputSchema.parse>;
      try {
        request = createInputSchema.parse(rawJson);
      } catch (error) {
        if (error instanceof ZodError) {
          fail(
            `Invalid input: ${error.issues.map((issue) => issue.message).join(", ")}`,
            "INVALID_INPUT"
          );
        }
        fail(
          error instanceof Error ? error.message : String(error),
          "INVALID_INPUT"
        );
      }

      // 2. Resolve identity (orgId from JWT, repositoryUrl from git remote)
      let identity;
      try {
        identity = await resolveIdentity(cwd);
      } catch (error) {
        // resolveIdentity throws on missing auth or missing git remote;
        // surface the original message but pick a best-guess code.
        const message = error instanceof Error ? error.message : String(error);
        const code: CLIErrorCode = /git remote|origin/i.test(message)
          ? "NO_GITHUB_REMOTE"
          : "AUTH_REQUIRED";
        fail(message, code);
      }

      // 3. Submit rule to API
      let ruleId: string;
      try {
        const response = await submitRule(identity.token, {
          orgId: identity.orgSubject,
          repositoryUrl: identity.repositoryUrl,
          prompt: request.prompt,
          successCases: request.successCases,
          failureCases: request.failureCases,
        });
        ruleId = response.ruleId;
      } catch (error) {
        fail(
          error instanceof Error ? error.message : String(error),
          "NETWORK_ERROR"
        );
      }

      // 4. Poll for results
      console.error(`Rule submitted (${ruleId}). Waiting for generation...`);

      while (true) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        let status;
        try {
          status = await pollRuleStatus(identity.token, ruleId);
        } catch (error) {
          fail(
            `Polling failed: ${error instanceof Error ? error.message : String(error)}`,
            "NETWORK_ERROR"
          );
        }

        switch (status.status) {
          case "accepted": {
            console.error("Status: accepted — waiting for processing...");
            break;
          }
          case "classifying": {
            console.error("Status: classifying — analyzing your request...");
            break;
          }
          case "building": {
            console.error("Status: building — generating rules...");
            break;
          }
          case "unsupported": {
            fail(unsupportedMessage(), "RULE_UNSUPPORTED");
            break;
          }
          case "failed": {
            fail(
              `Rule generation failed: ${status.error}`,
              "RULE_GENERATION_FAILED"
            );
            break;
          }
          case "generated": {
            // 6. Write files
            const timestamp = getTimestamp();
            const writtenFiles: string[] = [];
            const rules = status.rules ?? [];

            for (const rule of rules) {
              const ruleFile = await writeRuleFile(cwd, rule);
              writtenFiles.push(ruleFile);

              if (rule.tests) {
                const testFile = await writeRuleTestFile(cwd, rule, timestamp);
                writtenFiles.push(testFile);
              }
            }

            if (status.meta) {
              const metaFiles = await writeRuleMetaFiles(cwd, status.meta);
              writtenFiles.push(...metaFiles);
            }

            // 7. Output results
            if (args.json) {
              const output = createOutputSchema.parse({
                success: true,
                ruleId,
                rules: rules.map((r) => r.id),
                files: writtenFiles,
              });
              console.log(JSON.stringify(output));
            } else {
              console.log(`Generated ${String(rules.length)} rule(s):\n`);
              for (const filePath of writtenFiles) {
                console.log(`  ${filePath}`);
              }
            }
            if (rules.length > 0) createdRuleCount = rules.length;
            return;
          }
          case "pr":
          case "merged":
          case "closed": {
            // Terminal states beyond generation — treat as done without files
            if (args.json) {
              const output = createOutputSchema.parse({
                success: true,
                ruleId,
                rules: [],
                files: [],
              });
              console.log(JSON.stringify(output));
            } else {
              console.log(`Rule ${ruleId} is in state "${status.status}".`);
            }
            return;
          }
        }
      }
    } finally {
      // Concrete state event: a rule was actually generated and written.
      if (createdRuleCount !== undefined) {
        telemetry.capture("cli_rule_created", { ruleCount: createdRuleCount });
      }
    }
  },
});

const improveCommand = defineCommand({
  meta: {
    name: "improve",
    description:
      "Improve an existing rule with guidance (use --from to specify the input file)",
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
    from: {
      type: "string",
      description:
        "Path to a JSON file containing { ruleId, guidance, references? }. Example: --from .taskless/.tmp-iterate-request.json",
    },
    anonymous: {
      type: "boolean",
      description:
        "Direct the agent to use the local-only recipe (no API call)",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = resolve(args.dir ?? process.cwd());
    const telemetry = await getTelemetry(cwd);

    /** Emit an error and exit, respecting --json mode */
    function fail(
      message: string,
      code: CLIErrorCode = "INTERNAL_ERROR"
    ): never {
      if (args.json) {
        console.log(JSON.stringify(makeErrorEnvelope(code, message)));
      } else {
        console.error(`Error: ${message}`);
      }
      process.exitCode = 1;
      throw new CLIError(message, code, { reported: true });
    }

    if (args.anonymous) {
      const message =
        "Anonymous rule improvement runs in the agent. Run `taskless agent improve-rule --anonymous` to fetch the local-only recipe.";
      if (args.json) {
        console.log(
          JSON.stringify(makeErrorEnvelope("INVALID_INPUT", message))
        );
      } else {
        console.error(message);
      }
      process.exitCode = 1;
      return;
    }

    // Set to the number of rules written when iteration succeeds; drives the
    // cli_rule_improved event in the finally.
    let improvedRuleCount: number | undefined;
    try {
      // 1. Read and validate --from file
      if (!args.from) {
        fail(
          "--from is required. Provide a path to a JSON file.\n  Example: taskless rule improve --from request.json",
          "INVALID_INPUT"
        );
      }

      const filePath = resolve(cwd, args.from);
      let fileContent: string;
      try {
        fileContent = await readFile(filePath, "utf8");
      } catch {
        fail(`Could not read file "${args.from}".`, "INVALID_INPUT");
      }

      let rawJson: unknown;
      try {
        rawJson = JSON.parse(fileContent) as unknown;
      } catch {
        fail(`"${args.from}" is not valid JSON.`, "INVALID_INPUT");
      }

      let request: ReturnType<typeof improveInputSchema.parse>;
      try {
        request = improveInputSchema.parse(rawJson);
      } catch (error) {
        if (error instanceof ZodError) {
          fail(
            `Invalid input: ${error.issues.map((issue) => issue.message).join(", ")}`,
            "INVALID_INPUT"
          );
        }
        fail(
          error instanceof Error ? error.message : String(error),
          "INVALID_INPUT"
        );
      }

      // 2. Resolve identity (orgId from JWT, repositoryUrl from git remote)
      let identity;
      try {
        identity = await resolveIdentity(cwd);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code: CLIErrorCode = /git remote|origin/i.test(message)
          ? "NO_GITHUB_REMOTE"
          : "AUTH_REQUIRED";
        fail(message, code);
      }

      // 3. Submit iterate request to API
      let requestId: string;
      try {
        const response = await iterateRule(identity.token, request.ruleId, {
          orgId: identity.orgSubject,
          guidance: request.guidance,
          references: request.references,
        });
        requestId = response.requestId;
      } catch (error) {
        fail(
          error instanceof Error ? error.message : String(error),
          "NETWORK_ERROR"
        );
      }

      // 4. Poll for results using the requestId
      console.error(
        `Iterate request submitted (${requestId}). Waiting for generation...`
      );

      while (true) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        let status;
        try {
          status = await pollRuleStatus(identity.token, requestId);
        } catch (error) {
          fail(
            `Polling failed: ${error instanceof Error ? error.message : String(error)}`,
            "NETWORK_ERROR"
          );
        }

        switch (status.status) {
          case "accepted": {
            console.error("Status: accepted — waiting for processing...");
            break;
          }
          case "classifying": {
            console.error("Status: classifying — analyzing your request...");
            break;
          }
          case "building": {
            console.error("Status: building — generating rules...");
            break;
          }
          case "unsupported": {
            fail(unsupportedMessage(), "RULE_UNSUPPORTED");
            break;
          }
          case "failed": {
            fail(
              `Rule iteration failed: ${status.error}`,
              "RULE_GENERATION_FAILED"
            );
            break;
          }
          case "generated": {
            // 6. Write files (overwrites existing rule files)
            const timestamp = getTimestamp();
            const writtenFiles: string[] = [];
            const rules = status.rules ?? [];

            for (const rule of rules) {
              const ruleFile = await writeRuleFile(cwd, rule);
              writtenFiles.push(ruleFile);

              if (rule.tests) {
                const testFile = await writeRuleTestFile(cwd, rule, timestamp);
                writtenFiles.push(testFile);
              }
            }

            if (status.meta) {
              const metaFiles = await writeRuleMetaFiles(cwd, status.meta);
              writtenFiles.push(...metaFiles);
            }

            // 7. Output results
            if (args.json) {
              const output = improveOutputSchema.parse({
                success: true,
                requestId,
                rules: rules.map((r) => r.id),
                files: writtenFiles,
              });
              console.log(JSON.stringify(output));
            } else {
              console.log(`Updated ${String(rules.length)} rule(s):\n`);
              for (const filePath of writtenFiles) {
                console.log(`  ${filePath}`);
              }
            }
            if (rules.length > 0) improvedRuleCount = rules.length;
            return;
          }
          case "pr":
          case "merged":
          case "closed": {
            if (args.json) {
              const output = improveOutputSchema.parse({
                success: true,
                requestId,
                rules: [],
                files: [],
              });
              console.log(JSON.stringify(output));
            } else {
              console.log(
                `Request ${requestId} is in state "${status.status}".`
              );
            }
            return;
          }
        }
      }
    } finally {
      // Concrete state event: a rule was actually iterated and rewritten.
      if (improvedRuleCount !== undefined) {
        telemetry.capture("cli_rule_improved", {
          ruleCount: improvedRuleCount,
        });
      }
    }
  },
});

const metaCommand = defineCommand({
  meta: {
    name: "meta",
    description: "Show sidecar metadata for a rule",
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
      description: "Accepted for compatibility; meta is purely local",
      default: false,
    },
    id: {
      type: "positional",
      description: "Rule ID to look up",
      required: true,
    },
  },
  async run({ args }) {
    const cwd = resolve(args.dir ?? process.cwd());

    function fail(
      message: string,
      code: CLIErrorCode = "INTERNAL_ERROR"
    ): never {
      if (args.json) {
        console.log(JSON.stringify(makeErrorEnvelope(code, message)));
      } else {
        console.error(`Error: ${message}`);
      }
      process.exitCode = 1;
      throw new CLIError(message, code, { reported: true });
    }

    const meta = await readRuleMetaFile(cwd, args.id);
    if (!meta) {
      fail(
        `No metadata found for rule "${args.id}". Expected .taskless/rule-metadata/${args.id}.yml`,
        "RULE_NOT_FOUND"
      );
    }

    if (args.json) {
      let output;
      try {
        output = metaOutputSchema.parse({ id: args.id, ...meta });
      } catch (error) {
        if (error instanceof ZodError) {
          fail(
            `Invalid metadata for rule "${args.id}": ${error.issues.map((issue) => issue.message).join(", ")}`,
            "INVALID_INPUT"
          );
        }
        fail(error instanceof Error ? error.message : String(error));
      }
      console.log(JSON.stringify(output));
    } else {
      console.log(`Metadata for rule "${args.id}":\n`);
      for (const [key, value] of Object.entries(meta)) {
        console.log(`  ${key}: ${String(value)}`);
      }
    }
  },
});

const deleteCommand = defineCommand({
  meta: {
    name: "delete",
    description: "Delete a rule and its test files",
  },
  args: {
    dir: {
      type: "string",
      alias: "d",
      description: "Working directory",
    },
    anonymous: {
      type: "boolean",
      description: "Accepted for compatibility; delete is purely local",
      default: false,
    },
    json: {
      type: "boolean",
      description:
        "On error, write the standardized { ok:false, code, message } envelope to stdout instead of human text on stderr",
      default: false,
    },
    id: {
      type: "positional",
      description: "Rule ID to delete",
      required: true,
    },
  },
  async run({ args }) {
    const cwd = resolve(args.dir ?? process.cwd());
    const telemetry = await getTelemetry(cwd);
    const id = args.id;

    let success = false;
    try {
      const deleted = await deleteRuleFiles(cwd, id);
      if (deleted) {
        if (!args.json) {
          console.log(`Deleted rule "${id}" and associated test files.`);
        }
        success = true;
      } else {
        const message =
          `Rule "${id}" not found in .taskless/${ENGINE_LAYOUTS.sg.rulesDirectory}/${id}.yml ` +
          `or .taskless/${LEGACY_RULES_DIRECTORY}/${id}.yml`;
        if (args.json) {
          console.log(
            JSON.stringify(makeErrorEnvelope("RULE_NOT_FOUND", message))
          );
        } else {
          console.error(`Error: ${message}`);
        }
        process.exitCode = 1;
      }
    } finally {
      // Concrete state event: a rule and its tests were actually removed.
      if (success) {
        telemetry.capture("cli_rule_deleted");
      }
    }
  },
});

/**
 * Verify a Vale rule against its fixture buckets.
 *
 * Split out because the two engines answer different questions and their
 * reports share no fields beyond `ruleId`/`success`. Vale's failure modes are
 * about the *fixtures*: a bucket nobody populated proves nothing, and reporting
 * that as a pass is how an unverified rule ships looking verified.
 */
async function verifyValeRuleCommand(
  cwd: string,
  ruleId: string,
  json: boolean
): Promise<void> {
  let result;
  try {
    result = await verifyValeRule(cwd, ruleId);
  } catch (error) {
    // A nested fixture directory throws rather than being skipped: Vale lints
    // the rule's whole tree, so a nested document is linted but never checked
    // against a bucket, and silently ignoring it would let half a rule's
    // fixtures go unverified while it reported a pass.
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      console.log(JSON.stringify(makeErrorEnvelope("INVALID_INPUT", message)));
    } else {
      console.error(`Error: ${message}`);
    }
    process.exitCode = 1;
    return;
  }

  if ("outcome" in result) {
    // Vale never ran. Not a verification result, and not a pass.
    const { outcome } = result;
    if (json) {
      console.log(
        JSON.stringify(
          makeErrorEnvelope(
            outcome.status === "unavailable"
              ? "ENGINE_UNAVAILABLE"
              : "SCAN_FAILED",
            outcome.message
          )
        )
      );
    } else {
      console.error(`Error: ${outcome.message}`);
    }
    process.exitCode = 1;
    return;
  }

  if (json) {
    console.log(
      JSON.stringify(
        valeVerifyOutputSchema.parse({
          engine: "vale",
          success: result.passed,
          ruleId: result.ruleId,
          fixtures: result.fixtures,
          missingFailures: result.missingFailures,
          unexpectedFindings: result.unexpectedFindings,
        })
      )
    );
  } else {
    console.log(`Verifying Vale rule: ${result.ruleId}\n`);

    const coverage: Record<typeof result.fixtures, string> = {
      both: "✓ pass/ and fail/ both have documents",
      "pass-only": "✗ no fail/ fixtures — the rule is never shown to fire",
      "fail-only":
        "✗ no pass/ fixtures — the rule is never shown to stay quiet",
      none: "✗ no fixtures at all",
    };
    console.log(`Fixtures:     ${coverage[result.fixtures]}`);

    console.log(
      `Fires:        ${result.missingFailures.length === 0 ? "✓ every fail/ document was flagged" : "✗ some fail/ documents were not flagged"}`
    );
    for (const file of result.missingFailures) {
      console.log(`  - ${file}`);
    }

    console.log(
      `Stays quiet:  ${result.unexpectedFindings.length === 0 ? "✓ no pass/ document was flagged" : "✗ some pass/ documents were flagged"}`
    );
    for (const file of result.unexpectedFindings) {
      console.log(`  - ${file}`);
    }

    console.log(
      `\nResult: ${result.passed ? "✓ All checks passed" : "✗ Verification failed"}`
    );
  }

  if (!result.passed) {
    process.exitCode = 1;
  }
}

const verifyCommand = defineCommand({
  meta: {
    name: "verify",
    description:
      "Validate a rule and run its tests (ast-grep) or its fixtures (Vale)",
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
      description: "Accepted for compatibility; verify is purely local",
      default: false,
    },
    id: {
      type: "positional",
      description: "Rule ID to verify",
      required: false,
    },
  },
  async run({ args }) {
    const cwd = resolve(args.dir ?? process.cwd());

    if (!args.id) {
      if (args.json) {
        console.log(
          JSON.stringify(
            makeErrorEnvelope("INVALID_INPUT", "Rule ID is required.")
          )
        );
      } else {
        console.error(
          "Error: Rule ID is required.\n  Usage: taskless rule verify <id>"
        );
      }
      process.exitCode = 1;
      return;
    }

    // Which engine owns the rule is decided by where its file sits, the same
    // way `dispatch` decides it, so a rule cannot be verified by one engine and
    // run by another.
    const ruleId = args.id;
    const owners = await rulefileOwners(cwd, ruleId);

    if (owners.length > 1) {
      // Both engines hold this id. Verifying one silently would report on a
      // file the user may not have meant, so name both and let them say which.
      const message =
        `Rule "${ruleId}" exists for more than one engine: ` +
        owners.map((engine) => ruleFileLocation(engine, ruleId)).join(", ") +
        ". Rename one so the id identifies a single rule.";
      if (args.json) {
        console.log(
          JSON.stringify(makeErrorEnvelope("INVALID_INPUT", message))
        );
      } else {
        console.error(`Error: ${message}`);
      }
      process.exitCode = 1;
      return;
    }

    if (owners[0] === "vale") {
      await verifyValeRuleCommand(cwd, ruleId, args.json);
      return;
    }

    // No owner falls through to the ast-grep verifier, which already reports a
    // missing rule file across its layers — including the legacy location.
    const result = await verifyRule(cwd, ruleId);

    if (args.json) {
      console.log(JSON.stringify(verifyOutputSchema.parse({ engine: "sg", ...result })));
    } else {
      console.log(`Verifying rule: ${result.ruleId}\n`);

      // Layer 1
      console.log(
        `Schema:       ${result.schema.valid ? "✓ valid" : "✗ invalid"}`
      );
      for (const error of result.schema.errors) {
        console.log(`  - ${error}`);
      }

      // Layer 2
      console.log(
        `Requirements: ${result.requirements.valid ? "✓ valid" : "✗ invalid"}`
      );
      for (const error of result.requirements.errors) {
        console.log(`  - ${error}`);
      }

      // Layer 3
      console.log(
        `Tests:        ${result.tests.valid ? "✓ passed" : "✗ failed"} (${String(result.tests.passed)} passed, ${String(result.tests.failed)} failed)`
      );
      for (const error of result.tests.errors) {
        console.log(`  - ${error}`);
      }

      console.log(
        `\nResult: ${result.success ? "✓ All checks passed" : "✗ Verification failed"}`
      );
    }

    if (!result.success) {
      process.exitCode = 1;
    }
  },
});

export const ruleCommand = defineCommand({
  meta: {
    name: "rule",
    description: "Manage Taskless rules",
  },
  subCommands: {
    create: createCommand,
    improve: improveCommand,
    meta: metaCommand,
    delete: deleteCommand,
    verify: verifyCommand,
  },
});
