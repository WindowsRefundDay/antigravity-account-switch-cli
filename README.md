# Antigravity CLI Multi-Account Switcher & Auto-Rotator (`agysw`)

A high-performance, dynamic, cross-platform keychain credential swapper and Google OAuth session refresher for the **Antigravity CLI (`agy`)**.

## 🌍 Platform Compatibility
* **macOS:** Modifies the system Keyring entries natively utilizing the `security` command line.
* **Linux:** Modifies the system D-Bus Secret Service natively utilizing `secret-tool` (`libsecret-tools`).

---

## 🚀 Installation & Setup

1. Clone or import this plugin inside your local **Antigravity CLI (`agy`)**:
   ```bash
   agy plugin install /path/to/antigravity-account-switch-cli
   ```

2. Verify installation:
   ```bash
   agy plugin list
   ```

---

## 💻 Commands

### 1. List Available Profiles
See all configured accounts in your local pool, identifying the active profile and rate-limit cooldown status:
```bash
node agysw.js list
```

### 2. Manual Profile Switch
Directly switch CLI credentials by specifying the index number or email address:
```bash
# Switch by Index
node agysw.js switch 2

# Switch by Email
node agysw.js switch jojomon23@gmail.com
```

### 3. Dynamic Autoswitch / Auto-rotation
Checks your account health pool, identifies which account is currently active, and automatically switches sequentially to the next healthy account (skipping any in active rate-limit cooldowns):
```bash
node agysw.js rotate
```

---

## 🛠️ How it works
The `agy` CLI retrieves active sessions from standard platform keyring systems under `service="gemini"` and `account="antigravity"`. 

The switcher dynamically fetches the credential database, runs a fast Google API OAuth refresh handshake to renew tokens, builds the appropriate base64 envelope, and natively updates your machine's secure keychain. 
Your next CLI command executes instantly under the target session!
