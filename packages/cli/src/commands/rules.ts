import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { defineCommand } from "citty";

import { ZodError } from "zod";

import {
  identityFailureCode,
  resolveIdentity,
  type Identity,
} from "../auth/identity";
import { iterateRule, submitRequest, type V2Outcome } from "../api/v2";
import { readRuleMetaFile, deleteRuleFiles } from "../rules/files";
import {
  awaitRequest,
  deliverRevisions,
  orgNotFoundMessage,
  requestErrorText,
  type Delivered,
} from "../rules/generate";
import { RULES_DIRECTORY } from "../rules/layout";
import { unsupportedMessage } from "../rules/unsupported";
import {
  inputSchema as createInputSchema,
  outputSchema as createOutputSchema,
} from "../schemas/rules-create";
import {
  inputSchema as improveInputSchema,
  outputSchema as improveOutputSchema,
} from "../schemas/rules-improve";
import { outputSchema as metaOutputSchema } from "../schemas/rules-meta";
import { outputSchema as recoverOutputSchema } from "../schemas/rules-recover";
import { outputSchema as revisionsOutputSchema } from "../schemas/rules-revisions";
import {
  beginRestore,
  describeRevisions,
  restore,
  revisions,
  rollback,
  type Recovered,
} from "../rules/recover";
import { getTelemetry } from "../telemetry";
import { CLIError } from "../util/cli-error";
import { type CLIErrorCode, writeJsonError } from "../types/errors";

/** Why submitting a request or an iteration failed, as a message and a code. */
function describeSubmitFailure(
  outcome: Exclude<V2Outcome<unknown, string>, { status: "ok" }>,
  ruleId?: string
): { message: string; code: CLIErrorCode } {
  switch (outcome.status) {
    case "unauthorized": {
      return {
        message: "Authentication was rejected. Log in again.",
        code: "AUTH_REQUIRED",
      };
    }
    case "unavailable": {
      return {
        message: `Request submission failed: ${outcome.reason}.`,
        code: "NETWORK_ERROR",
      };
    }
    case "refused": {
      return { message: outcome.refusal.message, code: "NETWORK_ERROR" };
    }
    case "error": {
      switch (outcome.code) {
        case "validation_error": {
          return {
            message: `Validation error: ${(outcome.details ?? []).join(", ")}`,
            code: "INVALID_INPUT",
          };
        }
        case "organization_not_found": {
          return { message: orgNotFoundMessage(), code: "NETWORK_ERROR" };
        }
        case "rule_not_found": {
          // The caller supplied this id, so "no such rule" is a state they can
          // act on: re-check it. It is a rule's directory name, never the
          // request id `rule create` prints.
          return {
            message:
              `Rule ${ruleId ?? ""} was not found for this repository. ` +
              `\`ruleId\` is the rule's directory name under \`.taskless/rules/<engine>/\`.`,
            code: "RULE_NOT_FOUND",
          };
        }
        case "enqueue_failed": {
          return {
            message:
              "The request was recorded but could not be queued. Try again.",
            code: "NETWORK_ERROR",
          };
        }
        default: {
          return {
            message: `Request submission failed (${outcome.code}).`,
            code: "NETWORK_ERROR",
          };
        }
      }
    }
  }
}

/** How {@link completeRequest} reports, per command. */
interface CompletionOptions {
  json: boolean;
  fail: (message: string, code?: CLIErrorCode) => never;
  /** "Generated" or "Updated", for human output. */
  verb: string;
  /** The prefix for a request that ended `failed`. */
  failedPrefix: string;
  /** The command's `--json` success envelope for what was written. */
  output: (
    result: Omit<Delivered, "notices"> & { notices?: string[] }
  ) => unknown;
}

/**
 * Poll a submitted request to its end and deliver what it produced. Shared by
 * `create` and `improve`, whose only differences are wording and the envelope.
 * Returns how many rules were written.
 */
async function completeRequest(
  cwd: string,
  identity: Identity,
  requestId: string,
  options: CompletionOptions
): Promise<number> {
  const context = {
    token: identity.token,
    repositoryUrl: identity.repositoryUrl,
    orgId: identity.orgSubject,
    onProgress: (message: string) => console.error(message),
  };

  let delivered: Delivered;
  try {
    const status = await awaitRequest(context, requestId);
    switch (status.status) {
      case "unsupported": {
        options.fail(
          unsupportedMessage(requestErrorText(status)),
          "RULE_UNSUPPORTED"
        );
        break;
      }
      case "failed": {
        options.fail(
          `${options.failedPrefix}: ${requestErrorText(status) ?? "no reason was given"}`,
          "RULE_GENERATION_FAILED"
        );
        break;
      }
      case "generated": {
        break;
      }
      default: {
        // `pr`, `merged`, `closed`: states a CLI request does not reach. Report
        // the state rather than inventing a delivery.
        if (options.json) {
          console.log(JSON.stringify(options.output({ rules: [], files: [] })));
        } else {
          console.log(`Request ${requestId} is in state "${status.status}".`);
        }
        return 0;
      }
    }
    delivered = await deliverRevisions(cwd, context, status.revisions);
  } catch (error) {
    if (error instanceof CLIError && error.reported) throw error;
    options.fail(
      error instanceof Error ? error.message : String(error),
      error instanceof CLIError && error.code ? error.code : "INTERNAL_ERROR"
    );
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        options.output({
          rules: delivered.rules,
          files: delivered.files,
          ...(delivered.notices.length > 0
            ? { notices: delivered.notices }
            : {}),
        })
      )
    );
  } else {
    for (const notice of delivered.notices) console.error(`Warning: ${notice}`);
    console.log(`${options.verb} ${String(delivered.rules.length)} rule(s):\n`);
    for (const filePath of delivered.files) console.log(`  ${filePath}`);
  }
  return delivered.rules.length;
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
        writeJsonError(code, message);
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
        writeJsonError("INVALID_INPUT", message);
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
        // resolveIdentity throws a CLIError carrying its own code. Read the
        // field; never re-derive the code from the message.
        const message = error instanceof Error ? error.message : String(error);
        fail(message, identityFailureCode(error));
      }

      // 3. Submit the request
      const submitted = await submitRequest(identity.token, {
        orgId: identity.orgSubject,
        repositoryUrl: identity.repositoryUrl,
        prompt: request.prompt,
        successCases: request.successCases,
        failureCases: request.failureCases,
      });
      if (submitted.status !== "ok") {
        const failure = describeSubmitFailure(submitted);
        fail(failure.message, failure.code);
      }
      const requestId = submitted.data.requestId;

      // 4. Poll, then fetch, verify, and write each produced rule
      console.error(`Rule requested (${requestId}). Waiting for generation...`);
      const written = await completeRequest(cwd, identity, requestId, {
        json: args.json,
        fail,
        verb: "Generated",
        failedPrefix: "Rule generation failed",
        output: (result) =>
          createOutputSchema.parse({ success: true, requestId, ...result }),
      });
      if (written > 0) createdRuleCount = written;
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
        writeJsonError(code, message);
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
        writeJsonError("INVALID_INPUT", message);
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
        // Same contract as `rule create`: the code travels on the error.
        const message = error instanceof Error ? error.message : String(error);
        fail(message, identityFailureCode(error));
      }

      // 3. Submit the iterate request, addressed by the rule's own id
      const submitted = await iterateRule(identity.token, request.ruleId, {
        orgId: identity.orgSubject,
        repositoryUrl: identity.repositoryUrl,
        guidance: request.guidance,
        ...(request.references === undefined
          ? {}
          : { references: request.references }),
      });
      if (submitted.status !== "ok") {
        const failure = describeSubmitFailure(submitted, request.ruleId);
        fail(failure.message, failure.code);
      }
      const requestId = submitted.data.requestId;

      // 4. Poll, then fetch, verify, and write the new revision
      console.error(
        `Iterate request submitted (${requestId}). Waiting for generation...`
      );
      const written = await completeRequest(cwd, identity, requestId, {
        json: args.json,
        fail,
        verb: "Updated",
        failedPrefix: "Rule iteration failed",
        output: (result) =>
          improveOutputSchema.parse({ success: true, requestId, ...result }),
      });
      if (written > 0) improvedRuleCount = written;
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
    description:
      "Show sidecar metadata for a rule (no sidecar is written by this version)",
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
        writeJsonError(code, message);
      } else {
        console.error(`Error: ${message}`);
      }
      process.exitCode = 1;
      throw new CLIError(message, code, { reported: true });
    }

    // The sidecar is still READ, so a file that exists is reported. What
    // changed is what its absence means. It is not "this rule has no
    // metadata": no rule does. The sidecar is written from the `meta` block of
    // a rule status response, the service does not populate that block, and so
    // this CLI has never written one. Reporting RULE_NOT_FOUND sent agents
    // looking for a rule that was on disk the whole time.
    const meta = await readRuleMetaFile(cwd, args.id);
    if (!meta) {
      fail(
        `No metadata sidecar exists for rule "${args.id}", and this version of the CLI never writes one: ` +
          `the rule service does not return the metadata block that ` +
          `.taskless/rule-metadata/ is written from. This is not specific to "${args.id}". ` +
          `To iterate on a rule, pass its id (the rule's directory name under .taskless/rules/<engine>/) ` +
          `to \`taskless rule improve --from <file>\`, or use the local-only improve flow.`,
        "RULE_META_UNAVAILABLE"
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
      const result = await deleteRuleFiles(cwd, id);
      if (result.outcome === "deleted") {
        // Silent on stdout under `--json`, deliberately, not an oversight.
        // The spec's `{ ok:false, code, message }` envelope is documented as
        // an ERROR envelope ("... exits with an error" — see
        // openspec/specs/cli-check/spec.md and cli-auth/spec.md), not a
        // general success/failure wrapper: `create`/`improve`/`meta` print on
        // success because they have a payload to hand back (generated rules,
        // metadata), and `delete` does not. `auth logout` is the same shape
        // for the same reason. Introduced this way in 07c0d3c; see
        // test/error-envelope.test.ts's "is silent on stdout when a real rule
        // is deleted in --json mode".
        if (!args.json) {
          console.log(`Deleted rule "${id}" and associated test files.`);
        }
        success = true;
      } else if (result.outcome === "ambiguous") {
        // Nothing was deleted, deliberately. Two engines hold this id, so
        // there is no single rule the caller can have meant, and picking one
        // deleted a rule they may not have wanted while reporting success.
        // Naming both paths is the whole remedy: `verify` and `test` already
        // take a path, so the caller has somewhere to go.
        const message =
          `Rule "${id}" is held by ${result.engines.length} engines, ` +
          `so there is no single rule to delete: ${result.paths.join(", ")}. ` +
          `Remove the one you mean by path.`;
        if (args.json) {
          writeJsonError("RULE_ID_AMBIGUOUS", message);
        } else {
          console.error(`Error: ${message}`);
        }
        process.exitCode = 1;
      } else {
        // Engine-agnostic: `delete` takes a bare id and the rule could be
        // filed under any engine, so naming one in the failure would be a
        // guess — and was wrong for every rule that was not ast-grep.
        const message = `Rule "${id}" not found under .taskless/${RULES_DIRECTORY}/`;
        if (args.json) {
          writeJsonError("RULE_NOT_FOUND", message);
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
 * Resolve identity and run `act` for a command that addresses an issued rule
 * by id, reporting any failure in both output modes. Every failure is a
 * `CLIError` carrying the code an agent branches on. Returns `undefined` once
 * a failure has been reported.
 */
async function runForIssuedRule<T>(
  args: { dir?: string; json: boolean },
  act: (cwd: string, identity: Identity) => Promise<T>
): Promise<T | undefined> {
  const cwd = resolve(args.dir ?? process.cwd());
  const report = (message: string, code: CLIErrorCode): void => {
    if (args.json) writeJsonError(code, message);
    else console.error(`Error: ${message}`);
    process.exitCode = 1;
  };

  let identity: Identity;
  try {
    identity = await resolveIdentity(cwd);
  } catch (error) {
    report(
      error instanceof Error ? error.message : String(error),
      identityFailureCode(error)
    );
    return undefined;
  }

  try {
    return await act(cwd, identity);
  } catch (error) {
    report(
      error instanceof Error ? error.message : String(error),
      error instanceof CLIError && error.code ? error.code : "INTERNAL_ERROR"
    );
    return undefined;
  }
}

/**
 * The shared body of `rule restore` and `rule rollback`: run the recovery and
 * report it in both output modes.
 */
async function runRecovery(
  args: { dir?: string; json: boolean },
  ruleId: string,
  recover: (cwd: string, identity: Identity) => Promise<Recovered | string>
): Promise<void> {
  const outcome = await runForIssuedRule(args, recover);
  if (outcome === undefined) return;

  // A string is "nothing to do": the rule is already intact.
  if (typeof outcome === "string") {
    if (args.json) {
      console.log(
        JSON.stringify(
          recoverOutputSchema.parse({
            success: true,
            ruleId,
            files: [],
            notices: [outcome],
          })
        )
      );
    } else {
      console.log(outcome);
    }
    return;
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        recoverOutputSchema.parse({
          success: true,
          ruleId: outcome.ruleId,
          revisionId: outcome.revisionId,
          files: outcome.files,
          ...(outcome.notices.length > 0 ? { notices: outcome.notices } : {}),
        })
      )
    );
  } else {
    for (const notice of outcome.notices) console.log(notice);
  }
}

const restoreCommand = defineCommand({
  meta: {
    name: "restore",
    description:
      "Put back the version of a rule Taskless issued, after it was edited or deleted",
  },
  args: {
    dir: { type: "string", alias: "d", description: "Working directory" },
    json: { type: "boolean", description: "Output as JSON", default: false },
    id: {
      type: "positional",
      description:
        "Rule id: its directory name under .taskless/rules/<engine>/",
      required: true,
    },
  },
  async run({ args }) {
    await runRecovery(args, args.id, async (cwd, identity) => {
      const start = await beginRestore(cwd, identity, args.id);
      if (start.kind === "intact") return start.message;
      return restore(cwd, identity, args.id, start.expect);
    });
  },
});

const rollbackCommand = defineCommand({
  meta: {
    name: "rollback",
    description:
      "Make an earlier revision of a rule current, and write it to disk",
  },
  args: {
    dir: { type: "string", alias: "d", description: "Working directory" },
    json: { type: "boolean", description: "Output as JSON", default: false },
    id: {
      type: "positional",
      description:
        "Rule id: its directory name under .taskless/rules/<engine>/",
      required: true,
    },
    revision: {
      type: "positional",
      description: "The revision id to make current",
      required: true,
    },
  },
  async run({ args }) {
    await runRecovery(args, args.id, (cwd, identity) =>
      rollback(cwd, identity, args.id, args.revision)
    );
  },
});

const revisionsCommand = defineCommand({
  meta: {
    name: "revisions",
    description:
      "List a rule's recent revisions, to choose one for `rule rollback`",
  },
  args: {
    dir: { type: "string", alias: "d", description: "Working directory" },
    json: { type: "boolean", description: "Output as JSON", default: false },
    id: {
      type: "positional",
      description:
        "Rule id: its directory name under .taskless/rules/<engine>/",
      required: true,
    },
  },
  async run({ args }) {
    const result = await runForIssuedRule(args, async (_cwd, identity) => ({
      list: await revisions(identity, args.id),
      restoreRules: identity.restoreRules,
    }));
    if (result === undefined) return;
    const { list, restoreRules } = result;
    if (args.json) {
      console.log(
        JSON.stringify(revisionsOutputSchema.parse({ success: true, ...list }))
      );
    } else {
      for (const line of describeRevisions(list, restoreRules)) {
        console.log(line);
      }
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
    restore: restoreCommand,
    rollback: rollbackCommand,
    revisions: revisionsCommand,
  },
});
