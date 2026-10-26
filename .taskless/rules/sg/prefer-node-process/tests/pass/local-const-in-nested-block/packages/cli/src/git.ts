function main() {
  const process = spawn("git", ["status"]);
  if (process.pid) {
    process.stdout.on("data", () => {});
  }
}
