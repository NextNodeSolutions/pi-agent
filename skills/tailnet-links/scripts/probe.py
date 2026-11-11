import time
import urllib.error
import urllib.request

from tailnet import LinkError

HTTP_TIMEOUT_SECONDS = 8
BODY_PREFIX_BYTES = 4096
POLL_SECONDS = 0.25
DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def fetch(url, headers=None):
    request = urllib.request.Request(url, headers=headers or {})
    try:
        with DIRECT.open(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            return response.status, response.read(BODY_PREFIX_BYTES)
    except urllib.error.HTTPError as error:
        return error.code, error.read(BODY_PREFIX_BYTES)
    except OSError:
        return None, b""


def wait_until(is_ready, seconds, failure):
    deadline = time.monotonic() + seconds
    while not is_ready():
        if time.monotonic() >= deadline:
            raise LinkError(failure)
        time.sleep(POLL_SECONDS)
