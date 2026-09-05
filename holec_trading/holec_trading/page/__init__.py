import aiohttp

# Global fallback for Frappe Cloud environment version mismatches
if not hasattr(aiohttp, "SocketTimeoutError"):
    aiohttp.SocketTimeoutError = getattr(aiohttp, "ServerTimeoutError", TimeoutError)

try:
    import aiohttp.client_exceptions
    if not hasattr(aiohttp.client_exceptions, "SocketTimeoutError"):
        aiohttp.client_exceptions.SocketTimeoutError = aiohttp.SocketTimeoutError
except ImportError:
    pass