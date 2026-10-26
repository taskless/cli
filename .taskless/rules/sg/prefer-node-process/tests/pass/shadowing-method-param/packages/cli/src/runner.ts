class Runner {
  stop(process: ChildProcess) {
    return process.kill();
  }
}
