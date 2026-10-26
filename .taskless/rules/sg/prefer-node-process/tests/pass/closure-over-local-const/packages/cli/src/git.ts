function outer() {
  const process = spawn("git", ["status"]);
  const inner = () => process.pid;
  return inner();
}
