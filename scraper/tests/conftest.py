"""Pytest config for the scraper test suite."""


def pytest_configure(config):
    # Registered so the opt-in live tests (which need pytest-asyncio installed
    # and OE_LIVE=1) don't emit PytestUnknownMarkWarning during the pure run.
    config.addinivalue_line("markers", "asyncio: mark an async test (needs pytest-asyncio).")
