"""WebSocket handler for real-time event streaming."""

import asyncio
from dataclasses import dataclass
from typing import Any, Callable, Optional

import websockets
from fastapi import WebSocket

from src.pi_agent import PiRPCConfig, PiSubprocess


@dataclass
class WebSocketSession:
    """Represents a WebSocket session connected to a Pi agent."""

    id: str
    websocket: WebSocket
    agent: PiSubprocess
    cwd: Optional[str] = None
    ping_interval: int = 30  # seconds


class WebSocketManager:
    """Manages WebSocket connections and session lifecycle."""

    def __init__(self):
        self._sessions: dict[str, WebSocketSession] = {}
        self._lock = asyncio.Lock()
        self._ping_tasks: dict[str, asyncio.Task] = {}
        self._event_handlers: dict[str, list[Callable[[dict], Any]]] = {}

    async def connect(
        self, session_id: str, websocket: Optional[WebSocket], cwd: Optional[str] = None
    ) -> WebSocketSession:
        """Establish a new WebSocket connection with optional working directory."""
        async with self._lock:
            if websocket is None:
                raise ValueError("WebSocket cannot be None")

            await websocket.accept()

            config = PiRPCConfig(
                provider="anthropic",
                model="claude-sonnet-4-20250514",
                thinking_level="medium",
                session_dir=None,
                no_session=False,
                cwd=cwd,
            )

            session = WebSocketSession(
                id=session_id,
                websocket=websocket,
                agent=PiSubprocess(config),
                cwd=cwd,
            )

            self._sessions[session_id] = session
            self._event_handlers[session_id] = []

            asyncio.create_task(self._stream_events(session_id))
            self._ping_tasks[session_id] = asyncio.create_task(
                self._ping_session(session_id)
            )

            return session

    async def disconnect(self, session_id: str) -> None:
        """Close a WebSocket connection."""
        async with self._lock:
            session = self._sessions.pop(session_id, None)
            if session:
                # Cancel ping task
                if session_id in self._ping_tasks:
                    self._ping_tasks[session_id].cancel()

                # Stop agent
                await session.agent.stop()

                # Remove event handlers
                self._event_handlers.pop(session_id, None)

                # Close websocket
                try:
                    await session.websocket.close()
                except Exception:
                    pass

    async def send_json(self, session_id: str, data: dict) -> bool:
        """Send a JSON message to a WebSocket session."""
        async with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return False

        try:
            await session.websocket.send_json(data)
            return True
        except Exception:
            return False

    async def broadcast_message(self, session_id: str, message: dict) -> None:
        """Broadcast a message to all event handlers for a session."""
        handlers = self._event_handlers.get(session_id, [])
        for handler in handlers:
            try:
                await handler(message)
            except Exception:
                pass

    async def _stream_events(self, session_id: str) -> None:
        """Stream events from the agent to the WebSocket."""
        session = self._sessions.get(session_id)
        if not session:
            return

        try:
            async for event in session.agent.get_events():
                await self.send_json(session_id, event)
                await self.broadcast_message(session_id, event)
        except Exception:
            # Connection lost
            pass

    async def _ping_session(self, session_id: str) -> None:
        """Send periodic pings to maintain connection."""
        session = self._sessions.get(session_id)
        if not session:
            return

        try:
            while self._sessions.get(session_id) == session:
                await asyncio.sleep(session.ping_interval)
                await session.websocket.ping()
        except websockets.exceptions.ConnectionClosed:
            pass

    async def route_command_to_agent(self, session_id: str, command: dict) -> Any:
        """Route an incoming command to the agent subprocess."""
        session = self._sessions.get(session_id)
        if not session:
            return {"success": False, "error": "Session not found"}

        try:
            result = await session.agent.send_command(command)
            return result
        except Exception as e:
            return {"success": False, "error": str(e)}

    def register_event_handler(
        self, session_id: str, handler: Callable[[dict], Any]
    ) -> None:
        """Register a custom event handler for a session."""
        handlers = self._event_handlers.get(session_id)
        if handlers:
            handlers.append(handler)

    def unregister_event_handler(
        self, session_id: str, handler: Callable[[dict], Any]
    ) -> None:
        """Remove a custom event handler from a session."""
        handlers = self._event_handlers.get(session_id)
        if handlers:
            if handler in handlers:
                handlers.remove(handler)


# Global manager instance
manager = WebSocketManager()


async def handle_websocket(websocket: WebSocket, session_id: str) -> None:
    """Main WebSocket handler."""
    session = await manager.connect(session_id, websocket)

    try:
        async for message in websocket.iter_json():
            # Route message to agent
            if message.get("type") == "command":
                result = await manager.route_command_to_agent(
                    session_id, message.get("command", {})
                )
                await manager.send_json(session_id, result)

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        await manager.disconnect(session_id)
