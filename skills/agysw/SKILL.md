---
name: agysw
description: Multi-account credential manager and switcher for the Antigravity CLI (agy) and systems keyrings.
---

## Commands and Usage

Use the switching script directly within your terminal workspace to swap profiles:

### 1. View all configured Google accounts
```bash
node /Users/joelmanuel/Developer/antigravity-account-switch-cli/agysw.js list
```

### 2. Swap active CLI identity to Account 2
```bash
node /Users/joelmanuel/Developer/antigravity-account-switch-cli/agysw.js switch 2
```

### 3. Swap active CLI identity by Email address
```bash
node /Users/joelmanuel/Developer/antigravity-account-switch-cli/agysw.js switch contact.networkly@gmail.com
```

### 4. Dynamic Auto-rotation (round-robin / random / sticky)
Automatically switches to the next healthy account in the pool if the current one is rate-limited:
```bash
node /Users/joelmanuel/Developer/antigravity-account-switch-cli/agysw.js rotate
```

---

## Technical Concept

The switcher hooks into the secure system credential keys for `agy`:
* macOS Keychain: `service="gemini"`, `account="antigravity"`
* Linux Secret Service: `service="gemini"`, `username="antigravity"`

By running `switch` or `rotate`, it performs an automatic token refresh from the centralized credential database and injects the updated OAuth base64 configuration directly into the keyring of the target machine. This bypasses manual login procedures and updates the active session seamlessly.
