it("spawns the built CLI", async () => {
  const builtCli = join(root, "dist/index.js");
  const { stdout } = await execFileAsync("node", [builtCli, "help"]);
  expect(stdout).toContain("Usage:");
});
