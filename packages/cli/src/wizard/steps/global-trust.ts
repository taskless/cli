import { confirm, log } from "@clack/prompts";

import {
  describeGlobalTrust,
  GLOBAL_TRUST_ENTRY,
  type GlobalTrustOutcome,
} from "../../install/global-trust";
import { wrap } from "../../install/notice-box";
import { ask } from "../ask";
import { layoutSettings, SUMMARY_COLUMNS } from "./summary";

const ENTRY_INDENT = "  ";

function paragraph(text: string): string {
  return wrap(text, SUMMARY_COLUMNS).join("\n");
}

/**
 * Ask whether to write the global trust entry, after explaining it. This is
 * the one edit outside the project, so it never shares a question with the
 * install, and it defaults to no: Enter is the one answer that takes no
 * reading, and it should not change a person's own settings.
 */
export async function promptGlobalTrust(
  outcomes: readonly GlobalTrustOutcome[],
  home: string
): Promise<boolean> {
  const offers = describeGlobalTrust(outcomes, home);
  log.message(
    offers
      .flatMap((offer) => [
        layoutSettings([
          {
            label: offer.replace ? "REPLACE (global):" : "ALLOW (global):",
            tone: offer.replace ? "replace" : "allow",
            what: offer.what,
            where: offer.where,
          },
        ]).join("\n"),
        ...offer.before.map((text) => paragraph(text)),
        wrap(GLOBAL_TRUST_ENTRY, SUMMARY_COLUMNS - ENTRY_INDENT.length)
          .map((line) => `${ENTRY_INDENT}${line}`)
          .join("\n"),
        ...offer.after.map((text) => paragraph(text)),
      ])
      .join("\n\n")
  );
  const files = offers.map((offer) => offer.file).join(", ");
  return ask("global-trust", () =>
    confirm({
      message: offers.some((offer) => offer.replace)
        ? `Update the Taskless entry in ${files}?`
        : `Add the Taskless entry to ${files}?`,
      initialValue: false,
    })
  );
}
