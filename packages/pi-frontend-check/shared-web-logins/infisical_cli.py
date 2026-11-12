from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import time
from pathlib import Path

AGENT_DIRECTORY = Path(__file__).resolve().parents[3]
MACHINE_CLI = AGENT_DIRECTORY / "bin" / "infisical"
PROTOCOL = json.loads((AGENT_DIRECTORY / "security" / "machine-identity.json").read_text(encoding="utf-8"))
TIMEOUT_SECONDS = 25
CLI_FLAGS = ["--telemetry=false", "--silent"]
# Infisical answers 404 for a project the identity is not a member of, the same as for an absent one.
ACCESS_REFUSED = re.compile(rb"Response Code: 40[134]\b")
FORWARDED_VARIABLES = ("HOME", "USER", "LOGNAME", "TMPDIR", "PATH",
                       PROTOCOL["clientIdVariable"], PROTOCOL["clientSecretVariable"])


class VaultUnavailable(Exception):
    """Safe-to-display store failure; never contains login or subprocess output."""

    exit_code = 1


class MachineIdentityUnavailable(VaultUnavailable):
    exit_code = PROTOCOL["identityUnavailableExitCode"]


def _stop_process_group(process: subprocess.Popen) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def _execute(arguments: list[str], environment: dict[str, str], deadline: float,
             payload: bytes | None = None) -> tuple[int, bytes, bytes]:
    try:
        process = subprocess.Popen(
            [MACHINE_CLI, *arguments, *CLI_FLAGS],
            stdin=subprocess.PIPE if payload is not None else subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment,
            cwd=Path(__file__).parent, start_new_session=True,
        )
    except OSError:
        raise VaultUnavailable("The Infisical machine CLI is unavailable") from None

    def cancel_operation(_signal: int, _frame: object) -> None:
        raise VaultUnavailable("Infisical operation cancelled")

    previous_handler = signal.signal(signal.SIGTERM, cancel_operation)
    try:
        stdout, stderr = process.communicate(input=payload, timeout=max(0, deadline - time.monotonic()))
    except subprocess.TimeoutExpired:
        raise VaultUnavailable("Infisical operation timed out") from None
    except OSError:
        raise VaultUnavailable("Infisical process failed") from None
    finally:
        _stop_process_group(process)
        process.communicate()
        signal.signal(signal.SIGTERM, previous_handler)
    return process.returncode, stdout, stderr


def run_machine_cli(arguments: list[str], *, payload: bytes | None = None) -> bytes:
    environment = {key: os.environ[key] for key in FORWARDED_VARIABLES if key in os.environ}
    return_code, output, diagnostics = _execute(arguments, environment, time.monotonic() + TIMEOUT_SECONDS, payload)
    if return_code == MachineIdentityUnavailable.exit_code:
        raise MachineIdentityUnavailable("The Infisical machine identity is missing from the environment or refused")
    if return_code and ACCESS_REFUSED.search(diagnostics):
        raise MachineIdentityUnavailable("The Infisical machine identity has no access to the web-login project")
    if return_code:
        raise VaultUnavailable("Infisical rejected the web-login operation")
    return output
