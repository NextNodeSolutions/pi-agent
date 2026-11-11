import fcntl
import functools
import json
import shutil
import subprocess
from contextlib import contextmanager
from pathlib import Path

CLI_CANDIDATES = (
    "tailscale",
    "/opt/homebrew/bin/tailscale",
    "/usr/local/bin/tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
)
COMMAND_TIMEOUT_SECONDS = 30
CONNECTED_STATE = "Running"
STATE = Path.home() / ".local/state/tailnet-link"
SETUP_HINT = "Run: tailnet-link setup"


class LinkError(Exception):
    pass


def run(arguments, timeout=COMMAND_TIMEOUT_SECONDS):
    try:
        result = subprocess.run(arguments, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise LinkError("Command did not complete: " + " ".join(arguments) + ". " + str(error)) from error
    if result.returncode:
        raise LinkError("Command failed: " + " ".join(arguments) + "\n" + result.stderr.strip())
    return result.stdout.strip()


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
    if own.get("BackendState") != CONNECTED_STATE or not name:
        raise LinkError("This machine is not connected to the tailnet. " + SETUP_HINT)
    return name


def serve_config():
    return json.loads(tailscale("serve", "status", "--json"))


def handlers(config, authority):
    return config.get("Web", {}).get(authority, {}).get("Handlers") or {}


@contextmanager
def serve_lock():
    STATE.mkdir(parents=True, exist_ok=True)
    with open(STATE / "serve.lock", "w") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield
