import type { Mnemo } from "@getmnemo/memory";
import { PocketClient, type PocketItem } from "./pocket-client.js";
import { acquireLock, loadState, saveState, type SyncState } from "./state.js";

export interface MemoryClient {
  add: Mnemo["add"];
}

export interface SyncOptions {
  pocket: PocketClient;
  memory: MemoryClient;
  statePath: string;
  pageSize: number;
}

export interface SyncResult {
  itemsSynced: number;
  newSince: number;
}

function buildContent(item: PocketItem): string {
  const title = item.resolved_title || item.given_title || "(untitled)";
  const url = item.resolved_url || item.given_url || "";
  const excerpt = item.excerpt ?? "";
  return [title, url, excerpt].filter(Boolean).join("\n\n");
}

function tagList(item: PocketItem): string[] {
  if (!item.tags) return [];
  return Object.values(item.tags).map((t) => t.tag);
}

export async function syncOnce(opts: SyncOptions): Promise<SyncResult> {
  // Lock so a cron run and a manual trigger can't interleave: an earlier
  // run finishing later would overwrite the newer `lastSince` with a stale
  // value, silently re-ingesting items on the next cron tick.
  const release = acquireLock(opts.statePath);
  try {
    return await runSyncOnce(opts);
  } finally {
    release();
  }
}

async function runSyncOnce(opts: SyncOptions): Promise<SyncResult> {
  const state: SyncState = loadState(opts.statePath);
  let offset = 0;
  let itemsSynced = 0;
  let highestSince = state.lastSince;
  // Defense against an upstream bug returning the same page repeatedly:
  // if we ever see the same item_id set twice, bail.
  const seenIds = new Set<string>();

  // Pocket pagination loop.
  // Each request returns up to pageSize items; we stop when we get < pageSize.
  const MAX_PAGES = 1000;
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await opts.pocket.get({
      since: state.lastSince,
      count: opts.pageSize,
      offset,
      state: "archive",
      detailType: "complete",
    });
    const items = PocketClient.itemsArray(response);
    if (items.length === 0) break;
    if (response.since > highestSince) highestSince = response.since;
    // If every id in this page was already seen, the server is looping us.
    const allDuplicate = items.every((it) => seenIds.has(it.item_id));
    if (allDuplicate) break;

    for (const item of items) {
      if (seenIds.has(item.item_id)) continue;
      seenIds.add(item.item_id);
      // Pocket sometimes returns items where status="2" means deleted —
      // those should not be ingested as memories.
      if (item.status === "2") continue;
      const content = buildContent(item);
      // Items with no title, url, or excerpt have nothing useful to store.
      if (content.trim() === "(untitled)" || content.trim().length === 0) continue;
      await opts.memory.add(content, {
        metadata: {
          source: "pocket",
          pocketId: item.item_id,
          url: item.resolved_url || item.given_url || "",
          title: item.resolved_title || item.given_title || "",
          tags: tagList(item),
          excerpt: item.excerpt ?? "",
          addedAt: item.time_added,
        },
      });
      itemsSynced += 1;
      // Persist incrementally so a mid-run failure doesn't replay everything.
      saveState(opts.statePath, {
        lastSince: highestSince,
        lastRunAt: state.lastRunAt,
      });
    }
    if (items.length < opts.pageSize) break;
    offset += items.length;
  }

  saveState(opts.statePath, {
    lastSince: highestSince,
    lastRunAt: new Date().toISOString(),
  });
  return { itemsSynced, newSince: highestSince };
}
