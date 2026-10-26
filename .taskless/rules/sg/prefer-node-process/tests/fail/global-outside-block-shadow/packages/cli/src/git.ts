function main() {
  {
    const process = spawn("git", ["status"]);
    process.stdout.on("data", () => {});
  }
  return process.cwd();
}
