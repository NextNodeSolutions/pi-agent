from __future__ import annotations

import json
import os
import signal
import subprocess
import time
from pathlib import Path

CLI = "/opt/homebrew/bin/infisical"
TIMEOUT_SECONDS = 25
CLI_FLAGS = ["--telemetry=false", "--silent"]
SANDBOX_PROFILE = '(version 1) (allow default) (deny network-bind) (deny process-exec (literal "/usr/bin/open"))'


class VaultUnavailable(Exception):
    """Safe-to-display store failure; never contains login or subprocess output."""

    exit_code = 1


class VaultAuthenticationRequired(VaultUnavailable):
    exit_code = json.loads(
        Path(__file__).with_name("protocol.json").read_text(encoding="utf-8")
    )["authenticationRequiredExitCode"]


def _stop_process_group(process: subprocess.Popen) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def _execute(arguments: list[str], environment: dict[str, str], deadline: float,
             payload: bytes | None = None) -> tuple[int, bytes]:
    try:
        process = subprocess.Popen(
            ["/usr/bin/sandbox-exec", "-p", SANDBOX_PROFILE, CLI, *arguments, *CLI_FLAGS],
            stdin=subprocess.PIPE if payload is not None else subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment,
            cwd=Path(__file__).parent, start_new_session=True,
        )
    except OSError:
        raise VaultUnavailable("Infisical or its macOS noninteractive guard is unavailable") from None

    def cancel_operation(_signal: int, _frame: object) -> None:
        raise VaultUnavailable("Infisical operation cancelled")

    previous_handler = signal.signal(signal.SIGTERM, cancel_operation)
    try:
        stdout, _ = process.communicate(input=payload, timeout=max(0, deadline - time.monotonic()))
    except subprocess.TimeoutExpired:
        raise VaultUnavailable("Infisical operation timed out") from None
    except OSError:
        raise VaultUnavailable("Infisical process failed") from None
    finally:
        _stop_process_group(process)
        process.communicate()
        signal.signal(signal.SIGTERM, previous_handler)
    return process.returncode, stdout


def _require_user_session(return_code: int, output: bytes) -> None:
    try:
        status = json.loads(output)
    except (ValueError, UnicodeError):
        raise VaultUnavailable("Infisical CLI login status is unavailable") from None
    sessions = status.get("sessions") if isinstance(status, dict) else None
    if not isinstance(sessions, list):
        raise VaultUnavailable("Infisical CLI returned invalid login status")
    users = [session for session in sessions
             if isinstance(session, dict) and session.get("principalType") == "user"]
    if not sessions or any(user.get("status") in ("expired", "rejected") for user in users):
        raise VaultAuthenticationRequired("Sign in with infisical login in a local terminal, then retry")
    if return_code or len(users) != 1:
        raise VaultUnavailable("Infisical CLI user session could not be verified")
    user = users[0]
    verification = user.get("verification")
    if (user.get("status") != "authenticated" or not isinstance(verification, dict)
            or verification.get("state") != "verified"):
        raise VaultUnavailable("Infisical CLI user session could not be verified")


def run_authenticated_cli(arguments: list[str], *, payload: bytes | None = None) -> bytes:
    environment = {key: os.environ[key] for key in
                   ("HOME", "USER", "LOGNAME", "TMPDIR", "XDG_CONFIG_HOME", "INFISICAL_PROFILE")
                   if key in os.environ}
    environment.update(PATH="/usr/bin:/bin", INFISICAL_DISABLE_UPDATE_CHECK="true")
    deadline = time.monotonic() + TIMEOUT_SECONDS
    _require_user_session(*_execute(["login", "status", "--json"], environment, deadline))
    return_code, output = _execute(arguments, environment, deadline, payload)
    if return_code:
        raise VaultUnavailable("Infisical rejected the web-login operation")
    return output
