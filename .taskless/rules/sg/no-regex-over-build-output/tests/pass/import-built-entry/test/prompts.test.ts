it("renders from the built artifact", async () => {
  const builtEntry = join(root, "dist/prompts.js");
  const { getPrompt } = await import(pathToFileURL(builtEntry).href);
  expect(getPrompt("engine-selection")).toBe(sourceRecipe);
});
