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

// Default path matches where agy stores its accounts database.
// Override with AGYSW_ACCOUNTS_PATH env var if your install differs.
const ACCOUNTS_PATH = process.env.AGYSW_ACCOUNTS_PATH
  || join(os.homedir(), '.pi', 'agent', 'antigravity-accounts.json');

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
    storage.accounts[index].lastUsed = Date.now();
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
  node agysw.js list                           - List all profiles with status
  node agysw.js current                        - Show active account
  node agysw.js switch <index|email>           - Switch to specific account
  node agysw.js rotate                         - Rotate using current strategy (default: round-robin)
  node agysw.js rotate --strategy=<s>          - Rotate with specific strategy (one-time)
  node agysw.js rotate --force                 - Force advance even if only one healthy account
  node agysw.js strategy [round-robin|random|sticky|least-used]
                                               - View or set default rotation strategy
  node agysw.js cooldown [hours=4]             - Mark current exhausted, rotate to next
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
    const force = args.includes('--force');
    // --strategy=round-robin|random|sticky|least-used (default: round-robin)
    const strategyArg = args.find(a => a.startsWith('--strategy='));
    const strategy = strategyArg ? strategyArg.split('=')[1] : (storage.rotateStrategy || 'round-robin');

    const now = Date.now();
    const healthyEntries = storage.accounts
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => !a.disabled && (!a.cooldownUntil || a.cooldownUntil < now));

    if (healthyEntries.length === 0) {
      console.error("Error: All accounts are in rate-limit cooldown. Cannot rotate.");
      process.exit(1);
    }

    const healthyIndices = healthyEntries.map(({ i }) => i);
    const currentIndex = storage.activeIndex ?? 0;
    let targetIndex;

    if (strategy === 'sticky') {
      // Stay on current if healthy; only switch if exhausted
      if (healthyIndices.includes(currentIndex)) {
        process.exit(0); // already on healthy, stay
      }
      const next = healthyIndices.find(i => i > currentIndex) ?? healthyIndices[0];
      targetIndex = next;

    } else if (strategy === 'random') {
      // Pick random healthy account (excluding current unless only option)
      const others = healthyIndices.filter(i => i !== currentIndex);
      const pool = others.length > 0 ? others : healthyIndices;
      targetIndex = pool[Math.floor(Math.random() * pool.length)];

    } else if (strategy === 'least-used') {
      // Pick healthy account with oldest lastUsed timestamp
      const candidates = healthyEntries.filter(({ i }) => i !== currentIndex || healthyEntries.length === 1);
      candidates.sort((a, b) => (a.a.lastUsed || 0) - (b.a.lastUsed || 0));
      targetIndex = candidates[0].i;

    } else {
      // Default: round-robin — always advance to next healthy past current
      const next = healthyIndices.find(i => i > currentIndex);
      targetIndex = next !== undefined ? next : healthyIndices[0]; // wrap around
    }

    if (targetIndex === currentIndex && !force) {
      // Only one healthy account — no choice but to stay
      process.exit(0);
    }

    await doSwitch(targetIndex, storage);
  }

  if (command === 'strategy') {
    // Persist the default rotate strategy
    const newStrategy = args[1];
    const valid = ['round-robin', 'random', 'sticky', 'least-used'];
    if (!newStrategy || !valid.includes(newStrategy)) {
      const current = storage.rotateStrategy || 'round-robin';
      console.log(`Current strategy: ${current}`);
      console.log(`Valid strategies: ${valid.join(', ')}`);
      process.exit(0);
    }
    storage.rotateStrategy = newStrategy;
    await writeAccountsStorage(storage);
    console.log(`[agysw] Rotate strategy set to: ${newStrategy}`);
    process.exit(0);
  }

  if (command === 'cooldown') {
    // Mark current account as rate-limited and rotate to next healthy account
    const hours = parseFloat(args[1]) || 4;
    const cooldownUntil = Date.now() + hours * 60 * 60 * 1000;
    const currentIndex = storage.activeIndex ?? 0;
    const currentAccount = storage.accounts[currentIndex];
    if (!currentAccount) {
      console.error("Error: No active account found.");
      process.exit(1);
    }
    currentAccount.cooldownUntil = cooldownUntil;
    await writeAccountsStorage(storage);
    console.log(`[agysw] Marked ${currentAccount.email} on cooldown for ${hours}h (until ${new Date(cooldownUntil).toLocaleTimeString()}).`);

    // Now rotate to next healthy
    const now = Date.now();
    const healthyIndices = storage.accounts
      .map((a, i) => ({ a, i }))
      .filter(({ a, i }) => i !== currentIndex && !a.disabled && (!a.cooldownUntil || a.cooldownUntil < now))
      .map(({ i }) => i);

    if (healthyIndices.length === 0) {
      console.error("[agysw] No healthy accounts remaining. All on cooldown.");
      process.exit(1);
    }

    // Pick next healthy account after current
    const next = healthyIndices.find(i => i > currentIndex) ?? healthyIndices[0];
    await doSwitch(next, storage);
  }

  if (command === 'current') {
    const idx = storage.activeIndex ?? 0;
    const acc = storage.accounts[idx];
    if (!acc) { console.log("No active account."); process.exit(0); }
    const now = Date.now();
    const cd = acc.cooldownUntil && acc.cooldownUntil > now;
    console.log(`Active: ${idx + 1}. ${acc.email}${cd ? ` (COOLDOWN until ${new Date(acc.cooldownUntil).toLocaleTimeString()})` : ' ✓'}`);
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

