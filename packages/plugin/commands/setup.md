---
allowed-tools: Bash(mkdir:*), Bash(cat:*), Bash(chmod:*), Bash(curl:*), AskUserQuestion
description: Configure DevScope plugin (server URL and API key)
---

## Your task

Help the user configure the DevScope plugin by writing a config file to `~/.config/devscope/config`.

Ask the user two questions using AskUserQuestion:

1. **Server URL**: What is the DevScope server URL?
   - Options: "http://localhost:3001" (local development), "Custom URL" (enter their own)

2. **API key**: Does the server require an API key?
   - Options: "No API key", "Enter API key"

Then create the config file:

```bash
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/devscope"
cat > "${XDG_CONFIG_HOME:-$HOME/.config}/devscope/config" <<EOF
DEVSCOPE_URL=<url>
DEVSCOPE_API_KEY=<key or empty>
EOF
chmod 600 "${XDG_CONFIG_HOME:-$HOME/.config}/devscope/config"
```

After writing the config, test the connection:

```bash
curl -sf --max-time 5 "<url>/api/health"
```

Report whether the connection succeeded or failed.
