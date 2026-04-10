# Implementation Plan: Pi RPC Server

This document provides a comprehensive implementation plan for building a FastAPI server that interfaces with the Pi coding agent via the RPC protocol.

## Overview

### Why RPC Mode?

**RPC (Remote Procedure Call) mode is the optimal choice** for a browser interface because:

1. **Bidirectional Communication**: Full two-way messaging for prompts, commands, and responses
2. **Complete Control API**: Session management, model switching, thinking level control, etc.
3. **Real-time Streaming**: WebSocket-style event streams for live updates
4. **Interactive Features**: Steering, follow-ups, dynamic session handling

JSON mode only provides **unidirectional output** - useful for logging but not for interactive interfaces.

### Architecture Components

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Frontend (Browser)                                                        │
│  - HTML/CSS/JavaScript chat interface                                      │
│  - WebSocket client for real-time updates                                  │
│  - REST API client for configuration                                       │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ WebSocket
                    ┌───────────────┤────────────────┐
                    │               ▼                │
┌───────────────────┴────────────────────────────────┴──────────────────┐
│  FastAPI Server (src/main.py, websocket_handler.py)                   │
│  - WebSocket connection management                                     │
│  - REST API endpoints                                                  │
│  - Session lifecycle management                                        │
│  - Event routing between browser and agent                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ asyncio subprocess
                    ┌───────────────┤────────────────┐
                    │               ▼                │
┌───────────────────┴────────────────────────────────┴──────────────────┐
│  Pi Subprocess (pi --mode rpc)                                        │
│  - Managed by src/pi_agent.py                                          │
│  - RPC protocol implementation (JSONL framing)                         │
│  - Command/response correlation                                        │
│  - Event streaming                                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Project Setup (0.5 days)

### Step 1.1: Initialize uv Project

**Actions:**
```bash
mkdir pi-rpc-server
cd pi-rpc-server
uv init
uv add fastapi uvicorn python-multipart websockets pydantic python-dotenv aiofiles markdown pyyaml
uv add -E dev pytest pytest-asyncio httpx mypy
```

**Files created:**
- `pyproject.toml` - Project configuration
- `uv.lock` - Dependency lock file

### Step 1.2: Project Structure

**Directory layout:**
```
pi-rpc-server/
├── src/
│   ├── __init__.py
│   ├── config.py
│   ├── pi_agent.py
│   ├── websocket_handler.py
│   ├── api.py
│   └── main.py
├── static/
│   └── index.html
├── tests/
│   └── conftest.py
├── .env.example
├── .gitignore
├── pyproject.toml
└── README.md
```

---

## Phase 2: Core Pi Agent Manager (1.5 days)

### Step 2.1: Define Schema Classes (src/config.py)

**Purpose**: Central configuration management

**Key classes:**
```python
@dataclass
class PiAgentConfig:
    """Configuration for pi coding agent subprocess."""
    api_key: Optional[str]
    provider: str
    model: str
    thinking_level: str
    session_dir: Optional[str]
    no_session: bool

@dataclass
class PiRPCConfig:
    """Low-level RPC configuration for subprocess."""
    provider: str
    model: str
    thinking_level: str
    session_dir: Optional[str]
    no_session: bool
    api_key: Optional[str]
```

**Implementation features:**
- Load from `.env` file
- Environment variable overrides
- YAML extensions configuration
- Validation via Pydantic

### Step 2.2: Implement RPC Protocol Client (src/pi_agent.py)

**Purpose**: Manage Pi subprocess and protocol communication

**Core class - `PiSubprocess`**:

```python
class PiSubprocess:
    """Manages pi --mode rpc subprocess and RPC protocol."""
    
    # Lifecycle
    async def start(self) -> str
    async def stop(self) -> None
    
    # Protocol communication
    async def send_command(self, command: dict) -> dict
    async def get_events(self) -> AsyncGenerator[dict, None]
    
    # Query operations
    async def get_state(self) -> dict
    async def send_command_raw(command: dict) -> dict
```

**Critical implementation details:**

1. **Subprocess Management**
   ```python
   self._process = await asyncio.create_subprocess_exec(
       *cmd,
       stdin=asyncio.subprocess.PIPE,
       stdout=asyncio.subprocess.PIPE,
   )
   ```

2. **Event Reader - Custom JSONL Parsing**
   ```python
   async def _read_events(self) -> None:
       buffer = ""
       while self._running:
           data = await self._reader.read(4096)
           buffer += data.decode("utf-8", errors="replace")
           
           # Split on LF only (critical!)
           while "\n" in buffer:
               line, buffer = buffer.split("\n", 1)
               
               # Handle CRLF compatibility
               if line.endswith("\r"):
                   line = line[:-1]
               
               event = json.loads(line)
               await self._event_queue.put(event)
   ```

3. **Request/Response Correlation**
   ```python
   async def send_command(self, command: dict) -> dict:
       command_id = command.get("id", str(uuid.uuid4()))
       command["id"] = command_id
       
       future = asyncio.get_event_loop().create_future()
       self._response_callbacks[command_id] = future
       
       # Write command
       line = json.dumps(command) + "\n"
       self._writer.write(line.encode("utf-8"))
       await self._writer.drain()
       
       return await future
   ```

4. **Error Handling**
   - Catch JSON parse errors gracefully
   - Reconnect on connection loss
   - Graceful shutdown on EOF

### Step 2.3: Wrap RPC Commands

**Helper methods for common operations:**

```python
async def prompt(
    self,
    message: str,
    images: list | None = None,
    streaming_behavior: str | None = None
) -> dict:
    cmd = {"type": "prompt", "message": message}
    if images:
        cmd["images"] = images
    if streaming_behavior:
        cmd["streamingBehavior"] = streaming_behavior
    return await self.send_command(cmd)

async def steer(self, message: str) -> dict:
    return await self.send_command({"type": "steer", "message": message})

async def follow_up(self, message: str) -> dict:
    return await self.send_command({"type": "follow_up", "message": message})

async def set_model(self, provider: str, model_id: str) -> dict:
    return await self.send_command({
        "type": "set_model",
        "provider": provider,
        "modelId": model_id
    })

async def set_thinking_level(self, level: str) -> dict:
    return await self.send_command({
        "type": "set_thinking_level",
        "level": level
    })

async def bash(self, command: str) -> dict:
    return await self.send_command({"type": "bash", "command": command})

async def get_session_stats(self) -> dict:
    return await self.send_command({"type": "get_session_stats"})
```

---

## Phase 3: WebSocket Event Stream (1 day)

### Step 3.1: WebSocket Manager (src/websocket_handler.py)

**Purpose**: Manage WebSocket connections and route events

**Core class - `WebSocketManager`**:

```python
class WebSocketManager:
    """Manages WebSocket connections and session lifecycle."""
    
    def __init__(self):
        self._sessions: dict[str, WebSocketSession] = {}
        
    async def connect(
        self,
        session_id: str,
        websocket: WebSocket
    ) -> WebSocketSession:
        await websocket.accept()
        session = WebSocketSession(
            id=session_id,
            websocket=websocket,
            agent=PiSubprocess(config)
        )
        self._sessions[session_id] = session
        asyncio.create_task(self._stream_events(session_id))
        return session
    
    async def route_command_to_agent(
        self,
        session_id: str,
        command: dict
    ) -> Any:
        session = self._sessions.get(session_id)
        return await session.agent.send_command(command)
```

### Step 3.2: WebSocket Handler Endpoint

**Implementation**:

```python
@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for real-time communication."""
    session = await manager.connect(session_id, websocket)
    
    try:
        async for message in websocket.iter_json():
            # Route to agent
            if message.get("type") == "command":
                result = await manager.route_command_to_agent(
                    session_id, 
                    message.get("command")
                )
                await manager.send_json(session_id, result)
    except ConnectionClosed:
        pass
    finally:
        await manager.disconnect(session_id)
```

### Step 3.3: Heartbeat/Ping Support

```python
async def _ping_session(self, session_id: str) -> None:
    """Send periodic pings to maintain connection."""
    while session in self._sessions:
        await asyncio.sleep(30)  # 30 second interval
        await session.websocket.ping()
```

---

## Phase 4: FastAPI REST API (1.5 days)

### Step 4.1: Pydantic Models

**Request/Response Validation:**

```python
class ModelSelection(BaseModel):
    provider: str
    model_id: str

class ThinkingLevel(BaseModel):
    level: str = Field(
        pattern="^(off|minimal|low|medium|high|xhigh)$"
    )

class CompactRequest(BaseModel):
    session_id: str
    custom_instructions: str | None = None

class BashRequest(BaseModel):
    command: str
```

### Step 4.2: API Routes (src/api.py)

**Session endpoints:**

```python
@router.post("/sessions")
async def create_session(config: ModelSelection):
    """Create new pi agent session."""
    session_id = str(uuid.uuid4())
    pi_config = PiRPCConfig(...)
    
    await manager.connect(session_id, None)
    await agent.start(pi_config)
    
    return {"session_id": session_id, "status": "started"}

@router.get("/sessions")
async def list_sessions():
    """List active sessions."""
    return {
        "sessions": [
            {"id": sid, "active": sa.agent.is_active}
            for sid, sa in manager._sessions.items()
        ]
    }
```

**Model endpoints:**

```python
@router.post("/models/current")
async def set_model(session_id: str, config: ModelSelection):
    """Set current model."""
    agent = await _get_session_agent(session_id)
    
    result = await agent.send_command({
        "type": "set_model",
        "provider": config.provider,
        "modelId": config.model_id
    })
    
    return {"success": result.get("success")}

@router.post("/models/current/cycle")
async def cycle_model(session_id: str):
    """Cycle to next available model."""
    agent = await _get_session_agent(session_id)
    result = await agent.send_command({"type": "cycle_model"})
    return result
```

**All endpoints to implement:**

| Endpoint | Method | Function |
|----------|--------|----------|
| `/sessions` | POST | Create session |
| `/sessions` | GET | List sessions |
| `/sessions/{id}` | GET | Get session info |
| `/sessions/{id}` | DELETE | Delete session |
| `/sessions/{id}/fork` | POST | Fork session |
| `/models/current` | POST | Set model |
| `/models/current/cycle` | POST | Cycle model |
| `/thinking-level` | PUT | Set level |
| `/thinking-level/cycle` | PUT | Cycle level |
| `/sessions/{id}/compact` | POST | Compact context |
| `/bash` | POST | Execute command |
| `/sessions/{id}/state` | GET | Get session state |
| `/sessions/{id}/stats` | GET | Get session stats |
| `/sessions/{id}/export` | POST | Export HTML |

---

## Phase 5: Frontend Interface (2 days)

### Step 5.1: Basic HTML/CSS

```html
<!DOCTYPE html>
<html>
<head>
    <style>
        :root {
            --bg-primary: #1e1e1e;
            --bg-secondary: #252526;
            --text-primary: #d4d4d4;
        }
        
        body {
            background-color: var(--bg-primary);
            color: var(--text-primary);
        }
        
        .message {
            padding: 0.75rem 1rem;
            border-radius: 8px;
        }
        
        .message.user {
            background-color: var(--accent);
            align-self: flex-end;
        }
        
        .message.assistant {
            background-color: var(--bg-secondary);
        }
    </style>
</head>
<body>
    <div id="message-history"></div>
    <div class="editor">
        <textarea id="prompt-input"></textarea>
        <button id="send-btn">Send</button>
    </div>
</body>
</html>
```

### Step 5.2: JavaScript Client

```javascript
class PiClient {
    constructor(sessionId) {
        this.sessionId = sessionId;
        this.ws = null;
        this.connect();
    }
    
    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.ws = new WebSocket(`${protocol}//${window.location.host}/ws/${this.sessionId}`);
        
        this.ws.onopen = () => {
            console.log('Connected!');
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleEvent(data);
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
        
        this.ws.onclose = () => {
            // Auto-reconnect logic
            setTimeout(() => this.connect(), 1000);
        };
    }
    
    sendMessage(message) {
        this.ws.send(JSON.stringify({
            type: "command",
            command: {
                type: "prompt",
                message: message,
                streamingBehavior: "steer"
            }
        }));
    }
    
    handleEvent(event) {
        switch(event.type) {
            case 'message_update':
                this.renderMessageUpdate(event);
                break;
            case 'agent_end':
                this.renderAgentEnd(event);
                break;
            case 'tool_execution_start':
                this.renderToolStart(event);
                break;
        }
    }
    
    renderMessageUpdate(event) {
        const delta = event.assistantMessageEvent.delta;
        // Append to last assistant message or create new
    }
}
```

### Step 5.3: Feature Enhancements

1. **Markdown Rendering**: Use `marked.js` for message parsing
2. **Syntax Highlighting**: Use `highlight.js` for code blocks
3. **Thinking Blocks**: Separate styling, expand/collapse toggle
4. **Tool Visualization**: Show tool calls/results with syntax highlighting
5. **Session Management**: Dropdown to switch between sessions
6. **History**: Persist conversation in localStorage

---

## Phase 6: Advanced Features (2 days)

### Step 6.1: Image Upload Support

```python
@router.post("/upload")
async def upload_image(file: UploadFile) -> dict:
    """Upload image file, return base64 data."""
    contents = await file.read()
    mime_type = file.content_type or "image/jpeg"
    
    # Save temporarily
    filename = f"upload_{uuid.uuid4()}.jpg"
    filepath = UPLOAD_DIR / filename
    filepath.write_bytes(contents)
    
    # Encode base64
    data = base64.b64encode(contents).decode("utf-8")
    
    return {
        "data": data,
        "mimeType": mime_type,
        "id": str(uuid.uuid4()),
        "fileName": filename,
        "size": len(contents)
    }
```

### Step 6.2: Multiple Sessions

```python
# Session selector in UI
class SessionManager:
    active_session: str
    sessions: dict[str, WebSocketConnection]
    
    def switch_session(self, session_id: str):
        # Close old WebSocket
        await self.current_ws.close()
        
        # Create new connection
        self.ws = WebSocket(f'/ws/{session_id}')
        self.ws.onmessage = self.handle_message
        
        # Fetch session state
        state = await fetch(`/api/sessions/${session_id}/state`)
```

### Step 6.3: Server-Sent Events (SSE)

Alternative to WebSockets for one-way streaming:

```python
@router.get("/events/{session_id}")
async def stream_events(session_id: str):
    """Stream events via SSE."""
    async def event_generator():
        while session_manager.is_connected(session_id):
            event = await get_session_event(session_id)
            yield f"event: message\nid: {event['id']}\n"
            yield f"data: {json.dumps(event)}\n\n"
            await asyncio.sleep(0.1)
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream"
    )
```

---

## Phase 7: Security & Production (1 day)

### Step 7.1: Security Measures

```python
# Rate limiting
from slowapi import Limiter
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@limiter.limit("100/minute")
@router.post("/sessions")
...

# Input sanitization
def sanitize_bash_command(cmd: str) -> str:
    """Prevent command injection."""
    dangerous_chars = [';', '|', '&', '$', '`', '(', ')', '{', '}']
    for char in dangerous_chars:
        if char in cmd:
            raise ValueError("Invalid characters in command")
    return cmd

# File upload limits
@app.post("/upload")
async def upload_image(file: UploadFile):
    MAX_SIZE = 10 * 1024 * 1024  # 10MB
    
    contents = await file.read()
    if len(contents) > MAX_SIZE:
        raise HTTPException(status_code=413)
```

### Step 7.2: CORS Configuration

```python
from fastapi.middleware.cors import CORSMiddleware

origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://yourdomain.com",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### Step 7.3: Production Logging

```python
from loguru import logger

logger.add(
    "logs/pi-rpc-server-{date}.log",
    rotation="10 MB",
    retention="7 days",
    level="DEBUG"
)
```

### Step 7.4: Process Supervision

**Systemd example:**
```ini
[Unit]
Description=Pi RPC Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/opt/pi-rpc-server
ExecStart=/opt/pi-rpc-server/venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 8000 --workers 4
Restart=always

[Install]
WantedBy=multi-user.target
```

---

## Phase 8: Testing (1 day)

### Step 8.1: Unit Tests

```python
# tests/test_pi_agent.py

import pytest
from src.pi_agent import PiSubprocess, RPCProtocolError

@pytest.fixture
def mock_subprocess():
    """Create a mock for subprocess testing."""
    pass

@pytest.mark.asyncio
async def test_agent_start():
    config = PiRPCConfig(..., no_session=True)
    agent = PiSubprocess(config)
    
    session_id = await agent.start()
    assert session_id is not None
    assert agent.is_active

@pytest.mark.asyncio
async def test_send_command():
    agent = ...
    result = await agent.send_command({
        "type": "prompt",
        "message": "test"
    })
    assert result.get("success") is True
```

### Step 8.2: Integration Tests

```python
# tests/test_integration.py

import pytest
import httpx
from src.config import create_config

@pytest.fixture
async def client():
    async with AsyncClient(
        app=app,
        base_url="http://test"
    ) as ac:
        yield ac

@pytest.mark.asyncio
async def test_create_session(client):
    response = await client.post(
        "/api/sessions",
        json={
            "provider": "anthropic",
            "model_id": "claude-sonnet-4-20250514"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert "session_id" in data

@pytest.mark.asyncio
async def test_websocket_communication(client):
    async with client.websocket_connect("/ws/test-session") as ws:
        # Send command
        await ws.send_json({
            "type": "command",
            "command": {
                "type": "prompt",
                "message": "Hello"
            }
        })
        
        # Receive response
        msg = await ws.receive_json()
        assert msg.get("id") is not None
```

### Step 8.3: End-to-End Tests

Test complete user flows:
1. Create session → send prompt → receive response → compile stats
2. Model switching → verification
3. Thinking level changes → verification
4. Bash command execution → result parsing

---

## Timeline & Milestones

| Phase | Duration | Key Deliverables |
|-------|---------|------------------|
| **Phase 1** | 0.5 days | uv project setup, dependencies |
| **Phase 2** | 1.5 days | PiSubprocess class, RPC protocol |
| **Phase 3** | 1 day | WebSocket manager & endpoint |
| **Phase 4** | 1.5 days | REST API with all endpoints |
| **Phase 5** | 2 days | Basic HTML/JS frontend |
| **Phase 6** | 2 days | Advanced features (upload, multi-session) |
| **Phase 7** | 1 day | Security hardening, production setup |
| **Phase 8** | 1 day | Tests (unit, integration, e2e) |

**Total: ~10 days for production-ready MVP**

---

## Risk Mitigation

### Potential Issues & Solutions

1. **RPC Protocol Parsing Errors**
   - **Risk**: Misaligned JSONL streams
   - **Solution**: Strict LF framing, re-sync on parse error, connection reset

2. **Websocket Reconnection**
   - **Risk**: Lost connection during processing
   - **Solution**: Auto-reconnect with exponential backoff, session state recovery

3. **Multiple Concurrent Sessions**
   - **Risk**: Resource exhaustion
   - **Solution**: Session limits (max 5 concurrent), proper cleanup on disconnect

4. **Agent Crashes**
   - **Risk**: Subprocess dies unexpectedly
   - **Solution**: Detect EOF, auto-restart with same session ID, state restoration

5. **Memory Pressure**
   - **Risk**: Growing session memory
   - **Solution**: Automatic compaction, session expiration (TTL)

---

## Open Questions & Decisions

### Architecture Decisions Made

1. **State Management**: Use in-memory dict keyed by session UUID
   - Pros: Fast access, simple implementation
   - Cons: Not persistent across restarts
   - Mitigation: Auto-save session state every N minutes

2. **WebSocket vs SSE**: Choose WebSocket
   - Pros: Bidirectional, true real-time, easier command flow
   - Cons: Slightly more complex
   - Alternative: SSE for pure observation use cases

3. **Subprocess Lifecycle**: Long-lived per session
   - Pros: Reuse agent state, faster response times
   - Cons: Resource consumption
   - Mitigation: Session timeout after inactivity

### Decisions Pending

1. **Authentication**: API key via .env or per-connection JWT?
2. **Session Persistence**: Redis backend for multi-server deployment?
3. **Database**: Store session history in SQLite/PostgreSQL?
4. **File Storage**: S3/EFS for image uploads?

---

## Future Enhancements

1. **MCP Server Integration**: Allow pi to interact with external services
2. **Multi-Model Fallback**: Automatic switch if provider fails
3. **Cost Estimation**: Pre-calculate prompt costs before sending
4. **Caching**: Redis for shared session state across workers
5. **Dashboard**: Real-time metrics (tokens, cost, latency)
6. **CLI Tools**: `pi-rpc-cli` for command-line sessions
7. **Mobile App**: React Native/Flutter client
8. **Docker Compose**: One-command deployment

---

## Quick Start Commands

```bash
# Setup
cd pi-rpc-server
uv sync
npm install -g @mariozechner/pi-coding-agent
cp .env.example .env
# Edit .env with your API key

# Development
uv run uvicorn src.main:app --reload

# Production
uv run uvicorn src.main:app --host 0.0.0.0 --port 8000 --workers 4

# Testing
uv run pytest -xvs
```

---

## References

- [Pi RPC Mode Docs](https://github.com/badlogic/pi-mono/blob/main/docs/rpc.md)
- [Pi JSON Mode Docs](https://github.com/badlogic/pi-mono/blob/main/docs/json.md)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Asyncio Best Practices](https://docs.python.org/3/library/asyncio.html)
- [WebSocket RFC 6455](https://datatracker.ietf.org/doc/html/rfc6455)
