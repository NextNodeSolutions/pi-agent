import json
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from tailnet import LinkError

BINDING = Path.home() / ".config/agent-secrets/core-vault.json"
MACHINE_CLI = Path(__file__).resolve().parents[3] / "bin" / "infisical"
CLIENT_SECRET_NAME = "TAILSCALE_OAUTH_CLIENT_SECRET"
CLIENT_SECRET_PREFIX = "tskey-client-"
API = "https://api.tailscale.com/api/v2"
TOKEN_URL = API + "/oauth/token"
KEYS_URL = API + "/tailnet/-/keys"
KEY_SCOPE = "auth_keys"
AGENT_TAG = "tag:agent"
KEY_LIFETIME_SECONDS = 600
KEY_DESCRIPTION = "tailnet-link agent VM"
VAULT_SECONDS = 30
API_SECONDS = 20
NO_BINDING = str(BINDING) + " names no vault path for Tailscale. Record it as tools.tailscale.path."
NO_CLIENT_SECRET = ("The vault did not return " + CLIENT_SECRET_NAME + " to the machine identity. Check that this shell exports "
                    "INFISICAL_UNIVERSAL_AUTH_CLIENT_ID and its secret, and the path that " + str(BINDING)
                    + " names as tools.tailscale.path.")
NO_ANSWER = "Tailscale did not answer the join key request. Run it again."
CLIENT_REFUSED = ("Tailscale refused the OAuth client (HTTP {status}). Check that " + CLIENT_SECRET_NAME
                  + " is the secret of a client that still exists.")
KEY_REFUSED = ("Tailscale refused the join key request (HTTP {status}). Check that the OAuth client has the " + KEY_SCOPE
               + " scope with " + AGENT_TAG + ", and that the tailnet policy lists " + AGENT_TAG + " in tagOwners.")


def vault_command():
    try:
        binding = json.loads(BINDING.read_text())
        location = ["--projectId", binding["projectId"], "--env", binding["environment"],
                    "--path", binding["tools"]["tailscale"]["path"]]
    except (OSError, ValueError, KeyError, TypeError):
        raise LinkError(NO_BINDING) from None
    return [str(MACHINE_CLI), "secrets", "get", CLIENT_SECRET_NAME, *location, "--plain", "--silent"]


# Whatever the vault command prints may hold the secret, so a failure reports a fixed message only.
def client_secret():
    try:
        result = subprocess.run(vault_command(), capture_output=True, text=True, timeout=VAULT_SECONDS)
    except (OSError, subprocess.TimeoutExpired):
        raise LinkError(NO_CLIENT_SECRET) from None
    words = result.stdout.split()
    if result.returncode or len(words) != 1 or not words[0].startswith(CLIENT_SECRET_PREFIX):
        raise LinkError(NO_CLIENT_SECRET)
    return words[0]


def ask(request, refusal, field):
    try:
        with urllib.request.urlopen(request, timeout=API_SECONDS) as response:
            return json.load(response)[field]
    except urllib.error.HTTPError as error:
        raise LinkError(refusal.format(status=error.code)) from None
    except (OSError, ValueError, KeyError, TypeError):
        raise LinkError(NO_ANSWER) from None


def access_token():
    grant = {"grant_type": "client_credentials", "client_secret": client_secret()}
    request = urllib.request.Request(TOKEN_URL, data=urllib.parse.urlencode(grant).encode())
    return ask(request, CLIENT_REFUSED, "access_token")


def mint():
    device = {"reusable": False, "ephemeral": True, "preauthorized": True, "tags": [AGENT_TAG]}
    order = {"capabilities": {"devices": {"create": device}}, "expirySeconds": KEY_LIFETIME_SECONDS,
             "description": KEY_DESCRIPTION}
    headers = {"Authorization": "Bearer " + access_token(), "Content-Type": "application/json"}
    request = urllib.request.Request(KEYS_URL, data=json.dumps(order).encode(), headers=headers)
    return ask(request, KEY_REFUSED, "key")
