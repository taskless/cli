import { whoami, type WhoamiResult } from "../api/v2";

/** Fetch identity info for the current token. Returns undefined on failure. */
export async function fetchWhoami(
  token: string
): Promise<WhoamiResult | undefined> {
  const outcome = await whoami(token);
  return outcome.status === "ok" ? outcome.data : undefined;
}
