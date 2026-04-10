"""FastAPI REST API routes and Pydantic models."""

import asyncio
import json
import uuid
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel, Field

from src.pi_agent import PiRPCConfig, PiSubprocess
from src.websocket_handler import WebSocketSession, manager


router = APIRouter(prefix="/api", tags=["api"])


class ModelSelection(BaseModel):
    """Model selection request."""

    provider: str = Field(..., min_length=1)
    model_id: str = Field(..., min_length=1)


class ThinkingLevel(BaseModel):
    """Thinking level configuration."""

    level: str = Field(
        default="medium", pattern="^(off|minimal|low|medium|high|xhigh)$"
    )


class CompactRequest(BaseModel):
    """Compact request."""

    session_id: str
    custom_instructions: str | None = None


class BashRequest(BaseModel):
    """Bash command request."""

    session_id: str
    command: str = Field(..., min_length=1)


class SessionListItem(BaseModel):
    """List item for session."""

    id: str
    path: str
    name: str | None = None
    is_forkable: bool = False
    entryCount: int = 0


@router.get("/sessions/available")
async def get_available_sessions(
    cwd: str | None = Query(
        None, description="Working directory to list sessions from"
    ),
):
    """Get list of available agent sessions from filesystem."""
    search_dir: Path | None = (
        Path(cwd) if cwd else (Path.home() / ".pi" / "agent" / "sessions")
    )

    sessions = []
    if search_dir and search_dir.exists():
        for session_file in search_dir.glob("*.jsonl"):
            session_id = session_file.stem
            meta = None
            try:
                with open(session_file, "r") as f:
                    for line in f:
                        if line.strip():
                            meta = json.loads(line)
                            break
            except Exception:
                pass

            sessions.append(
                {
                    "id": session_id,
                    "path": str(session_file),
                    "name": meta.get("meta", {}).get("displayName") if meta else None,
                    "is_forkable": True,
                    "entryCount": meta.get("meta", {}).get("entryCount", 0)
                    if meta
                    else 0,
                }
            )

    return {"sessions": sessions, "directory": str(search_dir) if search_dir else None}


@router.get("/sessions/list")
async def list_active_sessions():
    """List active WebSocket sessions."""
    return {
        "sessions": [
            {"id": sid, "active": sa.agent.is_active, "cwd": sa.cwd}
            for sid, sa in manager._sessions.items()
        ]
    }


@router.get("/sessions")
async def list_all_sessions(cwd: str | None = Query(None)):
    """List all pi agent sessions."""
    return await get_available_sessions(cwd=cwd)


@router.post("/sessions")
async def create_session(
    config: ModelSelection = Body(),
    session_id: str | None = Query(None),
    cwd: str = Query(None, description="Working directory"),
):
    """Create new pi agent session."""
    session_id = session_id or str(uuid.uuid4())

    if session_id in manager._sessions:
        raise HTTPException(status_code=409, detail="Session exists")

    pi_config = PiRPCConfig(
        provider=config.provider,
        model=config.model_id,
        thinking_level="medium",
        session_dir=None,
        no_session=True,
        cwd=cwd,
    )

    agent = PiSubprocess(pi_config)
    await agent.start()

    session = WebSocketSession(
        id=session_id,
        websocket=None,
        agent=agent,
        cwd=cwd,
    )

    manager._sessions[session_id] = session
    manager._event_handlers[session_id] = []
    asyncio.create_task(manager._stream_events(session_id))

    return {"session_id": session_id, "status": "started", "cwd": cwd}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """Get session details."""
    session, agent, cwd = await _get_session(session_id)
    return {"id": session_id, "active": agent.is_active, "cwd": cwd}


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete session."""
    await manager.disconnect(session_id)
    return {"deleted": session_id}


### Model endpoints


@router.post("/sessions/{session_id}/model")
async def set_model(session_id: str, config: ModelSelection):
    """Set model for session."""
    session, agent, cwd = await _get_session(session_id)
    result = await agent.send_command(
        {
            "type": "set_model",
            "provider": config.provider,
            "modelId": config.model_id,
        }
    )
    return {"success": result.get("success"), "model": result.get("data")}


@router.get("/sessions/{session_id}/models")
async def get_available_models(session_id: str):
    """Get list of available models from the agent."""
    session, agent, cwd = await _get_session(session_id)
    result = await agent.send_command({"type": "get_available_models"})
    if result.get("success"):
        models_data = result.get("data", {}).get("models", [])
        return {
            "success": True,
            "models": models_data,
            "current": result.get("data", {}).get("model"),
        }
    return {"success": False, "error": "Failed to get models"}


@router.post("/sessions/{session_id}/model/cycle")
async def cycle_model(session_id: str):
    """Cycle to next model."""
    session, agent, cwd = await _get_session(session_id)
    result = await agent.send_command({"type": "cycle_model"})
    return {"success": result.get("success"), "data": result.get("data")}


### Thinking level endpoints


@router.put("/sessions/{session_id}/thinking")
async def set_thinking(session_id: str, level: ThinkingLevel):
    """Set thinking level."""
    session, agent, cwd = await _get_session(session_id)
    result = await agent.send_command(
        {
            "type": "set_thinking_level",
            "level": level.level,
        }
    )
    return {"success": result.get("success")}


@router.put("/sessions/{session_id}/thinking/cycle")
async def cycle_thinking(session_id: str):
    """Cycle thinking level."""
    session, agent, cwd = await _get_session(session_id)
    result = await agent.send_command({"type": "cycle_thinking_level"})
    return {
        "success": result.get("success"),
        "level": result.get("data", {}).get("level"),
    }


### Compaction


@router.post("/sessions/{session_id}/compact")
async def compact(session_id: str, request: CompactRequest):
    """Compact session."""
    session, agent, _ = await _get_session(session_id)
    result = await agent.send_command(
        {
            "type": "compact",
            "customInstructions": request.custom_instructions,
        }
    )
    return {"success": result.get("success")}


### Bash


@router.post("/sessions/{session_id}/bash")
async def execute_bash(request: BashRequest):
    """Execute bash command."""
    session, agent, _ = await _get_session(request.session_id)
    result = await agent.send_command(
        {
            "type": "bash",
            "command": request.command,
        }
    )
    return {
        "success": result.get("success"),
        "exitCode": result.get("data", {}).get("exitCode"),
        "output": result.get("data", {}).get("output"),
    }


### Stats & State


@router.get("/sessions/{session_id}/stats")
async def get_stats(session_id: str):
    """Get session stats."""
    session, agent, cwd = await _get_session(session_id)
    result = await agent.send_command({"type": "get_session_stats"})
    return {"success": result.get("success"), "stats": result.get("data")}


@router.get("/sessions/{session_id}/state")
async def get_state(session_id: str):
    """Get current state."""
    session, agent, cwd = await _get_session(session_id)
    result = await agent.send_command({"type": "get_state"})
    return {"success": result.get("success"), "state": result.get("data")}


@router.get("/sessions/{session_id}/messages")
async def get_messages(session_id: str):
    """Get messages."""
    session, agent, cwd = await _get_session(session_id)
    result = await agent.send_command({"type": "get_messages"})
    return {"messages": result.get("data", {}).get("messages")}


@router.get("/sessions/{session_id}/fork")
async def get_fork_messages(session_id: str):
    """Get fork messages."""
    session, agent, cwd = await _get_session(session_id)
    result = await agent.send_command({"type": "get_fork_messages"})
    return {"messages": result.get("data", {}).get("messages")}


### Export


@router.post("/sessions/{session_id}/export")
async def export_session(session_id: str, path: str = Query(None)):
    """Export session to HTML."""
    session, agent, cwd = await _get_session(session_id)
    cmd = {"type": "export_html"}
    if path:
        cmd["outputPath"] = path
    result = await agent.send_command(cmd)
    return {
        "success": result.get("success"),
        "path": result.get("data", {}).get("path"),
    }


### Helper functions


async def _get_session(
    session_id: str,
) -> tuple[WebSocketSession, PiSubprocess, str | None]:
    session = manager._sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    return session, session.agent, session.cwd
