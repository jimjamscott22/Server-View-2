"""Main entry point for Server-View backend.

This module allows running the backend in different modes:
- Normal mode: Run as a regular FastAPI server
- Tray mode: Run with a system tray icon in the background

Usage:
    # Normal mode (default)
    python -m app.main
    
    # Tray mode
    python -m app --tray
    
    # Or via uv
    uv run python -m app --tray
"""

import argparse
import logging
import sys

logger = logging.getLogger(__name__)


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Server-View Local Agent - Monitor and manage local development processes"
    )
    parser.add_argument(
        "--tray",
        action="store_true",
        help="Run in system tray mode (background)"
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host to bind to (default: 127.0.0.1)"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8008,
        help="Port to bind to (default: 8008)"
    )
    
    args = parser.parse_args()
    
    # Set up logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    if args.tray:
        # Run in tray mode
        from app.tray import run_tray
        import os
        os.environ["HOST"] = args.host
        os.environ["PORT"] = str(args.port)
        run_tray()
    else:
        # Run in normal mode
        import uvicorn
        from app.main import app
        
        logger.info(f"Starting Server-View backend on {args.host}:{args.port}")
        uvicorn.run(
            app,
            host=args.host,
            port=args.port,
            log_level="info",
            access_log=True
        )


if __name__ == "__main__":
    main()
