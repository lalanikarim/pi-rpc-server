# Getting Started with Pi RPC Server

## Server Status

✅ **Running**: http://localhost:8000

## Quick Start

### 1. Open the Web Interface

Open your browser to:
```
http://localhost:8000
```

You'll see:
- Connection status (top-right)
- Chat message history (center)
- Input area (bottom)

### 2. Connect to Pi Agent

The JavaScript automatically:
1. Connects to WebSocket `/ws/{session_id}`
2. Creates a Pi agent session via REST API
3. Shows "Connected to Pi Agent" when ready

### 3. Start Typing

- **Type your first message** in the input box
- **Press Enter** to send (Shift+Enter for new line)
- **Watch the agent think** and respond!

## Important: API Key Configuration

Before sending messages, edit `.env`:

```bash
cd /Users/karim/Projects/ocproject/remote-pi/pi-rpc-server
nano .env
```

Change:
```env
PI_API_KEY=YOUR_API_KEY_HERE
```

To your actual Anthropic API key:
```env
PI_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Then restart the server:
```bash
pkill -f uvicorn
uv run uvicorn src.main:app --port 8000
```

## Example Usage

```
1. Visit http://localhost:8000
   → Status: "Disconnected"

2. Wait for connection
   → Status: "Connected to Pi Agent"

3. Type: "List files in current directory"
   → Type: "Agent is thinking..."
   → Agent responds with file list
```

## Working Directory

By default, Pi runs in the **server directory**.

To use a specific project folder:

1. Edit `static/index.html` or `static/app.js`
2. Modify the session creation to include `cwd`:
```javascript
fetch(`${this.baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        provider: 'anthropic',
        model_id: 'claude-sonnet-4-20250514',
        cwd: '/path/to/your/project'  // Add this line
    })
})
```

## Troubleshooting

### Shows "Disconnected" forever

**Check the browser console** (F12) for errors.

Possible causes:
1. Not connected to Pi agent
2. API key not configured
3. WebSocket connection failed

### Agent doesn't respond after typing

**Possible causes**:
1. Missing/n invalid API key
2. Network issues with API provider
3. Agent is still processing

## REST API

Session management endpoints:
- `POST /api/sessions` - Create session
- `GET /api/sessions` - List sessions
- `GET /api/sessions/{id}/stats` - Get token usage
- `GET /api/sessions/{id}/state` - Get session state
- `DELETE /api/sessions/{id}` - Delete session

## Next Steps

1. **Add your API key** to `.env`
2. **Try a simple prompt** like "Hello" or "List files"
3. **Explore the agent's capabilities** with bash commands, file reading, etc.

## Server Logs

View server logs in the terminal where uvicorn is running.

## Stopping the Server

Press `Ctrl+C` in the terminal where uvicorn is running.

## Restarting

```bash
cd /Users/karim/Projects/ocproject/remote-pi/pi-rpc-server
uv run uvicorn src.main:app --port 8000
```
