"""FastAPI server for Pi RPC interface."""

from pathlib import Path

from fastapi import FastAPI, Query, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse

from src.api import router as api_router
from src.config import create_config, load_env
from src.websocket_handler import manager, handle_websocket

# Load environment variables
load_env()


def create_app() -> FastAPI:
    """Create the FastAPI application."""
    config = create_config()

    app = FastAPI(
        title="Pi RPC Server",
        description="FastAPI server for Pi coding agent RPC interface",
        version="0.1.0",
    )

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.server.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Mount static files
    static_path = Path(__file__).parent.parent / "static"
    if static_path.exists():
        app.mount("/static", StaticFiles(directory=str(static_path)), name="static")

        @app.get("/", response_class=HTMLResponse)
        async def root():
            return (static_path / "index.html").read_text()

    # API routes
    app.include_router(api_router)

    # Set manager on app state
    app.state.manager = manager

    return app


# Global app instance
app = create_app()


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for real-time communication."""
    await handle_websocket(websocket, session_id)


@app.get("/ws/{session_id}/connect")
async def websocket_connect(
    websocket: WebSocket,
    session_id: str,
    cwd: str | None = Query(None, description="Working directory for the Pi agent"),
):
    """WebSocket with optional custom working directory for subprocess."""
    session = await manager.connect(session_id, websocket, cwd=cwd)

    try:
        async for message in websocket.iter_json():
            if message.get("type") == "command":
                result = await manager.route_command_to_agent(
                    session_id, message.get("command", {})
                )
                await manager.send_json(session_id, result)
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        await manager.disconnect(session_id)


@app.on_event("startup")
async def startup_event():
    """Run on server startup."""
    config = create_config()
    print(f"Starting Pi RPC Server on {config.server.host}:{config.server.port}")


@app.on_event("shutdown")
async def shutdown_event():
    """Run on server shutdown."""
    # Disconnect all sessions
    for session_id in list(app.state.manager._sessions.keys()):
        await app.state.manager.disconnect(session_id)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "src.main:app",
        host=config.server.host,
        port=config.server.port,
        workers=config.server.workers,
        reload=True,
    )
