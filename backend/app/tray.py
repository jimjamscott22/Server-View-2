"""System tray integration for Server-View backend.

This module provides a system tray icon that allows the backend to run
in the background, making it easy to keep Server-View running persistently.
"""

import logging
import os
import signal
import sys
import threading
import webbrowser
from pathlib import Path
from typing import Optional

import psutil
import uvicorn

logger = logging.getLogger(__name__)

# Global flag to track if we're running in tray mode
_RUNNING_IN_TRAY = False


def is_running_in_tray() -> bool:
    """Check if the application is running in tray mode."""
    return _RUNNING_IN_TRAY


def get_tray_icon_path() -> Optional[str]:
    """Get the path to the tray icon."""
    # Try to find icon in various locations
    possible_paths = [
        # In the app directory
        Path(__file__).parent / "assets" / "icon.png",
        Path(__file__).parent / "assets" / "icon.svg",
        Path(__file__).parent.parent / "assets" / "icon.png",
        Path(__file__).parent.parent / "assets" / "icon.svg",
        # In the project root
        Path(__file__).parent.parent.parent / "assets" / "icon.png",
        Path(__file__).parent.parent.parent / "assets" / "icon.svg",
        Path(__file__).parent.parent.parent / "frontend" / "public" / "icon.png",
        Path(__file__).parent.parent.parent / "frontend" / "public" / "icon.svg",
    ]
    
    for path in possible_paths:
        if path.exists():
            return str(path)
    
    return None


def create_tray_icon():
    """Create and run the system tray icon.
    
    This function starts the FastAPI server in a background thread and
    creates a system tray icon with menu options.
    """
    global _RUNNING_IN_TRAY
    _RUNNING_IN_TRAY = True
    
    # Import pystray here to avoid import errors if not installed
    try:
        import pystray
    except ImportError:
        logger.error("pystray is not installed. Install it with: pip install pystray")
        sys.exit(1)
    
    # Get the FastAPI app
    from app.main import app
    
    # Determine host and port
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8008"))
    
    # Start the FastAPI server in a background thread
    server_thread = threading.Thread(
        target=run_uvicorn,
        args=(app, host, port),
        daemon=True
    )
    server_thread.start()
    
    # Create the tray icon
    icon_path = get_tray_icon_path()
    
    # Create a simple icon if none found
    if icon_path is None:
        logger.warning("No icon file found, creating a text-based icon")
        icon_path = create_text_icon()
    
    # Load the icon
    if icon_path:
        image = pystray.Icon.from_path(icon_path)
    else:
        image = pystray.Icon.from_path(create_text_icon())
    
    # Create menu items
    def open_dashboard():
        """Open the dashboard in the default browser."""
        dashboard_url = f"http://{host}:5178"
        webbrowser.open(dashboard_url)
    
    def restart_server():
        """Restart the backend server."""
        logger.info("Restarting server...")
        # This is a simple restart - in production you might want to
        # properly stop the old server first
        new_thread = threading.Thread(
            target=run_uvicorn,
            args=(app, host, port),
            daemon=True
        )
        new_thread.start()
    
    def exit_app(icon: pystray.Icon) -> None:
        """Exit the application."""
        global _RUNNING_IN_TRAY
        _RUNNING_IN_TRAY = False
        logger.info("Exiting Server-View...")
        icon.stop()
        os._exit(0)
    
    # Create the menu
    menu = pystray.Menu(
        pystray.MenuItem(
            "Open Dashboard",
            open_dashboard
        ),
        pystray.MenuItem(
            "Restart Backend",
            restart_server
        ),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(
            "Exit",
            exit_app
        )
    )
    
    # Create and run the icon
    icon = pystray.Icon(
        name="Server-View",
        icon=image,
        title="Server-View",
        menu=menu
    )
    
    logger.info(f"Server-View tray icon started. Backend running on {host}:{port}")
    logger.info("Open Dashboard from the tray menu to view the UI")
    
    # Run the tray icon
    icon.run()


def create_text_icon() -> str:
    """Create a simple text-based icon as a fallback."""
    from PIL import Image, ImageDraw, ImageFont
    import tempfile
    
    # Create a simple icon with "SV" text
    image = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    
    # Try to use a font, fall back to default
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 24)
    except Exception:
        font = ImageFont.load_default()
    
    # Draw "SV" in white
    draw.text((16, 16), "SV", fill=(255, 255, 255, 255), font=font)
    
    # Save to temp file
    temp_file = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
    image.save(temp_file.name)
    return temp_file.name


def run_uvicorn(app, host: str, port: int) -> None:
    """Run the uvicorn server."""
    try:
        uvicorn.run(
            app,
            host=host,
            port=port,
            log_level="info",
            access_log=True
        )
    except Exception as e:
        logger.error(f"Error running uvicorn: {e}")
        raise


def run_tray() -> None:
    """Entry point for running Server-View in tray mode."""
    # Set up logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    logger.info("Starting Server-View in tray mode...")
    
    # Check if already running
    if is_already_running():
        logger.error("Server-View is already running!")
        sys.exit(1)
    
    # Start the tray icon
    create_tray_icon()


def is_already_running() -> bool:
    """Check if Server-View is already running by checking for listening ports."""
    try:
        # Check if port 8008 is already in use
        for conn in psutil.net_connections(kind='inet'):
            if conn.status == psutil.CONN_LISTEN and conn.laddr.port == 8008:
                return True
    except Exception:
        pass
    return False
