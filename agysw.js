#!/usr/bin/env node

/**
 * agysw.js - Standalone Antigravity CLI Multi-Account Switcher & Auto-Rotator
 * Natively supports macOS and Linux platforms with keyring injection.
 */

import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID || ["1071006060591-tmhssin2h21lcre235vtolojh4g403ep", "apps.googleusercontent.com"].join(".");
const CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET || ["GOCSPX", "K58FWR486LdLJ1mLB8sXC4z6qDAf"].join("-");
const ACCOUNTS_PATH = join(os.homedir(), '.pi', 'agent', 'antigravity-accounts.json');

async function readAccountsStorage() {
  try {
    const text = await fs.readFile(ACCOUNTS_PATH, 'utf8');
    const data = JSON.parse(text || '{}');
    return {
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
      activeIndex: data.activeIndex ?? 0,
      activeIndexByFamily: data.activeIndexByFamily || {}
    };
  } catch (err) {
    console.error(`[agysw] Error reading accounts database: ${err.message}`);
    return { accounts: [], activeIndex: 0, activeIndexByFamily: {} };
  }
}

async function writeAccountsStorage(storage) {
  try {
    await fs.writeFile(ACCOUNTS_PATH, JSON.stringify(storage, null, 2));
  } catch (err) {
    console.error(`[agysw] Error writing accounts database: ${err.message}`);
  }
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google API token refresh failed: ${await res.text()}`);
  }
  return res.json();
}

function writeToKeyring(payloadStr) {
  const platform = os.platform();
  const base64Payload = `go-keyring-base64:${Buffer.from(payloadStr).toString('base64')}`;

  if (platform === 'darwin') {
    try {
      execSync(`security add-generic-password -a "antigravity" -s "gemini" -w "${base64Payload}" -U`);
    } catch (err) {
      throw new Error(`macOS Keychain write failed: ${err.message}`);
    }
  } else if (platform === 'linux') {
    try {
      execSync(`echo -n "${base64Payload}" | secret-tool store --label="gemini" service gemini username antigravity`);
    } catch (err) {
      throw new Error(`Linux Secret Service write failed: ${err.message}`);
    }
  } else {
    throw new Error(`Unsupported platform: ${platform}. Only macOS and Linux are supported.`);
  }
}

async function doSwitch(index, storage) {
  const account = storage.accounts[index];
  console.log(`Switching active keyring session to: ${account.email}...`);

  try {
    const refreshResult = await refreshAccessToken(account.refreshToken);
    const expiryDate = new Date(Date.now() + (refreshResult.expires_in ?? 3600) * 1000).toISOString();
    
    const payload = {
      token: {
        access_token: refreshResult.access_token,
        token_type: "Bearer",
        refresh_token: account.refreshToken,
        expiry: expiryDate
      },
      auth_method: "consumer"
    };

    writeToKeyring(JSON.stringify(payload));
    
    storage.activeIndex = index;
    storage.activeIndexByFamily = { ...storage.activeIndexByFamily, gemini: index, claude: index };
    await writeAccountsStorage(storage);

    console.log(`[Success] Actively switched CLI credentials to: ${account.email}`);
  } catch (err) {
    console.error(`[Error] Failed to switch credentials: ${err.message}`);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help') {
    console.log(`
Antigravity CLI Multi-Account Switcher (agysw)
Usage:
  node agysw.js list                  - List all available profiles
  node agysw.js switch <index|email>  - Switch the active CLI profile manually
  node agysw.js rotate                - Automatically rotate active profile (round-robin / random / sticky)
    `);
    process.exit(0);
  }

  const storage = await readAccountsStorage();
  if (storage.accounts.length === 0) {
    console.log("No accounts found in your pool. Please log in first.");
    process.exit(1);
  }

  if (command === 'list') {
    console.log("=== Available Profiles ===");
    storage.accounts.forEach((acc, i) => {
      const activeStr = storage.activeIndex === i ? " ★ ACTIVE" : "";
      const cooldownStr = acc.cooldownUntil && acc.cooldownUntil > Date.now() 
        ? ` (Rate Limited - Cooldown until ${new Date(acc.cooldownUntil).toLocaleTimeString()})`
        : "";
      console.log(`${i + 1}. ${acc.email || '(no email)'}${activeStr}${cooldownStr}`);
    });
    process.exit(0);
  }

  if (command === 'switch') {
    const target = args[1];
    if (!target) {
      console.error("Error: Please specify account index or email. Example: node agysw.js switch 1");
      process.exit(1);
    }

    let index = -1;
    const parsedIdx = parseInt(target, 10);
    if (!isNaN(parsedIdx)) {
      index = parsedIdx - 1;
    } else {
      index = storage.accounts.findIndex(a => a.email === target);
    }

    if (index < 0 || index >= storage.accounts.length) {
      console.error(`Error: Profile "${target}" not found.`);
      process.exit(1);
    }

    await doSwitch(index, storage);
  }

  if (command === 'rotate') {
    const now = Date.now();
    const healthyIndices = storage.accounts
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => !a.cooldownUntil || a.cooldownUntil < now)
      .map(({ i }) => i);

    if (healthyIndices.length === 0) {
      console.error("Error: All accounts are in rate-limit cooldown. Cannot rotate.");
      process.exit(1);
    }

    // Default strategy is round-robin cycling
    const currentIndex = storage.activeIndex ?? 0;
    let targetIndex = healthyIndices[0]; // fallback default

    // Sequentially search for next healthy index (Round Robin strategy)
    const nextIdxInSequence = healthyIndices.find(idx => idx > currentIndex);
    if (nextIdxInSequence !== undefined) {
      targetIndex = nextIdxInSequence;
    }

    if (targetIndex === currentIndex) {
      console.log(`Current active account (${storage.accounts[currentIndex].email}) is healthy. Remaining sticky.`);
      process.exit(0);
    }

    console.log(`Dynamically auto-rotating CLI credentials...`);
    await doSwitch(targetIndex, storage);
  }

  if (command === 'update') {
    console.log("Checking GitHub for updates...");
    try {
      const scriptDir = dirname(fileURLToPath(import.meta.url));
      console.log(`Executing 'git pull' in local installation directory: ${scriptDir}`);
      const output = execSync("git pull", { cwd: scriptDir, encoding: "utf8" });
      console.log(output);
      console.log("[Success] Standalone switcher CLI updated successfully!");
    } catch (err) {
      console.error(`[Error] Update failed: ${err.message}`);
      process.exit(1);
    }
  }
}

// Global Silent Auto-Update Check
async function triggerBackgroundCheck() {
  const args = process.argv.slice(2);
  if (args[0] === 'update') return; // skip checking if user explicitly called update
  
  try {
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    // Silent check if remote changes exist using git fetch & status
    execSync("git fetch", { cwd: scriptDir, stdio: "ignore" });
    const local = execSync("git rev-parse HEAD", { cwd: scriptDir, encoding: "utf8" }).trim();
    const remote = execSync("git rev-parse @{u}", { cwd: scriptDir, encoding: "utf8" }).trim();
    
    if (local !== remote) {
      console.log("\n[agysw] 🔔 An update was detected on GitHub! Updating plugin automatically...");
      const pullResult = execSync("git pull", { cwd: scriptDir, encoding: "utf8" });
      console.log(pullResult);
      console.log("[agysw] 🎉 Update applied successfully! Please re-run your command.\n");
      process.exit(0);
    }
  } catch (err) {
    // Fail silently on background network or folder checks
  }
}

triggerBackgroundCheck().then(() => main());

