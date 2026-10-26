it("bundles no node builtins", async () => {
  const bundle = await readFile("dist/index.js", "utf8");
  expect(bundle.match(/require\(["']node:fs["']\)/)).toBeNull();
});
