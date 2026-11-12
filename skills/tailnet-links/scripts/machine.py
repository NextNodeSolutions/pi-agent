import getpass
import os
import platform
import plistlib
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import deliverables
import previews
import probe
import tailnet
from tailnet import SETUP_HINT, LinkError, run, tailscale

SCRIPTS = Path(__file__).resolve().parent
SERVER_COMMAND = ["/usr/bin/python3", "-I", "-B", str(SCRIPTS / "server.py")]
COMMAND_LINK = Path.home() / ".local/bin/tailnet-link"
LAUNCH_AGENT_LABEL = "fr.nextnode.deliverables"
LAUNCH_AGENT_LOG = Path.home() / "Library/Logs" / (LAUNCH_AGENT_LABEL + ".log")
SYSTEMD_UNIT = "tailnet-link.service"
INSTALL_SCRIPT_URL = "https://tailscale.com/install.sh"
INSTALL_SECONDS = 300
AUTH_KEY_VARIABLE = "TS_AUTHKEY"
OWNER_VARIABLE = "TAILNET_LINK_OWNER"
SERVER_READY_SECONDS = 15
PEER_LIST_SECONDS = 20
CERTIFICATE_SECONDS = 90
HEALTH_PATH = "/" + deliverables.VIEWER_PREFIX + "/viewer.css"
MOUNT = {"Proxy": deliverables.ORIGIN}
# A tagged machine asking itself carries no identity, so the file server answers 403 through a working route.
ROUTED_STATUSES = (200, 403)


def is_serving():
    if not deliverables.OWNER_FILE.is_file():
        return False
    identity = {deliverables.IDENTITY_HEADER: deliverables.owner()}
    return probe.fetch(deliverables.ORIGIN + HEALTH_PATH, identity)[0] == 200


def is_mounted(name):
    return tailnet.handlers(tailnet.serve_config(), name + ":443").get(deliverables.MOUNT_PATH) == MOUNT


def assert_serving(name):
    if not (is_mounted(name) and is_serving()):
        raise LinkError("Files are not served on this machine. " + SETUP_HINT)


def join():
    key = os.environ.get(AUTH_KEY_VARIABLE)
    if platform.system() != "Linux" or not key:
        raise LinkError("This machine is not on the tailnet. Sign in to Tailscale on it, or on a Linux VM export "
                        + AUTH_KEY_VARIABLE + " with a key from `tailnet-link join-key` and run setup again.")
    if not shutil.which("tailscale"):
        run(["sh", "-c", "curl -fsSL " + INSTALL_SCRIPT_URL + " | sh"], INSTALL_SECONDS)
    with tempfile.NamedTemporaryFile("w") as secret:
        secret.write(key)
        secret.flush()
        run(["sudo", "tailscale", "up", "--auth-key=file:" + secret.name, "--operator=" + getpass.getuser()])


def connected_host():
    try:
        return tailnet.host()
    except LinkError:
        join()
        tailnet.host.cache_clear()
        return tailnet.host()


def owner_logins():
    status = tailnet.status()
    own = status["Self"]
    devices = [own] if not own.get("Tags") else [peer for peer in (status.get("Peer") or {}).values() if not peer.get("Tags")]
    users = status.get("User") or {}
    return {users.get(str(device.get("UserID")), {}).get("LoginName") for device in devices} - {None}


def owner_login():
    explicit = os.environ.get(OWNER_VARIABLE)
    if explicit:
        return explicit
    # A machine that just joined learns its peers a moment after tailscale up returns.
    deadline = time.monotonic() + PEER_LIST_SECONDS
    logins = owner_logins()
    while not logins and time.monotonic() < deadline:
        time.sleep(tailnet.POLL_SECONDS)
        logins = owner_logins()
    if len(logins) != 1:
        raise LinkError("Cannot tell whose devices may read published files (logins seen: " + (", ".join(sorted(logins)) or "none")
                        + "). Run: " + OWNER_VARIABLE + "=<tailscale login> tailnet-link setup")
    return logins.pop()


def install_launch_agent():
    plist = Path.home() / "Library/LaunchAgents" / (LAUNCH_AGENT_LABEL + ".plist")
    domain = "gui/" + str(os.getuid())
    job = {"Label": LAUNCH_AGENT_LABEL, "ProgramArguments": SERVER_COMMAND, "RunAtLoad": True, "KeepAlive": True,
           "StandardErrorPath": str(LAUNCH_AGENT_LOG), "ProcessType": "Adaptive"}
    plist.write_bytes(plistlib.dumps(job, sort_keys=False))
    subprocess.run(["launchctl", "bootout", domain + "/" + LAUNCH_AGENT_LABEL], capture_output=True)
    tailnet.wait_until(lambda: not previews.is_listening(deliverables.PORT), SERVER_READY_SECONDS,
                       "Port " + str(deliverables.PORT) + " is still held by another process. Stop it, then run setup again.")
    run(["launchctl", "enable", domain + "/" + LAUNCH_AGENT_LABEL])
    run(["launchctl", "bootstrap", domain, str(plist)])


def install_systemd_unit():
    unit = "\n".join(["[Unit]", "Description=tailnet-link file server", "After=network-online.target",
                      "[Service]", "User=" + getpass.getuser(), "ExecStart=" + " ".join(SERVER_COMMAND), "Restart=always",
                      "[Install]", "WantedBy=multi-user.target", ""])
    with tempfile.NamedTemporaryFile("w") as pending:
        pending.write(unit)
        pending.flush()
        run(["sudo", "install", "-m", "644", pending.name, "/etc/systemd/system/" + SYSTEMD_UNIT])
    run(["sudo", "systemctl", "daemon-reload"])
    run(["sudo", "systemctl", "enable", SYSTEMD_UNIT])
    run(["sudo", "systemctl", "restart", SYSTEMD_UNIT])


SERVICE_INSTALLERS = {"Darwin": install_launch_agent, "Linux": install_systemd_unit}


def mount(name):
    with tailnet.serve_lock():
        current = tailnet.handlers(tailnet.serve_config(), name + ":443").get(deliverables.MOUNT_PATH)
        if current is None:
            tailscale("serve", "--bg", "--set-path=" + deliverables.MOUNT_PATH, deliverables.ORIGIN)
        elif current != MOUNT:
            raise LinkError(deliverables.MOUNT_PATH + " on this machine already serves " + str(current)
                            + ". Review: tailscale serve status")


def link_command():
    COMMAND_LINK.parent.mkdir(parents=True, exist_ok=True)
    if COMMAND_LINK.is_symlink():
        COMMAND_LINK.unlink()
    COMMAND_LINK.symlink_to(SCRIPTS / "tailnet-link")


def setup():
    install_service = SERVICE_INSTALLERS.get(platform.system())
    if not install_service:
        raise LinkError("No file server service for " + platform.system() + ". Supported: " + ", ".join(SERVICE_INSTALLERS))
    name = connected_host()
    tailnet.STATE.mkdir(parents=True, exist_ok=True)
    deliverables.OWNER_FILE.write_text(owner_login() + "\n")
    deliverables.ROOT.mkdir(parents=True, exist_ok=True)
    install_service()
    tailnet.wait_until(is_serving, SERVER_READY_SECONDS, "The file server does not answer on " + deliverables.ORIGIN + ".")
    mount(name)
    root = deliverables.url(name, deliverables.ROOT.resolve())
    tailnet.wait_until(lambda: probe.fetch(root.rstrip("/") + HEALTH_PATH)[0] in ROUTED_STATUSES, CERTIFICATE_SECONDS,
                       root + " does not answer from this machine. Review: tailscale serve status")
    link_command()
    return root
