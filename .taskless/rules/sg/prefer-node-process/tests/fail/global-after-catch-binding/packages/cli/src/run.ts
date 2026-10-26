try {
  run();
} catch (process) {
  console.error(process);
}
process.exitCode = 1;
