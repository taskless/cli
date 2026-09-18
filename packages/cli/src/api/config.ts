import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import { getConfigDirectory } from "../auth/token";

const DEFAULT_BASE_URL = "https://app.taskless.io/cli";
const CONFIG_FILE = "config.json";

interface CLIConfig {
  apiUrl?: string;
}

function readConfigFile(): CLIConfig | undefined {
  try {
    const filePath = join(getConfigDirectory(), CONFIG_FILE);
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as CLIConfig;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the API base URL.
 * Priority: TASKLESS_API_URL env var > config.json apiUrl > default.
 */
export function getApiBaseUrl(): string {
  if (process.env.TASKLESS_API_URL) return process.env.TASKLESS_API_URL;

  const config = readConfigFile();
  if (config?.apiUrl) return config.apiUrl;

  return DEFAULT_BASE_URL;
}
