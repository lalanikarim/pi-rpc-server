"""FastAPI REST API routes and Pydantic models."""

import asyncio
import uuid
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel, Field

from src.config import ServerConfig
from src.pi_agent import PiRPCConfig, PiSubprocess, RPCProtocolError
from src.websocket_handler import WebSocketSession, manager


router = APIRouter(prefix="/api", tags=["api"])


# Pydantic models for request/response validation


class ModelSelection(BaseModel):
    """Model selection request."""

    provider: str = Field(..., min_length=1)
    model_id: str = Field(..., min_length=1)


class ThinkingLevel(BaseModel):
    """Thinking level configuration."""

    level: str = Field(
        default="medium", pattern="^(off|minimal|low|medium|high|xhigh)$"
    )


class ModelInfo(BaseModel):
    """Model information."""

    id: str
    name: str
    api: str
    provider: str
    baseUrl: str | None = None


class CompactRequest(BaseModel):
    """Compact request."""

    session_id: str
    custom_instructions: str | None = None


class BashRequest(BaseModel):
    """Bash command request."""

    session_id: str
    command: str = Field(..., min_length=1)


# Helper functions


async def _get_session_agent(
    session_id: str,
) -> tuple[WebSocketSession, PiSubprocess, str]:
    """Get agent and config for session."""
    session = manager._sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    return session, session.agent, session.cwd


# Session endpoints


@router.post("/sessions")
async def create_session(
    config: ModelSelection = Body(),
    session_id: str = Query(None, description="Optional custom session ID"),
    cwd: str = Query(None, description="Working directory for the Pi agent"),
):
    """Create a new pi agent session."""
    session_id = session_id or str(uuid.uuid4())

    # Get or create agent
    if session_id in manager._sessions:
        raise HTTPException(status_code=409, detail="Session already exists")

    pi_config = PiRPCConfig(
        provider=config.provider,
        model=config.model_id,
        thinking_level="medium",
        session_dir=None,
        no_session=False,
        cwd=cwd if cwd else None,
    )

    # Create and start agent
    subprocess_agent = PiSubprocess(pi_config)
    await subprocess_agent.start()

    # Add to manager
    session = WebSocketSession(
        id=session_id,
        websocket=None,  # No WebSocket for REST session
        agent=subprocess_agent,
        cwd=cwd if cwd else None,
    )

    manager._sessions[session_id] = session
    manager._event_handlers[session_id] = []

    asyncio.create_task(manager._stream_events(session_id))

    return {"session_id": session_id, "status": "started"}


@router.get("/sessions")
async def list_sessions():
    """List all active sessions."""
    sessions = [
        {"id": sid, "active": sa.agent.is_active}
        for sid, sa in manager._sessions.items()
    ]
    return {"sessions": sessions}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """Get session details."""
    session, agent, cwd = await _get_session_agent(session_id)

    return {
        "session_id": session_id,
        "agent_active": agent.is_active,
        "cwd": cwd,
    }


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a session."""
    await manager.disconnect(session_id)
    return {"session_id": session_id, "status": "deleted"}


@router.post("/sessions/{session_id}/compact")
async def compact_session(request: CompactRequest):
    """Compact the conversation context."""
    session, agent, _ = await _get_session_agent(request.session_id)

    cmd = {
        "type": "compact",
        "customInstructions": request.custom_instructions,
    }

    result = await agent.send_command(cmd)

    return {
        "success": result.get("success"),
        "tokens_before": result.get("data", {}).get("tokensBefore"),
        "summary": result.get("data", {}).get("summary"),
    }


@router.post("/sessions/{session_id}/bash")
async def execute_bash(request: BashRequest):
    """Execute a bash command and add output to session context."""
    session, agent, _ = await _get_session_agent(request.session_id)

    result = await agent.send_command(
        {
            "type": "bash",
            "command": request.command,
        }
    )

    return {
        "success": result.get("success"),
        "output": result.get("data", {}).get("output"),
        "exitCode": result.get("data", {}).get("exitCode"),
    }


# Model endpoints


@router.post("/models/current")
async def set_model(
    session_id: str,
    config: ModelSelection,
):
    """Set the current model."""
    session, agent, cwd = await _get_session_agent(session_id)

    result = await agent.send_command(
        {
            "type": "set_model",
            "provider": config.provider,
            "modelId": config.model_id,
        }
    )

    return {"success": result.get("success"), "model": result.get("data")}


@router.post("/models/current/cycle")
async def cycle_model(session_id: str):
    """Cycle to next available model."""
    session, agent, cwd = await _get_session_agent(session_id)

    result = await agent.send_command({"type": "cycle_model"})

    return {
        "success": result.get("success"),
        "model": result.get("data", {}).get("model"),
        "thinkingLevel": result.get("data", {}).get("thinkingLevel"),
    }


# Thinking level endpoints


@router.put("/thinking-level")
async def set_thinking_level(
    session_id: str,
    level: ThinkingLevel,
):
    """Set the thinking level."""
    session, agent, cwd = await _get_session_agent(session_id)

    result = await agent.send_command(
        {
            "type": "set_thinking_level",
            "level": level.level,
        }
    )

    return {"success": result.get("success")}


@router.put("/thinking-level/cycle")
async def cycle_thinking_level(session_id: str):
    """Cycle through thinking levels."""
    session, agent, cwd = await _get_session_agent(session_id)

    result = await agent.send_command({"type": "cycle_thinking_level"})

    return {
        "success": result.get("success"),
        "level": result.get("data", {}).get("level"),
    }


# Session stats


@router.get("/sessions/{session_id}/stats")
async def get_session_stats(session_id: str):
    """Get session statistics."""
    session, agent, cwd = await _get_session_agent(session_id)

    result = await agent.send_command({"type": "get_session_stats"})

    return {
        "success": result.get("success"),
        "stats": result.get("data"),
    }


@router.get("/sessions/{session_id}/state")
async def get_session_state(session_id: str):
    """Get current session state."""
    session, agent, cwd = await _get_session_agent(session_id)

    result = await agent.send_command({"type": "get_state"})

    return {
        "success": result.get("success"),
        "state": result.get("data"),
    }


@router.get("/sessions/{session_id}/messages")
async def get_session_messages(session_id: str):
    """Get all messages in the conversation."""
    session, agent, cwd = await _get_session_agent(session_id)

    result = await agent.send_command({"type": "get_messages"})

    return {
        "success": result.get("success"),
        "messages": result.get("data", {}).get("messages"),
    }


@router.get("/sessions/{session_id}/fork-messages")
async def get_fork_messages(session_id: str):
    """Get messages available for forking."""
    session, agent, cwd = await _get_session_agent(session_id)

    result = await agent.send_command({"type": "get_fork_messages"})

    return {
        "success": result.get("success"),
        "messages": result.get("data", {}).get("messages"),
    }


# Export


@router.post("/sessions/{session_id}/export")
async def export_session(
    session_id: str,
    output_path: str = Query(None, description="Optional output path"),
):
    """Export session to HTML."""
    session, agent, cwd = await _get_session_agent(session_id)

    cmd = {"type": "export_html"}
    if output_path:
        cmd["outputPath"] = output_path

    result = await agent.send_command(cmd)

    return {
        "success": result.get("success"),
        "path": result.get("data", {}).get("path"),
    }


# Utility


@router.get("/commands")
async def get_commands():
    """Get available commands (templates, skills, extensions)."""
    return {"commands": []}
