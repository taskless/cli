import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diffSnapshots, snapshotPaths } from "../src/filesystem/snapshot";

/**
 * These are the pure half of the migration report, and worth testing directly
 * rather than only through a CLI run: the report's whole value is that it says
 * what actually changed, so a gap here is invisible in exactly the way the
 * report exists to prevent.
 */
describe("snapshotPaths and diffSnapshots", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "taskless-snapshot-"));
    await mkdir(join(root, ".taskless"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const snap = () => snapshotPaths(root, [".taskless", ".gitignore"]);

  it("reports an added file", async () => {
    const before = await snap();
    await writeFile(join(root, ".taskless", "new.txt"), "hello");
    expect(diffSnapshots(before, await snap())).toEqual({
      added: [".taskless/new.txt"],
      modified: [],
      removed: [],
    });
  });

  it("reports a modified file, and only when contents change", async () => {
    await writeFile(join(root, ".taskless", "a.txt"), "one");
    const before = await snap();

    // Rewriting identical bytes is not a change. Reporting it would make
    // every run look like it touched the tree.
    await writeFile(join(root, ".taskless", "a.txt"), "one");
    expect(diffSnapshots(before, await snap()).modified).toEqual([]);

    await writeFile(join(root, ".taskless", "a.txt"), "two");
    expect(diffSnapshots(before, await snap()).modified).toEqual([
      ".taskless/a.txt",
    ]);
  });

  it("reports a removed file", async () => {
    await writeFile(join(root, ".taskless", "gone.txt"), "x");
    const before = await snap();
    await rm(join(root, ".taskless", "gone.txt"));
    expect(diffSnapshots(before, await snap()).removed).toEqual([
      ".taskless/gone.txt",
    ]);
  });

  it("recurses into nested directories", async () => {
    const before = await snap();
    await mkdir(join(root, ".taskless", "rules", "sg"), { recursive: true });
    await writeFile(join(root, ".taskless", "rules", "sg", "r.yml"), "id: r");
    expect(diffSnapshots(before, await snap()).added).toEqual([
      ".taskless/rules/sg/r.yml",
    ]);
  });

  it("watches a named file as well as a directory", async () => {
    const before = await snap();
    // Migration 0001 writes the root `.gitignore`, which is why a bare file
    // is a watched path at all.
    await writeFile(join(root, ".gitignore"), "node_modules\n");
    expect(diffSnapshots(before, await snap()).added).toEqual([".gitignore"]);
  });

  it("sees a created symlink", async () => {
    // `Dirent` predicates describe the entry itself and do not follow links,
    // so a symlink is neither a file nor a directory. Left unhandled it is
    // invisible in BOTH snapshots, and a migration that created one would
    // report nothing for it.
    await writeFile(join(root, ".taskless", "real.txt"), "x");
    const before = await snap();
    await symlink("real.txt", join(root, ".taskless", "link.txt"));
    expect(diffSnapshots(before, await snap()).added).toEqual([
      ".taskless/link.txt",
    ]);
  });

  it("sees a symlink retargeted, without following it", async () => {
    await writeFile(join(root, ".taskless", "real.txt"), "x");
    await symlink("real.txt", join(root, ".taskless", "link.txt"));
    const before = await snap();

    await rm(join(root, ".taskless", "link.txt"));
    await symlink("other.txt", join(root, ".taskless", "link.txt"));

    // Modified rather than added/removed: the path still exists, its target
    // changed. Recorded from the link text, so a dangling target is fine and
    // no cycle is possible.
    expect(diffSnapshots(before, await snap()).modified).toEqual([
      ".taskless/link.txt",
    ]);
  });

  it("sees a removed symlink", async () => {
    await symlink("nowhere.txt", join(root, ".taskless", "dangling.txt"));
    const before = await snap();
    await rm(join(root, ".taskless", "dangling.txt"));
    expect(diffSnapshots(before, await snap()).removed).toEqual([
      ".taskless/dangling.txt",
    ]);
  });

  it("handles a tree larger than one hash batch", async () => {
    // Hashing runs in bounded batches (32 at a time) rather than one
    // `Promise.all` over the whole tree, because a large repository would
    // otherwise open every file at once and hit `EMFILE`. An unreadable file
    // is swallowed as "not part of the snapshot", so that failure would show
    // up as a silently incomplete report rather than an error. 80 files
    // crosses the boundary in both directions.
    const before = await snap();
    const names = Array.from(
      { length: 80 },
      (_, index) => `f${String(index).padStart(3, "0")}.txt`
    );
    for (const name of names) {
      await writeFile(join(root, ".taskless", name), name);
    }

    const changes = diffSnapshots(before, await snap());
    expect(changes.added).toHaveLength(80);
    // Every one accounted for, and still sorted across batch boundaries.
    expect(changes.added).toEqual(
      names.map((name) => `.taskless/${name}`).toSorted()
    );
  });

  it("contributes nothing for a path that does not exist", async () => {
    const snapshot = await snapshotPaths(root, ["does-not-exist"]);
    expect(snapshot.size).toBe(0);
  });

  it("sorts every list, so two runs over one tree agree", async () => {
    const before = await snap();
    for (const name of ["c.txt", "a.txt", "b.txt"]) {
      await writeFile(join(root, ".taskless", name), name);
    }
    expect(diffSnapshots(before, await snap()).added).toEqual([
      ".taskless/a.txt",
      ".taskless/b.txt",
      ".taskless/c.txt",
    ]);
  });
});
