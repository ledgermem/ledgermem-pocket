import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export interface SyncState {
  lastSince: number;
  lastRunAt: string;
}

export function loadState(path: string): SyncState {
  if (!existsSync(path)) {
    return { lastSince: 0, lastRunAt: "" };
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (
    typeof raw === "object" &&
    raw !== null &&
    "lastSince" in raw &&
    typeof (raw as SyncState).lastSince === "number"
  ) {
    return raw as SyncState;
  }
  return { lastSince: 0, lastRunAt: "" };
}

export function saveState(path: string, state: SyncState): void {
  mkdirSync(dirname(path), { recursive: true });
  // Atomic write to avoid corrupted state if the process is killed mid-write.
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, path);
}
