import json
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

from tailnet import LinkError

BINDING = Path.home() / ".config/agent-secrets/core-vault.json"
API_KEY_NAME = "TAILSCALE_API_KEY"
API_KEY_PREFIX = "tskey-api-"
KEYS_URL = "https://api.tailscale.com/api/v2/tailnet/-/keys"
AGENT_TAG = "tag:agent"
KEY_LIFETIME_SECONDS = 600
KEY_DESCRIPTION = "tailnet-link agent VM"
VAULT_SECONDS = 30
API_SECONDS = 20
NO_BINDING = str(BINDING) + " names no vault path for Tailscale. Record it as tools.tailscale.path."
NO_API_KEY = ("The vault did not return " + API_KEY_NAME + ". Run `infisical login` on this machine, and check the path that "
              + str(BINDING) + " names as tools.tailscale.path.")
NO_ANSWER = "Tailscale did not answer the join key request. Run it again."


def vault_command():
    try:
        binding = json.loads(BINDING.read_text())
        location = ["--domain", binding["domain"], "--projectId", binding["projectId"], "--env", binding["environment"],
                    "--path", binding["tools"]["tailscale"]["path"]]
    except (OSError, ValueError, KeyError, TypeError):
        raise LinkError(NO_BINDING) from None
    return ["infisical", "secrets", "get", API_KEY_NAME, *location, "--plain", "--silent"]


# Whatever the vault command prints may hold the key, so a failure reports a fixed message only.
def api_key():
    try:
        result = subprocess.run(vault_command(), capture_output=True, text=True, timeout=VAULT_SECONDS)
    except (OSError, subprocess.TimeoutExpired):
        raise LinkError(NO_API_KEY) from None
    words = result.stdout.split()
    if result.returncode or len(words) != 1 or not words[0].startswith(API_KEY_PREFIX):
        raise LinkError(NO_API_KEY)
    return words[0]


def mint():
    device = {"reusable": False, "ephemeral": True, "preauthorized": True, "tags": [AGENT_TAG]}
    order = {"capabilities": {"devices": {"create": device}}, "expirySeconds": KEY_LIFETIME_SECONDS,
             "description": KEY_DESCRIPTION}
    headers = {"Authorization": "Bearer " + api_key(), "Content-Type": "application/json"}
    request = urllib.request.Request(KEYS_URL, data=json.dumps(order).encode(), headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=API_SECONDS) as response:
            return json.load(response)["key"]
    except urllib.error.HTTPError as error:
        raise LinkError("Tailscale refused the join key request (HTTP " + str(error.code) + "). Check that " + API_KEY_NAME
                        + " is still valid and that the tailnet policy lists " + AGENT_TAG + " in tagOwners.") from None
    except (OSError, ValueError, KeyError):
        raise LinkError(NO_ANSWER) from None
