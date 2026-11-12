import fcntl
import functools
import json
import shutil
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path

CLI_CANDIDATES = (
    "tailscale",
    "/opt/homebrew/bin/tailscale",
    "/usr/local/bin/tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
)
COMMAND_TIMEOUT_SECONDS = 30
SUCCESS_EXITS = (0,)
POLL_SECONDS = 0.25
LOCK_SECONDS = 60
CONNECTED_STATE = "Running"
STATE = Path.home() / ".local/state/tailnet-link"
SETUP_HINT = "Run: tailnet-link setup"


class LinkError(Exception):
    pass


def run(arguments, timeout=COMMAND_TIMEOUT_SECONDS, accepted_exits=SUCCESS_EXITS):
    try:
        result = subprocess.run(arguments, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise LinkError("Command did not complete: " + " ".join(arguments) + ". " + str(error)) from error
    if result.returncode not in accepted_exits:
        raise LinkError("Command failed: " + " ".join(arguments) + "\n" + result.stderr.strip())
    return result.stdout.strip()


def wait_until(is_ready, seconds, failure):
    deadline = time.monotonic() + seconds
    while not is_ready():
        if time.monotonic() >= deadline:
            raise LinkError(failure)
        time.sleep(POLL_SECONDS)


def cli():
    found = next(filter(None, map(shutil.which, CLI_CANDIDATES)), None)
    if not found:
        raise LinkError("No tailscale CLI on this machine. " + SETUP_HINT)
    return found


def tailscale(*arguments):
    return run([cli(), *arguments])


def status(*flags):
    return json.loads(tailscale("status", "--json", *flags))


@functools.lru_cache(maxsize=None)
def host():
    own = status("--peers=false")
    name = own.get("Self", {}).get("DNSName", "").rstrip(".")
    # A machine the tailnet dropped keeps reporting Running and its old name, with a sign-in URL pending.
    is_connected = own.get("BackendState") == CONNECTED_STATE and not own.get("AuthURL")
    if not is_connected or not name:
        raise LinkError("This machine is not connected to the tailnet. " + SETUP_HINT)
    return name


def serve_config():
    return json.loads(tailscale("serve", "status", "--json"))


def handlers(config, authority):
    return config.get("Web", {}).get(authority, {}).get("Handlers") or {}


def has_locked(handle):
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return False
    return True


@contextmanager
def serve_lock():
    STATE.mkdir(parents=True, exist_ok=True)
    with open(STATE / "serve.lock", "w") as handle:
        wait_until(lambda: has_locked(handle), LOCK_SECONDS, "Another tailnet-link has held this machine's Serve configuration for "
                   + str(LOCK_SECONDS) + " seconds. End that command, then run this again.")
        yield
