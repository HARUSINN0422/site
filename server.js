/**
 * Sync the repository's AI/ directory to Apache's /var/www/html/AI/.
 * Run from the cloned repository with: node server.js
 * Checks origin/main every 60 seconds.
 */
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const REPO_DIR = __dirname;
const SOURCE_DIR = path.join(REPO_DIR, "AI");
const WEB_ROOT = process.env.WEB_ROOT || "/var/www/html";
const TARGET_DIR = path.join(WEB_ROOT, "AI");
const TEMP_DIR = path.join(WEB_ROOT, ".AI-sync-tmp");
const BACKUP_DIR = path.join(WEB_ROOT, ".AI-sync-backup");
const BRANCH = process.env.GIT_BRANCH || "main";
const INTERVAL_MS = 60 * 1000;

let syncing = false;
let lastSyncedCommit = null;

async function git(...args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: REPO_DIR,
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

async function getCommit() {
  return git("rev-parse", "HEAD");
}

async function syncToApache() {
  await fs.mkdir(WEB_ROOT, { recursive: true });
  await fs.rm(TEMP_DIR, { recursive: true, force: true });
  await fs.rm(BACKUP_DIR, { recursive: true, force: true });
  await fs.cp(SOURCE_DIR, TEMP_DIR, { recursive: true, force: true });

  let movedOldDirectory = false;
  try {
    try {
      await fs.rename(TARGET_DIR, BACKUP_DIR);
      movedOldDirectory = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await fs.rename(TEMP_DIR, TARGET_DIR);
    await fs.rm(BACKUP_DIR, { recursive: true, force: true });
  } catch (error) {
    await fs.rm(TARGET_DIR, { recursive: true, force: true }).catch(() => {});
    if (movedOldDirectory) await fs.rename(BACKUP_DIR, TARGET_DIR).catch(() => {});
    throw error;
  }
}

async function updateAndSync(isStartup = false) {
  if (syncing) return;
  syncing = true;
  try {
    const before = await getCommit();
    await git("pull", "--ff-only", "origin", BRANCH);
    const after = await getCommit();
    if (isStartup || after !== lastSyncedCommit || after !== before) {
      await syncToApache();
      lastSyncedCommit = after;
      console.log(new Date().toISOString(), "AI files synced to", TARGET_DIR, "commit", after);
    } else {
      console.log(new Date().toISOString(), "No changes:", after);
    }
  } catch (error) {
    console.error(new Date().toISOString(), "Update/sync failed:", error.message);
  } finally {
    syncing = false;
  }
}

async function main() {
  try {
    await fs.access(SOURCE_DIR);
  } catch {
    console.error("AI/ directory was not found:", SOURCE_DIR);
    process.exitCode = 1;
    return;
  }
  await updateAndSync(true);
  setInterval(() => updateAndSync(false), INTERVAL_MS);
  console.log("GitHub sync checker started. Interval: 60 seconds.");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exitCode = 1;
});
