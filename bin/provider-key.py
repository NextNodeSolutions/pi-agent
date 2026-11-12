import json
import os
import re
import subprocess
import sys
from pathlib import Path

VAULT_CONFIG = Path.home() / ".config/agent-secrets/core-vault.json"
MACHINE_CLI = Path(__file__).resolve().with_name("infisical")
# Pi abandons a key command after 10 seconds; the vault lookup, made only for a session without the shell export, stops at half of that so it fails with this script's message instead.
VAULT_DEADLINE_SECONDS = 5
KEY_WRITER = "import os,sys; sys.stdout.write(os.environ[sys.argv[1]])"


class VaultUnavailable(Exception):
    pass


def single_word(output):
    if any(byte in b" \t\r\n" for byte in output):
        raise RuntimeError("Infisical output is not a single value")
    return output


def vault_key(name, config, path):
    environment = {key: value for key, value in os.environ.items() if key != name}
    command = [
        str(MACHINE_CLI), "run", "--projectId", config["projectId"], "--env", config["environment"], "--path", path,
        "--silent", "--", "python3", "-c", KEY_WRITER, name,
    ]
    try:
        result = subprocess.run(command, capture_output=True, timeout=VAULT_DEADLINE_SECONDS, env=environment)
    except (subprocess.TimeoutExpired, OSError) as error:
        raise VaultUnavailable("Infisical did not answer") from error
    if result.returncode or not result.stdout:
        raise VaultUnavailable("Infisical command failed")
    return single_word(result.stdout)


def resolve_key(name):
    if not re.fullmatch(r"[A-Z][A-Z0-9_]*_API_KEY", name):
        raise ValueError("Invalid provider key name")
    config = json.loads(VAULT_CONFIG.read_text())
    paths = [path for path, names in config["exports"].items() if name in names]
    if len(paths) != 1:
        raise ValueError("Provider key must have exactly one vault binding")
    exported = os.environ.get(name)
    if exported:
        return single_word(exported.encode())
    return vault_key(name, config, paths[0])


try:
    if len(sys.argv) != 2:
        raise ValueError("Expected one provider key name")
    sys.stdout.buffer.write(resolve_key(sys.argv[1]))
except BaseException:
    sys.stderr.write("Provider key unavailable. Check the machine identity in the environment, the binding, the secret and the shell export.\n")
    sys.exit(1)
