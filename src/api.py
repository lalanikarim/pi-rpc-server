"""FastAPI REST API routes and Pydantic models."""

import uuid
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel, Field

from src.pi_agent import PiRPCConfig, PiSubprocess, RPCProtocolError
from src.websocket_handler import manager


router = APIRouter(prefix="/api", tags=["api"])


# Pydantic models for request/response validation


class ModelInfo(BaseModel):
    """Model information."""

    id: str
    name: str
    api: str
    provider: str
    baseUrl: str | None = None


class ModelList(BaseModel):
    """List of available models."""

    models: list[ModelInfo]
    current: ModelInfo | None = None


class ThinkingLevel(BaseModel):
    """Thinking level configuration."""

    level: str = Field(
        default="medium", pattern="^(off|minimal|low|medium|high|xhigh)$"
    )


class ModelSelection(BaseModel):
    """Model selection request."""

    provider: str = Field(..., min_length=1)
    model_id: str = Field(..., min_length=1)


class CompactRequest(BaseModel):
    """Compact request."""

    session_id: str
    custom_instructions: str | None = None


class BashRequest(BaseModel):
    """Bash command request."""

    command: str = Field(..., min_length=1)


class CommandMessage(BaseModel):
    """Command message for WebSocket."""

    type: str = "command"
    command: dict[str, Any]


# Helper functions


async def _get_session_agent(session_id: str) -> PiSubprocess:
    """Get agent for session."""
    session = manager._sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    return session.agent


async def _start_agent(session_agent: PiSubprocess, config: PiRPCConfig) -> str:
    """Start agent with config."""
    try:
        await session_agent.start(config)
        return session_agent.config.model
    except RPCProtocolError as e:
        raise HTTPException(status_code=500, detail=str(e))


# Session endpoints


@router.post("/sessions")
async def create_session(
    config: ModelSelection = Body(),
    session_id: str = Query(None, description="Optional custom session ID"),
):
    """Create a new pi agent session."""
    session_id = session_id or str(uuid.uuid4())

    # Get or create agent
    agent = manager._sessions.get(session_id)
    if agent:
        raise HTTPException(status_code=409, detail="Session already exists")

    pi_config = PiRPCConfig(
        provider=config.provider,
        model=config.model_id,
        thinking_level="medium",
        session_dir=None,
        no_session=False,
    )

    # Start agent
    session = await manager.connect(session_id, None)
    await _start_agent(session.agent, pi_config)

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
    session = manager._sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    return {
        "session_id": session_id,
        "agent_active": session.agent.is_active,
    }


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a session."""
    await manager.disconnect(session_id)
    return {"session_id": session_id, "status": "deleted"}


@router.post("/sessions/{session_id}/fork")
async def fork_session(
    session_id: str,
    entry_id: str,
):
    """Fork a session from a previous entry."""
    agent = await _get_session_agent(session_id)

    try:
        result = await agent.send_command(
            {
                "type": "fork",
                "entryId": entry_id,
            }
        )

        return {
            "session_id": session_id,
            "forked_from": entry_id,
            "success": result.get("success"),
        }
    except RPCProtocolError as e:
        raise HTTPException(status_code=500, detail=str(e))


# Model endpoints


@router.post("/models/current")
async def set_model(
    session_id: str,
    config: ModelSelection,
):
    """Set the current model."""
    agent = await _get_session_agent(session_id)

    agent_new_config = PiRPCConfig(
        provider=config.provider,
        model=config.model_id,
        thinking_level=agent.config.thinking_level,
        session_dir=agent.config.session_dir,
        no_session=agent.config.no_session,
    )

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
    agent = await _get_session_agent(session_id)

    result = await agent.send_command(
        {
            "type": "cycle_model",
        }
    )

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
    agent = await _get_session_agent(session_id)

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
    agent = await _get_session_agent(session_id)

    result = await agent.send_command(
        {
            "type": "cycle_thinking_level",
        }
    )

    return {
        "success": result.get("success"),
        "level": result.get("data", {}).get("level"),
    }


# Compaction endpoints


@router.post("/sessions/{session_id}/compact")
async def compact_session(request: CompactRequest):
    """Compact the conversation context."""
    agent = await _get_session_agent(request.session_id)

    result = await agent.send_command(
        {
            "type": "compact",
            "customInstructions": request.custom_instructions,
        }
    )

    return {
        "success": result.get("success"),
        "tokens_before": result.get("data", {}).get("tokensBefore"),
        "summary": result.get("data", {}).get("summary"),
    }


# Bash execution endpoints


@router.post("/bash")
async def execute_bash(request: BashRequest):
    """Execute a bash command."""
    session_id = str(uuid.uuid4())  # New session for bash

    pi_config = PiRPCConfig(
        provider="anthropic",
        model="claude-sonnet-4-20250514",
        thinking_level="medium",
        session_dir=None,
        no_session=True,
    )

    session = await manager.connect(session_id, None)
    await _start_agent(session.agent, pi_config)

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
        "session_id": session_id,
    }


# Session stats endpoints


@router.get("/sessions/{session_id}/stats")
async def get_session_stats(session_id: str):
    """Get session statistics."""
    agent = await _get_session_agent(session_id)

    result = await agent.send_command(
        {
            "type": "get_session_stats",
        }
    )

    return {
        "success": result.get("success"),
        "stats": result.get("data"),
    }


@router.get("/sessions/{session_id}/state")
async def get_session_state(session_id: str):
    """Get current session state."""
    agent = await _get_session_agent(session_id)

    result = await agent.send_command(
        {
            "type": "get_state",
        }
    )

    return {
        "success": result.get("success"),
        "state": result.get("data"),
    }


@router.get("/sessions/{session_id}/fork-messages")
async def get_fork_messages(session_id: str):
    """Get messages available for forking."""
    agent = await _get_session_agent(session_id)

    result = await agent.send_command(
        {
            "type": "get_fork_messages",
        }
    )

    return {
        "success": result.get("success"),
        "messages": result.get("data", {}).get("messages"),
    }


# Export endpoints


@router.post("/sessions/{session_id}/export")
async def export_session(
    session_id: str,
    output_path: str = Query(None, description="Optional output path"),
):
    """Export session to HTML."""
    agent = await _get_session_agent(session_id)

    cmd = {"type": "export_html"}
    if output_path:
        cmd["outputPath"] = output_path

    result = await agent.send_command(cmd)

    return {
        "success": result.get("success"),
        "path": result.get("data", {}).get("path"),
    }


# Utility endpoints


@router.get("/commands")
async def get_commands():
    """Get available commands (templates, skills, extensions)."""
    return {
        "commands": await agent.send_command({"type": "get_commands"})
        .get("data", {})
        .get("commands", [])
    }
