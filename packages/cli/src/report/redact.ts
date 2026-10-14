import type { RedactionKind } from "./types";

/**
 * The CLI's redaction pass over everything a report would publish.
 *
 * tskl.es performs no redaction of its own, so what this misses is published.
 * Two rules follow from that:
 *
 * - **Withhold, never mask.** A fixture that matches is dropped whole. A
 *   half-masked snippet reads as broken code on a page meant to show a rule
 *   working, and a masked secret still leaks its shape and length.
 * - **Patterns only for what a pattern can know.** Secrets, email addresses,
 *   host names, IP addresses and phone numbers have a shape. People's and
 *   customers' names do not, so those are the agent's to judge and declare.
 *
 * Bump {@link REDACTION_POLICY_VERSION} whenever a pattern changes, so a
 * published report says which pass it went through.
 */

export const REDACTION_POLICY_VERSION = "1";

/** The kinds this pass can detect. */
export type PatternKind = Extract<
  RedactionKind,
  "secret" | "email" | "host" | "ip" | "phone"
>;

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bAKIA[\dA-Z]{16}\b/g,
  /\bgh[opsur]_[\dA-Za-z]{36,}\b/g,
  /\bgithub_pat_\w{40,}\b/g,
  /\bxox[abprs]-[\dA-Za-z-]{10,}\b/g,
  /\b(?:sk|rk)_live_[\dA-Za-z]{16,}\b/g,
  /\bAIza[\w-]{35}\b/g,
  /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:api[_-]?key|secret|token|passw(?:or)?d)\s*[:=]\s*["'][^"'\s]{8,}["']/gi,
];

const EMAIL = /\b[\w.%+-]+@[\dA-Za-z.-]+\.[A-Za-z]{2,}\b/g;

/**
 * A dotted host under a TLD a real or internal host is likely to use. Narrow
 * on purpose: code is full of `a.b` member access, and a pattern loose enough
 * to catch every host would withhold every fixture. `.app`, `.dev`, `.ai` and
 * `.co` are real TLDs left out for that reason: `this.app` and `config.dev`
 * are code, and withholding them would cost more fixtures than it protects.
 */
const HOST =
  /\b(?:[\dA-Za-z-]+\.)+(?:com|net|org|io|cloud|internal|corp|local|lan)\b/gi;

/** Names that are hosts in form but documentation by definition. */
const RESERVED_HOST = /(?:^|\.)(?:example\.(?:com|net|org)|localhost)$/i;

const IPV4 =
  /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;

/** Loopback and unspecified addresses identify nothing. */
const HARMLESS_IP = new Set(["127.0.0.1", "0.0.0.0"]);

/** Requires separators, so a long number in code is not read as a phone. */
const PHONE = /(?:\+\d{1,3}[\s.-])?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;

function countMatches(pattern: RegExp, text: string): string[] {
  return [...text.matchAll(pattern)].map((match) => match[0]);
}

/** Every pattern hit in `text`, by kind. A kind with no hit is absent. */
export function scanText(text: string): Partial<Record<PatternKind, number>> {
  const hits: Partial<Record<PatternKind, number>> = {};
  const add = (kind: PatternKind, n: number) => {
    if (n > 0) hits[kind] = (hits[kind] ?? 0) + n;
  };

  for (const pattern of SECRET_PATTERNS) {
    add("secret", countMatches(pattern, text).length);
  }

  const emails = countMatches(EMAIL, text);
  add("email", emails.length);
  // An email's domain is a host, but it has already been counted once.
  let withoutEmails = text;
  for (const email of emails) {
    withoutEmails = withoutEmails.replaceAll(email, " ");
  }

  add(
    "host",
    countMatches(HOST, withoutEmails).filter(
      (host) => !RESERVED_HOST.test(host)
    ).length
  );
  add(
    "ip",
    countMatches(IPV4, text).filter((ip) => !HARMLESS_IP.has(ip)).length
  );
  add("phone", countMatches(PHONE, text).length);
  return hits;
}

/** Whether `text` has any hit at all. */
export function hasHits(hits: Partial<Record<PatternKind, number>>): boolean {
  return Object.keys(hits).length > 0;
}
