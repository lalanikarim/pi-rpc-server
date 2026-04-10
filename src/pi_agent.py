"""Plumbing Agent implementation for the RPC protocol."""

import asyncio
import json
import uuid
from asyncio.subprocess import Process
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Callable, Optional



@dataclass
class PiRPCConfig:
    """Configuration for the Pi RPC subprocess."""

    provider: str
    model: str
    thinking_level: str
    session_dir: Optional[str]
    no_session: bool
    api_key: Optional[str] = None
    process_args: Optional[list[str]] = None


class RPCProtocolError(Exception):
    """Error in the RPC protocol."""

    pass


class PiSubprocess:
    """Manages the pi coding agent subprocess and RPC protocol."""

    def __init__(self, config: PiRPCConfig):
        self.config = config
        self._process: Optional[Process] = None
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._running = False
        self._lock = asyncio.Lock()
        self._response_callbacks: dict[str, asyncio.Future] = {}
        self._event_queue: asyncio.Queue[dict] = asyncio.Queue()
        self._event_handlers: list[Callable[[dict], Any]] = []
        self._process_task: Optional[asyncio.Task] = None

    async def start(self) -> str:
        """Start the subprocess and return session info."""
        async with self._lock:
            if self._running:
                raise RPCProtocolError("Agent already running")

            # Build command
            cmd = await self._build_command()

            # Spawn process
            self._process = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            self._reader = self._process.stdout
            self._writer = self._process.stdin

            self._running = True

            # Start event reader
            self._process_task = asyncio.create_task(self._read_events())

            return str(uuid.uuid4())  # Return internal session ID

    async def stop(self) -> None:
        """Stop the subprocess."""
        async with self._lock:
            if not self._running:
                return

            self._running = False

            # Terminate
            if self._process:
                self._process.terminate()
                try:
                    await asyncio.wait_for(self._process.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    self._process.kill()

            # Cancel process task
            if self._process_task:
                self._process_task.cancel()
                try:
                    await self._process_task
                except asyncio.CancelledError:
                    pass

            # Cleanup
            self._process = None
            self._reader = None
            self._writer = None

    async def _build_command(self) -> list[str]:
        """Build the command to start pi in RPC mode."""
        cmd = ["pi", "--mode", "rpc"]

        if self.config.api_key:
            cmd.extend(["--api-key", self.config.api_key])

        cmd.extend(["--provider", self.config.provider])
        cmd.extend(["--model", f"{self.config.provider}/{self.config.model}"])
        cmd.extend(["--thinking", self.config.thinking_level])

        if self.config.session_dir:
            cmd.extend(["--session-dir", self.config.session_dir])

        if self.config.no_session:
            cmd.append("--no-session")

        if self.config.process_args:
            cmd.extend(self.config.process_args)

        return cmd

    async def _read_events(self) -> None:
        """Read events from the subprocess stdout."""
        buffer = ""

        try:
            while self._running:
                # Read from stdout
                if not self._reader:
                    await asyncio.sleep(0.1)
                    continue

                data = await self._reader.read(4096)
                if not data:
                    break

                buffer += data.decode("utf-8", errors="replace")

                # Process complete lines (LF delimited)
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    if line.endswith("\r"):
                        line = line[:-1]

                    if not line.strip():
                        continue

                    try:
                        event = json.loads(line)
                        await self._event_queue.put(event)

                        # Notify handlers
                        for handler in self._event_handlers:
                            try:
                                asyncio.create_task(handler(event))
                            except Exception:
                                pass

                    except json.JSONDecodeError:
                        # Log parse error but don't crash
                        pass

        except asyncio.CancelledError:
            pass
        except Exception as e:
            # Log error but keep running
            print(f"Error in event reader: {e}")

    async def send_command(self, command: dict) -> dict:
        """Send a command to the subprocess and wait for response."""
        if not self._writer:
            raise RPCProtocolError("Not connected")

        command_id = command.get("id")

        # Create future for response
        future: asyncio.Future[dict] | None = None
        if command_id:
            future = asyncio.get_event_loop().create_future()
            self._response_callbacks[command_id] = future

        try:
            # Write command
            line = json.dumps(command) + "\n"
            self._writer.write(line.encode("utf-8"))
            await self._writer.drain()

            # Wait for response if we have an ID
            if command_id and future:
                return await future
            else:
                # Fire-and-forget
                return {"success": True}

        except ConnectionResetError as e:
            self._running = False
            raise RPCProtocolError(f"Connection lost: {e}")
        except Exception as e:
            raise RPCProtocolError(f"Failed to send command: {e}")

    def _handle_response(self, event: dict) -> None:
        """Handle response events and notify waiting promises."""
        command_id = event.get("id")
        response_type = event.get("type")

        if command_id and response_type == "response":
            future = self._response_callbacks.pop(command_id, None)
            if future and not future.done():
                future.set_result(event)

    async def get_events(self) -> AsyncGenerator[dict, None]:
        """Create an async generator for events."""
        while True:
            event = await self._event_queue.get()
            yield event

    def register_event_handler(self, handler: Callable[[dict], Any]) -> None:
        """Register an event handler callback."""
        self._event_handlers.append(handler)

    def unregister_event_handler(self, handler: Callable[[dict], Any]) -> None:
        """Unregister an event handler callback."""
        if handler in self._event_handlers:
            self._event_handlers.remove(handler)

    @property
    def is_running(self) -> bool:
        """Check if subprocess is running."""
        return self._running

    @property
    def is_active(self) -> bool:
        """Check if subprocess is actively processing."""
        if self._process:
            return self._process.returncode is None
        return False
