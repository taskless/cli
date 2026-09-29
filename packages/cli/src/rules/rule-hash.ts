import { readFile } from "node:fs/promises";

/**
 * Canonical rule hashing — the CLI half of the server-owned reconciliation
 * contract (TSKL-270). This MUST reproduce the server reference
 * (`packages/shared/src/rule-hash.ts`) byte-for-byte; the conformance vectors
 * at `GET /cli/api/v2/rule-hash-vectors` exist to catch any divergence.
 *
 * The hash is built on web-standard APIs only (`crypto.subtle` + `TextEncoder`)
 * so it matches in workerd and Node 20+ without a Node-specific crypto module.
 */

/** Algorithm version carried as the leading token of every signature. */
export const ALGO_VERSION = 1;

/** Hash algorithm for algoVersion 1. */
const ALGO = "sha-256";

/** A parsed signature envelope. */
export interface ParsedSignature {
  algoVersion: number;
  algo: string;
  digest: string;
}

/**
 * Normalize raw decoded rule text prior to hashing. Operates on text only —
 * it never parses or re-serializes YAML, so it works for any rule type.
 *
 * In order: strip a single leading BOM, convert CRLF and lone CR to LF, strip
 * all trailing newlines, then append exactly one LF. Unicode is intentionally
 * NOT NFC/NFD-folded — a change here ships as a new algoVersion.
 */
export function normalize(fileText: string): string {
  let text = fileText;
  // Strip a single leading UTF-8 BOM (decoded as U+FEFF).
  if (text.codePointAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  // Convert every CRLF and lone CR to LF.
  text = text.replaceAll(/\r\n?/g, "\n");
  // Strip all trailing newlines, then append exactly one LF.
  text = text.replaceAll(/\n+$/g, "") + "\n";
  return text;
}

/** Lowercase-hex encode a digest buffer. */
function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compute the canonical signature envelope `1;h=sha-256;d=<hex>` for a rule
 * file's text. The digest is `SHA-256(normalize(text))`, hex lowercase.
 */
export async function canonicalHash(fileText: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalize(fileText));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `${String(ALGO_VERSION)};h=${ALGO};d=${toHex(digest)}`;
}

/**
 * Parse and validate a signature envelope. The algoVersion is read up to the
 * first `;` — before any `key=value` parsing — so versioning never depends on
 * the parameter syntax. Throws on a malformed envelope; an unknown (future)
 * algoVersion is parsed leniently (its `algo`/`digest` are not validated) so
 * newer signatures stay forward-compatible rather than being rejected.
 */
export function parseSignature(signature: string): ParsedSignature {
  const firstDelimiter = signature.indexOf(";");
  if (firstDelimiter <= 0) {
    throw new Error(`Malformed signature (no algoVersion): "${signature}"`);
  }

  const versionToken = signature.slice(0, firstDelimiter);
  const algoVersion = Number(versionToken);
  if (
    !Number.isInteger(algoVersion) ||
    algoVersion <= 0 ||
    String(algoVersion) !== versionToken
  ) {
    throw new Error(`Malformed signature (bad algoVersion): "${signature}"`);
  }

  const parameters = new Map<string, string>();
  for (const part of signature.slice(firstDelimiter + 1).split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      throw new Error(`Malformed signature (bad parameter): "${signature}"`);
    }
    parameters.set(part.slice(0, eq), part.slice(eq + 1));
  }

  const algo = parameters.get("h");
  const digest = parameters.get("d");
  if (algo === undefined || digest === undefined) {
    throw new Error(`Malformed signature (missing h/d): "${signature}"`);
  }

  if (
    algoVersion === ALGO_VERSION &&
    (algo !== ALGO || !/^[0-9a-f]{64}$/.test(digest))
  ) {
    throw new Error(`Invalid algoVersion-1 signature: "${signature}"`);
  }

  return { algoVersion, algo, digest };
}

/**
 * Read a rule file as UTF-8 and produce its canonical signature envelope.
 * Used when reporting files for reconciliation (and for any sidecar write).
 */
export async function signRuleFile(filePath: string): Promise<string> {
  const text = await readFile(filePath, "utf8");
  return canonicalHash(text);
}
