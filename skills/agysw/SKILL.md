---
name: agysw
description: Multi-account credential manager and switcher for the Antigravity CLI (agy) and system keyrings.
---

## Commands

```bash
agysw list                           # show all accounts + status
agysw current                        # show active account
agysw switch <index|email>           # switch to specific account
agysw rotate                         # advance to next healthy account (uses saved strategy)
agysw rotate --strategy=<s>          # one-time: round-robin | random | sticky | least-used
agysw rotate --force                 # advance even if only one healthy account
agysw strategy [round-robin|random|sticky|least-used]  # view or set default strategy
agysw cooldown [hours=4]             # mark current exhausted, rotate to next
agysw update                         # pull latest from GitHub
```

## Shell integration

```bash
# ~/.zshrc or ~/.bashrc
agy() {
  agysw rotate > /dev/null 2>&1
  /path/to/agy-binary "$@"
}

agycool() { agysw cooldown "${1:-4}"; }  # call when quota hit
```

## Rotation strategies

| Strategy | Behavior |
|---|---|
| `round-robin` | Advance to next healthy in sequence, wrap around *(default)* |
| `random` | Pick random healthy account |
| `sticky` | Stay on current if healthy, switch only when exhausted |
| `least-used` | Pick healthy account with oldest lastUsed timestamp |

## How it works

`agy` reads its active session from the system keyring under `service="gemini"`, `account="antigravity"`.
`agysw` refreshes the OAuth token for the target account and writes the `go-keyring-base64:` credential
envelope directly into the platform keyring (macOS Keychain or Linux Secret Service).

## Config

Set `AGYSW_ACCOUNTS_PATH` to override the default accounts database location (`~/.pi/agent/antigravity-accounts.json`).
