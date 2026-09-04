Create a rule that flags any call to `eval()` in TypeScript.

Executing a string at runtime is an injection risk, and it defeats every static
analysis the project runs: nothing downstream can see what the code will do.
Prefer a parser, a lookup table, or an explicit dispatch.

Deciding this needs only the expression itself. No other file has to be read,
and no state has to be resolved.

Code that should NOT be flagged:

```ts
const parsed = JSON.parse(payload);
```

Code that SHOULD be flagged:

```ts
const result = eval(payload);
```
