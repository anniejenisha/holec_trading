__version__ = "0.0.1"
import aiohttp
import asyncio

# Compatibility patch for modern aiohttp versions removing SocketTimeoutError
if not hasattr(aiohttp, "SocketTimeoutError"):
    aiohttp.SocketTimeoutError = asyncio.TimeoutError