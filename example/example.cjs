// A small CommonJS module with something the ast-grep rule has to say about.
const { readFileSync } = require("node:fs");

function loadConfig(path) {
  const raw = readFileSync(path, "utf8");
  // `eval` on file contents is the pattern `no-eval` exists to catch.
  return eval("(" + raw + ")");
}

function greet(name) {
  return `Hello, ${name}`;
}

module.exports = { loadConfig, greet };
