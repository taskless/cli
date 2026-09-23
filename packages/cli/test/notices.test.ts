import { describe, expect, it } from "vitest";

import { collectNotices } from "../src/util/notices";

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
