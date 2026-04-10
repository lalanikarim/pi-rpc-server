# RPC Model Test

This directory contains test scripts to verify the RPC protocol works correctly with `pi --mode rpc`.

## Option 1: Direct Subprocess Test (Recommended)

This test starts `pi --mode rpc` directly and speaks the JSONL protocol:

```bash
cd /Users/karim/Projects/ocproject/remote-pi/pi-rpc-server

# Install dependency (if needed)
npm install ws 2>/dev/null || true

# Run the direct test
node test-rpc-direct.js

# With custom provider
node test-rpc-direct.js anthropic

# With custom model
node test-rpc-direct.js anthropic claude-haiku-3-5-20241022

# With API key
node test-rpc-direct.js anthropic claude-sonnet-4-20250514 sk-ant-...

# With custom working directory
node test-rpc-direct.js anthropic /path/to/project
```

## Option 2: WebSocket API Test

This test connects via WebSocket to the FastAPI server:

```bash
# Start server first
cd /Users/karim/Projects/ocproject/remote-pi/pi-rpc-server
uvicorn src.main:app --port 8000 &
sleep 2

# Run the test
node test-rpc.js
```

## Expected Output

You should see the agent start and respond with:

```
============================================================
Direct RPC Protocol Tester for `pi --mode rpc`
============================================================
Provider: anthropic
Model: claude-sonnet-4-20250514
API Key: Not configured
Working Directory: default
============================================================

📋 Command: pi --mode rpc --provider anthropic --model anthropic/claude-sonnet-4-20250514 --thinking medium --no-session

📥 Event: {
  "type": "agent_start"
}
✅ Agent has started

📥 Event: {
  "type": "response",
  "command": "get_available_models",
  "success": true,
  "data": {
    "models": [...],
    "current": {...}
  }
}

📊 Model Fetch Result:
  Success: true
  Models count: 5
  Current model: claude-sonnet-4-20250514

📦 Available Models:
    1. Claude Sonnet 4 (claude-sonnet-4-20250514)
       Provider: anthropic, API: anthropic-messages
```

## Troubleshooting

### "NO MODELS AVAILABLE"

This means the agent hasn't loaded your local model configuration yet.

**Solutions:**

1. **Select a model via TUI first:**
   ```bash
   pi
   /model    # Select any model
   Ctrl+D    # Exit
   ```

2. **Add API key to environment:**
   ```bash
   export PI_API_KEY=sk-ant-your-key
   node test-rpc-direct.js
   ```

3. **Check your agent config directory:**
   ```bash
   ls ~/.pi/agent/
   ls ~/.pi/agent/models.json  # Should exist
   ```

### "Agent process error"

Make sure `pi` command is installed globally:
```bash
which pi  # Should return path
pi --version  # Should show version
```

If not installed:
```bash
npm install -g @mariozechner/pi-coding-agent
```

### "Connection refused" (WebSocket test)

Make sure the server is running:
```bash
# Start server in background
cd /Users/karim/Projects/ocproject/remote-pi/pi-rpc-server
uvicorn src.main:app --port 8000 --reload

# Then run the test in another terminal
node test-rpc.js
```

## What to Share Back

After running the tests, please share:

1. The full output of your test command
2. Your `.env` file contents (mask API keys):
   ```bash
   cat .env
   ```
3. Output from checking your pi configuration:
   ```bash
   pi --session-dir ~/.pi/agent
   ls -la ~/.pi/agent/
   cat ~/.pi/agent/models.json 2>/dev/null || echo "No models file"
   ```

This will help diagnose exactly what's preventing models from appearing!
