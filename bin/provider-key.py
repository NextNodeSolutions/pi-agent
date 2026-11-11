import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

VAULT_CONFIG = Path.home() / ".config/agent-secrets/core-vault.json"
# Pi abandons a key command after 10 seconds, so the vault gets half and the shell export answers in the rest.
VAULT_DEADLINE_SECONDS = 5
KEY_WRITER = "import os,sys; sys.stdout.write(os.environ[sys.argv[1]])"
IDENTITY_VARIABLES = ("INFISICAL_UNIVERSAL_AUTH_CLIENT_ID", "INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET")


class VaultUnavailable(Exception):
    pass


def run(command, environment, deadline):
    try:
        result = subprocess.run(command, capture_output=True, timeout=deadline - time.monotonic(), env=environment)
    except (subprocess.TimeoutExpired, OSError) as error:
        raise VaultUnavailable("Infisical did not answer") from error
    if result.returncode or not result.stdout:
        raise VaultUnavailable("Infisical command failed")
    return result.stdout


def single_word(output):
    if any(byte in b" \t\r\n" for byte in output):
        raise RuntimeError("Infisical output is not a single value")
    return output


def access_token(config, environment, deadline):
    if any(not environment.get(name) for name in IDENTITY_VARIABLES):
        raise RuntimeError("No Infisical machine identity in the environment")
    command = ["infisical", "login", "--method=universal-auth", "--silent", "--plain", "--domain", config["domain"]]
    return single_word(run(command, environment, deadline).strip()).decode()


def vault_key(name, config, path):
    deadline = time.monotonic() + VAULT_DEADLINE_SECONDS
    environment = {key: value for key, value in os.environ.items() if key != name}
    command = [
        "infisical", "run", "--token", access_token(config, environment, deadline), "--domain", config["domain"],
        "--projectId", config["projectId"], "--env", config["environment"], "--path", path, "--silent",
        "--", "python3", "-c", KEY_WRITER, name,
    ]
    return single_word(run(command, environment, deadline))


def shell_export(name):
    exported = os.environ.get(name)
    if not exported:
        raise RuntimeError("Vault unavailable and no shell export of the key")
    return single_word(exported.encode())


def resolve_key(name):
    if not re.fullmatch(r"[A-Z][A-Z0-9_]*_API_KEY", name):
        raise ValueError("Invalid provider key name")
    config = json.loads(VAULT_CONFIG.read_text())
    paths = [path for path, names in config["exports"].items() if name in names]
    if len(paths) != 1:
        raise ValueError("Provider key must have exactly one vault binding")
    try:
        return vault_key(name, config, paths[0])
    except VaultUnavailable:
        return shell_export(name)


try:
    if len(sys.argv) != 2:
        raise ValueError("Expected one provider key name")
    sys.stdout.buffer.write(resolve_key(sys.argv[1]))
except BaseException:
    sys.stderr.write("Provider key unavailable. Check the machine identity in the environment, the binding, the secret and the shell export.\n")
    sys.exit(1)
