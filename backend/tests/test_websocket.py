"""Tests for WebSocket functionality."""

import json

import pytest
from fastapi.testclient import TestClient

from app import main

client = TestClient(main.app)


def test_websocket_processes_route_exists():
    """Test that WebSocket route is registered."""
    # Check that the route exists in the app
    routes = [route.path for route in main.app.routes]
    assert "/ws/processes" in routes
    assert "/ws/health" in routes


def test_websocket_processes_sends_initial_data():
    """Test that WebSocket sends initial process data."""
    with client.websocket_connect("/ws/processes") as websocket:
        # Should receive initial data
        data = websocket.receive_text()
        parsed = json.loads(data)
        
        # Verify it has the expected structure
        assert "processes" in parsed
        assert "summary" in parsed
        assert isinstance(parsed["processes"], list)


def test_websocket_health_ping_pong():
    """Test that health WebSocket responds to ping with pong."""
    with client.websocket_connect("/ws/health") as websocket:
        # Send ping
        websocket.send_text("ping")
        
        # Should receive pong
        response = websocket.receive_text()
        assert response == "pong"


def test_websocket_health_echo():
    """Test that health WebSocket echoes other messages."""
    with client.websocket_connect("/ws/health") as websocket:
        # Send a test message
        test_message = "hello world"
        websocket.send_text(test_message)
        
        # Should receive echo
        response = websocket.receive_text()
        assert response == f"echo: {test_message}"
