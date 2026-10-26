it("imports nothing forbidden", async () => {
  const source = readFileSync(join(root, "dist/prompts.js"), "utf8");
  const specifiers = [...source.matchAll(/\bfrom\s*["']([^"']+)["']/g)];
  expect(specifiers).toEqual([]);
});
