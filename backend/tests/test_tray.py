"""Tests for system tray functionality."""

import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


def test_is_running_in_tray_default():
    """Test that is_running_in_tray returns False by default."""
    from app.tray import is_running_in_tray
    assert is_running_in_tray() is False


def test_is_already_running_no_connections():
    """Test is_already_running when no connections exist."""
    from app.tray import is_already_running
    with patch('app.tray.psutil.net_connections') as mock_connections:
        mock_connections.return_value = []
        assert is_already_running() is False


def test_is_already_running_with_listening_port():
    """Test is_already_running when port 8008 is listening."""
    import psutil
    from app.tray import is_already_running
    
    # Create a mock connection that's listening on port 8008
    mock_conn = MagicMock()
    mock_conn.status = psutil.CONN_LISTEN
    mock_conn.laddr.port = 8008
    
    with patch('app.tray.psutil.net_connections') as mock_connections:
        mock_connections.return_value = [mock_conn]
        assert is_already_running() is True


def test_is_already_running_with_different_port():
    """Test is_already_running when a different port is listening."""
    import psutil
    from app.tray import is_already_running
    
    # Create a mock connection that's listening on a different port
    mock_conn = MagicMock()
    mock_conn.status = psutil.CONN_LISTEN
    mock_conn.laddr.port = 9000
    
    with patch('app.tray.psutil.net_connections') as mock_connections:
        mock_connections.return_value = [mock_conn]
        assert is_already_running() is False


def test_is_already_running_with_permission_error():
    """Test is_already_running when there's a permission error."""
    from app.tray import is_already_running
    with patch('app.tray.psutil.net_connections') as mock_connections:
        mock_connections.side_effect = PermissionError("Access denied")
        # Should not raise, just return False
        assert is_already_running() is False


def test_create_text_icon_creates_file():
    """Test that create_text_icon creates a valid image file."""
    from app.tray import create_text_icon
    try:
        from PIL import Image
        
        result = create_text_icon()
        
        # Check that the file exists
        assert Path(result).exists()
        
        # Check that it's a valid image
        with Image.open(result) as img:
            assert img.size == (64, 64)
        
        # Clean up
        os.unlink(result)
    except ImportError:
        # PIL might not be installed in test environment
        pytest.skip("PIL not installed")


def test_get_tray_icon_path_with_mock():
    """Test get_tray_icon_path with mocked file system."""
    from app.tray import get_tray_icon_path
    
    # This test just verifies the function runs without error
    # The actual path finding is hard to test without mocking the entire filesystem
    result = get_tray_icon_path()
    # It may or may not find an icon depending on the test environment
    assert result is None or isinstance(result, str)
