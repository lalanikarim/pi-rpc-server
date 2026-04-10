# Pi RPC Server

A FastAPI server for the Pi coding agent using the RPC protocol. This provides a WebSocket-based interface for the browser to interact with Pi's agent capabilities.

## Why RPC Mode?

**RPC mode is the most suitable choice** because:

- **Bidirectional communication**: Send prompts, commands, and receive responses in real-time
- **Full API access**: Control sessions, models, thinking levels, session management
- **Event streaming**: Get real-time updates on agent processing, tool execution, streaming output
- **Interactive**: Supports steering, follow-ups, and dynamic session control

JSON mode would only allow observation (unidirectional), which isn't sufficient for an interactive browser interface.

## Architecture

```
┌─────────────┐     WebSocket      ┌──────────────┐     Subprocess     ┌─────────────┐
│   Browser   │◄─────────────────►│   FastAPI    │◄─────────────────►│   Pi Agent  │
│             │                    │   Server     │                    │  (RPC mode) │
└─────────────┘                    └──────────────┘                    └─────────────┘
                            REST API
                           (for config)
```

- **FastAPI Server**: Handles WebSocket connections and REST API
- **WebSocket Manager**: Routes messages between browser and Pi subprocess
- **Pi Agent Manager**: Manages the `pi --mode rpc` subprocess and RPC protocol

## Project Structure

```
pi-rpc-server/
├── pyproject.toml              # uv project config & dependencies
├── uv.lock                     # lock file (auto-generated)
├── .env.example                # environment variable template
├── .gitignore                  # git ignore rules
├── requirements.txt            # auto-generated
├── src/
│   ├── __init__.py             # package marker
│   ├── config.py               # Configuration management
│   ├── pi_agent.py             # Pi subprocess & RPC protocol client
│   ├── websocket_handler.py    # WebSocket event streaming
│   ├── api.py                  # FastAPI REST API routes
│   └── main.py                 # Server entry point
├── static/
│   └── index.html              # Simple frontend UI
└── tests/
    └── conftest.py             # Test fixtures
```

## Quick Start

### 1. Install Dependencies

```bash
cd pi-rpc-server

# Check if uv is installed
uv --version

# Install project dependencies
uv sync

# Install pi-coding-agent globally
npm install -g @mariozechner/pi-coding-agent
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```env
PI_API_KEY=sk-ant-<your-anthropic-api-key>
PI_PROVIDER=anthropic
PI_MODEL=claude-sonnet-4-20250514
PI_THINKING_LEVEL=medium
```

### 3. Run Development Server

```bash
uv run uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

Visit `http://localhost:8000` in your browser.

### 4. Production Deployment

```bash
# Build and run with multiple workers
uv run uvicorn src.main:app --host 0.0.0.0 --port 8000 --workers 4

# Use a process supervisor (systemd, supervisor, or Docker)
```

## API Reference

### WebSocket Endpoint

`WebSocket /ws/{session_id}`

Connect to get real-time event streaming and send commands.

**Command format:**
```json
{
  "type": "command",
  "command": {
    "type": "prompt",
    "message": "What's in this directory?",
    "streamingBehavior": "steer"
  }
}
```

**Example messages received:**
```json
// Message streaming
{
  "type": "message_update",
  "message": {...},
  "assistantMessageEvent": {
    "type": "text_delta",
    "delta": "Here's the content..."
  }
}

// Agent complete
{
  "type": "agent_end",
  "messages": [
    {...assistant message...}
  ]
}
```

### REST Endpoints

#### Session Management

- `POST /api/sessions` - Create new session
  ```json
  {
    "provider": "anthropic",
    "model_id": "claude-sonnet-4-20250514"
  }
  ```

- `GET /api/sessions` - List active sessions

- `GET /api/sessions/{id}` - Get session info

- `DELETE /api/sessions/{id}` - Delete session

#### Model Configuration

- `POST /api/models/current` - Set model
  ```json
  {
    "provider": "anthropic",
    "model_id": "claude-sonnet-4-20250514"
  }
  ```

- `POST /api/models/current/cycle` - Cycle to next model

#### Thinking Level

- `PUT /api/thinking-level` - Set level
  ```json
  { "level": "high" }
  ```

- `PUT /api/thinking-level/cycle` - Cycle levels

#### Compaction

- `POST /api/sessions/{id}/compact` - Compact conversation
  ```json
  {
    "session_id": "abc123",
    "custom_instructions": "Focus on code analysis"
  }
  ```

#### Bash Commands

- `POST /api/bash` - Execute bash command
  ```json
  { "command": "ls -la" }
  ```

#### Session Queries

- `GET /api/sessions/{id}/state` - Current session state
- `GET /api/sessions/{id}/stats` - Token usage and cost
- `GET /api/sessions/{id}/fork-messages` - Available fork points
- `POST /api/sessions/{id}/export` - Export to HTML

### Event Types

Events stream to the WebSocket in real-time:

| Event Type | Description |
|------------|-------------|
| `agent_start` | Agent begins processing |
| `agent_end` | Agent completes |
| `turn_start` / `turn_end` | Turn lifecycle |
| `message_start` / `message_update` / `message_end` | Message lifecycle |
| `tool_execution_start` / `tool_execution_update` / `tool_execution_end` | Tool execution |
| `queue_update` | Pending message queue changed |
| `compaction_start` / `compaction_end` | Compaction events |

See [RPC mode docs](docs/rpc.md) for full event schema.

## Frontend

The included `static/index.html` provides a basic chat interface with:

- Real-time message streaming
- Separate styling for user/assistant/tool messages
- Basic thinking block support
- Connection status indicator
- Clear button

### Custom Frontend

For full customization, connect to WebSocket:

```javascript
// Connect
const ws = new WebSocket(`ws://localhost:8000/ws/${sessionId}`);

// Send command
ws.send(JSON.stringify({
  type: "command",
  command: {
    type: "prompt",
    message: "Your message here"
  }
}));

// Receive events
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "message_update") {
    console.log("Streaming:", data.assistantMessageEvent.delta);
  } else if (data.type === "agent_end") {
    console.log("Complete!");
  }
};
```

## RPC Protocol Details

The RPC protocol uses **strict LF-delimited JSONL** framing:
- Each command/response/event is on its own line
- Delimiter is `\n` only (not `\r\n`)
- Do NOT use generic line readers (they split on Unicode separators inside JSON)

**Example command:**
```json
{"id": "req-1", "type": "prompt", "message": "Hello!"}
```

**Example response:**
```json
{"id": "req-1", "type": "response", "command": "prompt", "success": true}
```

See `src/pi_agent.py` for the full protocol implementation.

## Testing

```bash
# Run tests
uv run pytest -xvs

# Type checking
uv run mypy src/

# Format code
uv run ruff format src/
uv run ruff check src/
```

## Development Plan

See the companion doc [IMPLEMENTATION_PLAN.md](../docs/IMPLEMENTATION_PLAN.md) for complete implementation details and timeline.

## Docker Deployment

```dockerfile
FROM node:20-alpine AS pi-builder
RUN npm install -g @mariozechner/pi-coding-agent

FROM python:3.12-alpine
RUN apk add --no-cache bash nodejs npm
COPY --from=pi-builder /usr/local/lib/node_modules /usr/local/lib/node_modules
WORKDIR /app
COPY . .
RUN uv sync --frozen
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

## Security Considerations

- API keys are read from environment variables (`.env` file)
- WebSocket connections require session management
- Bash commands should be sanitized to prevent injection
- File uploads should have size limits
- CORS is configurable via environment variables

## License

MIT
