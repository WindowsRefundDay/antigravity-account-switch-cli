# agysw — Antigravity CLI Account Switcher

Manages multiple Google accounts for the **Antigravity CLI (`agy`)**. When one account hits its daily quota, `agysw` rotates to the next healthy one automatically — no re-login required.

**Platforms:** macOS (Keychain) · Linux (libsecret / secret-tool)

---

## How it works

`agy` reads its active session from the system keyring (`service=gemini`, `account=antigravity`).  
`agysw` refreshes the OAuth token for the target account and writes it directly into the keyring.  
The next `agy` command picks it up instantly.

---

## Installation

**As an agy plugin:**
```bash
agy plugin install /path/to/antigravity-account-switch-cli
```

**Standalone:**
```bash
git clone https://github.com/WindowsRefundDay/antigravity-account-switch-cli
ln -s "$(pwd)/antigravity-account-switch-cli/agysw.js" ~/.local/bin/agysw
chmod +x ~/.local/bin/agysw
```

**Recommended shell wrapper** (add to `~/.zshrc` / `~/.bashrc`):
```bash
# Rotates to the next account before every agy session
agy() {
  agysw rotate > /dev/null 2>&1
  /path/to/agy-binary "$@"
}

# Run this when agy says "Individual quota reached"
agycool() {
  agysw cooldown "${1:-4}"
}
```

---

## Commands

| Command | What it does |
|---|---|
| `agysw list` | Show all accounts with active/cooldown status |
| `agysw current` | Show which account is active right now |
| `agysw switch <n\|email>` | Switch to account by index or email address |
| `agysw rotate` | Advance to the next healthy account (uses saved strategy) |
| `agysw cooldown [hours]` | Mark current account exhausted for N hours, then rotate |
| `agysw strategy [name]` | View or set the default rotation strategy |
| `agysw update` | Pull the latest version from GitHub |

---

## Rotation strategies

Set once with `agysw strategy <name>`, or override per-call with `agysw rotate --strategy=<name>`.

| Strategy | Behavior |
|---|---|
| `round-robin` | Advance to next healthy account in order, wrap around at the end *(default)* |
| `random` | Pick a random healthy account each time |
| `sticky` | Stay on the current account until it's exhausted, then switch |
| `least-used` | Always pick whichever healthy account was used longest ago |

```bash
agysw strategy random              # set default
agysw rotate --strategy=sticky     # one-time override
agysw rotate --force               # advance even if only one healthy account exists
```

---

## Handling quota exhaustion

When `agy` returns `Individual quota reached`:

```bash
agycool        # marks current account exhausted for 4h, switches to next healthy account
agycool 2      # same but 2h cooldown
```

Cooldowns are stored in the accounts database and respected by all rotate strategies.

---

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `AGYSW_ACCOUNTS_PATH` | `~/.pi/agent/antigravity-accounts.json` | Path to agy's accounts database |
| `ANTIGRAVITY_CLIENT_ID` | *(bundled)* | Override the OAuth client ID |
| `ANTIGRAVITY_CLIENT_SECRET` | *(bundled)* | Override the OAuth client secret |
