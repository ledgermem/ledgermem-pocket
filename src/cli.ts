#!/usr/bin/env node
import "dotenv/config";
import { Mnemo } from "@getmnemo/memory";
import { loadConfig } from "./config.js";
import { PocketClient } from "./pocket-client.js";
import { syncOnce } from "./sync.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const memory = new Mnemo({
    apiKey: cfg.getmnemoApiKey,
    workspaceId: cfg.getmnemoWorkspaceId,
  });
  const pocket = new PocketClient(cfg.consumerKey, cfg.accessToken);
  const result = await syncOnce({
    pocket,
    memory,
    statePath: cfg.statePath,
    pageSize: cfg.pageSize,
  });
  process.stdout.write(
    `Pocket sync complete: ${result.itemsSynced} item(s) ingested. since=${result.newSince}\n`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`pocket-sync failed: ${message}\n`);
  process.exit(1);
});
