## 1. Package bin

- [x] 1.1 Add `src/node-version.ts`, the `>=` lower-bound comparison and its message
- [x] 1.2 Add `src/bin.ts`, which checks `__TASKLESS_NODE_ENGINE__` and then dynamically imports the CLI
- [x] 1.3 Build it as a second program entry with a shebang, define `__TASKLESS_NODE_ENGINE__` from `engines.node`, and point `bin` at `dist/bin.js`

## 2. Project launcher

- [x] 2.1 Check the lockfile's `engines.node` before installing, and the installed `package.json`'s before running

## 3. Docs

- [x] 3.1 Say in the `ci` recipe that the job needs Node 22.22 or later, and bump its topic version

## 4. Tests

- [x] 4.1 `nodeVersionProblem`: ranges it admits, ranges it refuses, ranges it does not judge
- [x] 4.2 The built `bin` on a spoofed Node 20.19.0 prints the message, exits 1, and loads nothing else
- [x] 4.3 The launcher on a spoofed older Node refuses before installing and refuses an already installed version
