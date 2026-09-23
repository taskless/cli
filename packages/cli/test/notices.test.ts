import { describe, expect, it } from "vitest";

import { collectNotices, markNotice } from "../src/util/notices";

/**
 * The one place the `notices` contract is decided, so it is the one place the
 * contract is pinned.
 *
 * Four producers used to hold this shape as four copies of an expression, and
 * nothing obliged them to agree — one of them did not, joining with a space
 * where the others joined with a newline. These are the claims the producers
 * are now entitled to make.
 */
describe("collectNotices", () => {
  it("keeps every present notice as its own element, in order", () => {
    // Order is the caller's, not the helper's: a call site puts the more
    // specific advisory first and the renderer prints them in that order.
    expect(collectNotices(["first", "second", "third"])).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("drops undefined, which is how an absent source is spelled", () => {
    // Callers assemble notices from optional sources — a Vale advisory that
    // may not exist beside a schema one that may not either. Filtering here is
    // what keeps a `.filter` out of every call site.
    expect(collectNotices([undefined, "present", undefined])).toEqual([
      "present",
    ]);
  });

  it("drops the empty string, which renders as a marker saying nothing", () => {
    // Not what the previous `filter((x) => x !== undefined)` did, and
    // deliberately so. A `""` survived it and reached the renderer, which
    // printed a bare `Notice: ` with nothing after it. Four producers
    // independently emitting that was never a contract anyone designed.
    expect(collectNotices(["", "present", ""])).toEqual(["present"]);
  });

  it("is empty when nothing survives, so a call site can omit the field", () => {
    expect(collectNotices([])).toEqual([]);
    expect(collectNotices([undefined, ""])).toEqual([]);
  });

  it("leaves a multi-line notice as one element", () => {
    // A single notice may legitimately span lines — Vale's stderr is passed
    // through as written. That is formatting WITHIN one message, not a
    // separator BETWEEN messages, so the helper does not split it; the
    // renderers prefix each of its lines instead.
    expect(collectNotices(["line one\nline two"])).toEqual([
      "line one\nline two",
    ]);
  });
});

/**
 * The renderers' half of the same contract.
 *
 * `check` and `verify` differ only in the marker, so they share this. The
 * multi-line case is the one worth pinning directly: no notice the CLI
 * produces today spans lines, but several embed text the CLI did not author —
 * Vale's stderr, and an `Error.message` inside a runtime repair notice — so it
 * is a latent case that will arrive without anyone choosing it.
 */
describe("markNotice", () => {
  it("marks every line of a multi-line notice, not just the first", () => {
    // The whole defect, in one assertion. An unmarked second line reads as
    // stray output rather than as part of the notice above it.
    expect(markNotice("first line\nsecond line\nthird", "Notice: ")).toEqual([
      "Notice: first line",
      "Notice: second line",
      "Notice: third",
    ]);
  });

  it("renders a single-line notice as exactly one line", () => {
    expect(markNotice("just the one", "Notice: ")).toEqual([
      "Notice: just the one",
    ]);
  });

  it("carries the caller's marker, which is the only difference between the two renderers", () => {
    // `verify` indents under the rule the notice belongs to; `check` marks at
    // the left margin. Presentation, not a second contract.
    expect(markNotice("a\nb", "    notice: ")).toEqual([
      "    notice: a",
      "    notice: b",
    ]);
  });

  it("keeps an empty trailing line marked rather than dropping it", () => {
    // Splitting is not filtering. A notice that ends in a newline still had
    // that line, and silently dropping output is how a notice loses its tail.
    expect(markNotice("text\n", "Notice: ")).toEqual([
      "Notice: text",
      "Notice: ",
    ]);
  });
});
