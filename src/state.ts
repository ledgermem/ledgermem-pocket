import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
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

let tmpCounter = 0;

export function saveState(path: string, state: SyncState): void {
  mkdirSync(dirname(path), { recursive: true });
  // Atomic write — tmp file lives in the same directory as the target so
  // renameSync can never cross a filesystem boundary (EXDEV). pid + a
  // monotonic counter keep two saves in the same process from clobbering
  // each other's tmp file mid-rename.
  const tmp = `${path}.${process.pid}.${tmpCounter++}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  try {
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore
    }
    throw err;
  }
}

/**
 * Acquire an exclusive lockfile next to the state file. Without this, a
 * cron-driven sync and an operator-triggered manual run can interleave —
 * one finishes, advances `lastSince`, then the other (started earlier)
 * overwrites with its older `lastSince`, silently re-ingesting everything
 * between the two watermarks on the next cron tick.
 */
export function acquireLock(statePath: string): () => void {
  mkdirSync(dirname(statePath), { recursive: true });
  const lockPath = `${statePath}.lock`;
  let fd: number;
  try {
    fd = openSync(lockPath, "wx");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EEXIST") {
      throw new Error(
        `pocket sync state is locked by another run: ${lockPath}. ` +
          `Delete the lockfile if you are sure no other process is running.`,
      );
    }
    throw err;
  }
  closeSync(fd);
  return () => {
    try {
      unlinkSync(lockPath);
    } catch {
      // ignore
    }
  };
}
