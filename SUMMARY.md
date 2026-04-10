# Pi RPC Server Implementation Summary

## Quick Decision: RPC Mode

**RPC (`--mode rpc`) is the right choice** for a browser interface because:

| Feature | RPC Mode | JSON Mode |
|------|------|-----|
| Bidirectional | ✅ Send & receive | ❌ Receive only |
| Interactive | ✅ Full control | ⚠️ Read-only |
| Sessions | ✅ Create, manage, switch | ❌ None |
| Commands | ✅ All RPC commands available | ❌ Not available |
| Event Streaming | ✅ WebSocket-style | ✅ Same events |
| Use Case | Interactive UI | Observability/logging |

**Bottom line**: If users need to send prompts and interact with the agent, RPC is required.

---

## Implementation Status

✅ **Phase 1: Project Setup** (0.5/0.5 days)
- uv project initialized
- Dependencies installed
- Base structure created

✅ **Phase 2: Core Agent Manager** (1.5/1.5 days)
- `src/config.py` - Configuration management
- `src/pi_agent.py` - Pi subprocess & RPC protocol implementation
- JSONL framing with LF delimiters
- Request/response correlation

✅ **Phase 3: WebSocket Handler** (1/1 days)
- `src/websocket_handler.py` - WebSocket manager & connection handling
- Event streaming to browser
- Session lifecycle

✅ **Phase 4: REST API** (1.5/1.5 days)
- `src/api.py` - Complete REST API with Pydantic validation
- Session, model, bash, compaction endpoints
- Error handling

✅ **Phase 5: Frontend** (2/2 days)
- `static/index.html` - Basic chat interface
- CSS styling
- Basic event handling

✅ **Phase 6: Documentation** (complete)
- `README.md` - Usage & API documentation
- `IMPLEMENTATION_PLAN.md` - Comprehensive technical guide
- `.env.example` - Configuration template

⏳ **Phase 7: Advanced Features** - Not yet implemented
- Image upload support
- Multiple sessions UI
- Server-Sent Events alternative

⏳ **Phase 8: Testing** - Not yet implemented
- Unit tests for PiSubprocess
- Integration tests for WebSocket
- E2E tests

---

## Next Steps

### Immediate Next Steps (1-2 hours)

1. **Test the basic flow**:
```bash
cd pi-rpc-server

# Edit .env with your API key
nano .env  # or vim .env

# Install dependencies
uv sync

# Start server
uv run uvicorn src.main:app --reload

# Open browser to http://localhost:8000
```

2. **Verify WebSocket works**:
```bash
# In another terminal
curl -N -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Host: localhost:8000" \
  ws://localhost:8000/ws/test-session
```

### To Complete Phase 6 & 8 (4-6 hours)

3. **Add image upload support**
4. **Enhance frontend** (markdown rendering, syntax highlighting)
5. **Write unit tests** for pi_agent.py
6. **Add Dockerfile** for containerization

---

## Technical Highlights

### RPC Protocol Implementation

```python
# src/pi_agent.py

class PiSubprocess:
    """
    Core RPC protocol client.
    
    Key features:
    - Strict LF-delimited JSONL framing
    - Request/response correlation via UUIDs
    - Async event streaming to queue
    - Automatic reconnect on connection loss
    """
    
    async def send_command(self, command: dict) -> dict:
        """Send command, wait for response with matching ID."""
        command_id = command.get("id", str(uuid.uuid4()))
        future = asyncio.Future()
        self._response_callbacks[command_id] = future
        
        # Write JSONL: `{"type":"prompt","id":"abc123",...}\n`
        line = json.dumps(command) + "\n"
        self._writer.write(line.encode("utf-8"))
        
        return await future
```

### WebSocket Event Routing

```python
# src/websocket_handler.py

async def handle_websocket(websocket: WebSocket, session_id: str):
    """
    Routes browser messages to Pi subprocess and streams events back.
    
    Sequence:
    1. Accept WebSocket connection
    2. Create new PiSubprocess (or reuse existing)
    3. Start event streaming task
    4. Await messages from browser -> route to subprocess
    5. Forward subprocess events to browser
    """
    
    session = await manager.connect(session_id, websocket)
    try:
        async for message in websocket.iter_json():
            if message["type"] == "command":
                result = await session.agent.send_command(message["command"])
                await websocket.send_json(result)
    finally:
        await manager.disconnect(session_id)
```

### REST API Pattern

```python
# src/api.py

@router.post("/sessions/{session_id}/compact")
async def compact_session(request: CompactRequest):
    """Compact conversation context via RPC command."""
    agent = await _get_session_agent(request.session_id)
    
    # Convert REST request to RPC command
    result = await agent.send_command({
        "type": "compact",
        "customInstructions": request.custom_instructions,
    })
    
    # Return structured response
    return {
        "success": result.get("success"),
        "tokens_before": result.get("data", {}).get("tokensBefore"),
    }
```

---

## File Reference

| File | Purpose | Status |
|------|------|---------|
| `pyproject.toml` | uv project config | ✅ |
| `src/config.py` | Configuration & ENV parsing | ✅ |
| `src/pi_agent.py` | RPC protocol implementation | ✅ |
| `src/websocket_handler.py` | WebSocket connections | ✅ |
| `src/api.py` | REST API endpoints | ✅ |
| `src/main.py` | FastAPI server entry | ✅ |
| `static/index.html` | Basic frontend | ✅ |
| `README.md` | User documentation | ✅ |
| `IMPLEMENTATION_PLAN.md` | Tech spec & timeline | ✅ |
| `.env.example` | Config template | ✅ |
| Tests | Comprehensive test suite | ⏳ |

---

## Key Learnings from Implementation

### 1. RPC Protocol Framing is Critical

```python
# WRONG: Don't use readline()!
readline("utf-8")  # ❌ Splits on Unicode separators!

# RIGHT: Custom LF-only split
buffer = ""
while "\n" in buffer:
    line, buffer = buffer.split("\n", 1)
    line = line.rstrip("\r")  # Handle CRLF compatibility
    yield json.loads(line)
```

### 2. Event Streaming Pattern

```python
async def get_events(self) -> AsyncGenerator[dict, None]:
    """Yield events to connected clients."""
    while True:
        event = await self._event_queue.get()
        yield event
```

### 3. Request/Response Correlation

```python
# Commands must have unique IDs
command = {"type": "prompt", "id": str(uuid.uuid4()), ...}

# Store callback
asyncioFuture = asyncio.Future()
self._callbacks[command_id] = future

# On response, resolve promise
future.set_result(response_data)
```

### 4. WebSocket Multiplexing

```python
# One WebSocket per session
manager._sessions: Dict[str, WebSocketSession]

# Async iteration for each
for session_id, session in manager._sessions.items():
    asyncio.create_task(session.stream_events())
```

---

## Troubleshooting Common Issues

### Issue 1: WebSocket connection drops after 1 minute

**Cause**: No heartbeat, socket timeouts

**Fix**:
```python
async def _ping_session(self, session_id: str):
    while connected:
        await asyncio.sleep(30)  # Ping every 30s
        await self.websocket.ping()
```

### Issue 2: JSON parse errors on large messages

**Cause**: Partial JSON in buffer

**Fix**:
```python
# Keep accumulating until complete JSON
if not is_valid_json(buffer):
    buffer += await read_more()
    continue

event = json.loads(buffer)
buffer = ""  # Reset after parsing
```

### Issue 3: Subprocess crashes during execution

**Cause**: Agent killed, connection lost

**Fix**:
```python
# Catch EOF
while self._running:
    data = await self._reader.read(4096)
    if not data:  # EOF detected
        logger.error("Subprocess ended unexpectedly")
        break
    
    # Auto-restart logic
    if subprocess.returncode is not None:
        await self._restart_agent()
```

### Issue 4: Memory grows over time

**Cause**: Sessions keep messages, no compaction

**Fix**:
- Implement auto-compaction every N messages
- Set session TTL (e.g., 24h)
- Clean inactive sessions on server restart

---

## Production Deployment Checklist

- [ ] API key secured in environment variables (not .env file)
- [ ] CORS origins configured for production domain
- [ ] Rate limiting enabled (100 requests/minute)
- [ ] Input sanitization for bash commands
- [ ] Upload size limits enforced (10MB max)
- [ ] SSL/TLS for WebSocket wss://
- [ ] Logging configured (loguru or structlog)
- [ ] Health check endpoint (`/health`)
- [ ] Session cleanup cron job (delete old sessions)
- [ ] Load test with 50+ concurrent WebSocket connections

---

## Getting Help

- **RPC Protocol Spec**: [docs/rpc.md](https://github.com/badlogic/pi-mono/blob/main/docs/rpc.md)
- **WebSocket Docs**: [src/main.py](src/main.py#L32-L35)
- **Error Logs**: Check `logs/pi-rpc-server-{date}.log`
- **Debug Mode**: Set `uvicorn src.main:app --reload --log-level debug`

---

## Related Projects

- [OpenClaw](https://github.com/openclaw/openclaw) - Real-world SDK integration example
- [Pi-Mono](https://github.com/badlogic/pi-mono) - Main repository with RPC example client
- [Pi-Coding-Agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) - Core agent implementation

---

*Generated: 2026-04-10*  
*Status: Core implementation complete, testing pending*
