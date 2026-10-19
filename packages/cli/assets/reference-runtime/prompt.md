Create a rule that requires every environment variable read through
`process.env` in a JavaScript or TypeScript file to have a matching key
declared in the `.env` file at the repository root.

Reading a variable that is never declared is the failure worth catching: it is
`undefined` at runtime rather than an error, so the program continues with a
missing value and fails somewhere else entirely.

Deciding this needs both files at once — the read and the declaration — so it
cannot be answered by matching a pattern within a single file.

A repository that should NOT be flagged:

```ts
// src/config.ts
export const apiUrl = process.env.API_URL;
```

```
# .env
API_URL=https://api.example.com
```

A repository that SHOULD be flagged, on the second line only:

```ts
// src/config.ts
export const apiUrl = process.env.API_URL;
export const apiKey = process.env.API_KEY;
```

```
# .env
API_URL=https://api.example.com
```
