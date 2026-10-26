export const process = spawn("node", ["dist/index.js"]);
process.stdout.on("data", () => {});
