import { describe, expect, it } from "vitest";

import { stampSkillVersion } from "../src/install/install";

const SKILL = `---
name: example
description: |
  Mentions version: 1.0.0 in prose.
metadata:
  author: taskless
  version: 0.11.2
  commandName: tskl
---

metadata:
  version: 0.11.2
`;

describe("stampSkillVersion", () => {
  it("rewrites metadata.version in the frontmatter only", () => {
    expect(stampSkillVersion(SKILL, "0.12.0-self")).toBe(
      SKILL.replace(
        "  version: 0.11.2\n  commandName",
        "  version: 0.12.0-self\n  commandName"
      )
    );
  });

  it("leaves content without frontmatter alone", () => {
    const body = "metadata:\n  version: 0.11.2\n";
    expect(stampSkillVersion(body, "0.12.0")).toBe(body);
  });

  it("leaves frontmatter without a metadata.version alone", () => {
    const content = "---\nname: example\n---\n\nbody\n";
    expect(stampSkillVersion(content, "0.12.0")).toBe(content);
  });
});
