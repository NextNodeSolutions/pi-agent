import json
import re
import socket
from pathlib import Path

import probe
from tailnet import LinkError, handlers, serve_config, serve_lock, tailscale, wait_until

PORT_OFFSET = 10000
MAX_PORT = 65535
LOOPBACK_ADDRESSES = ("127.0.0.1", "::1")
CONNECT_TIMEOUT_SECONDS = 1
# Serve reaches a server bound to either loopback family only through the name, never through 127.0.0.1 or ::1.
BACKEND_PREFIX = "http://localhost:"
REFUSED_STATUS = 403
ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=\S*$", re.M)
DEV_SERVER_ENV = ASSIGNMENT.findall((Path(__file__).resolve().parent / "dev-server.env").read_text())


def https_port(port):
    return port + PORT_OFFSET if port + PORT_OFFSET <= MAX_PORT else port - PORT_OFFSET


def is_listening(port):
    for address in LOOPBACK_ADDRESSES:
        try:
            socket.create_connection((address, port), CONNECT_TIMEOUT_SECONDS).close()
            return True
        except OSError:
            continue
    return False


def backend_port(site):
    target = site.get("Handlers", {}).get("/", {}).get("Proxy", "")
    port = target[len(BACKEND_PREFIX):]
    return int(port) if target.startswith(BACKEND_PREFIX) and port.isdigit() else None


def owned_ports(config, name):
    backends = {authority: backend_port(site) for authority, site in config.get("Web", {}).items()}
    return sorted(port for authority, port in backends.items()
                  if port and authority == name + ":" + str(https_port(port)))


def url(name, port):
    return "https://" + name + ":" + str(https_port(port))


def assert_host_accepted(port, authority):
    origin = BACKEND_PREFIX + str(port) + "/"
    if probe.fetch(origin, {"Host": authority})[0] != REFUSED_STATUS or probe.fetch(origin)[0] == REFUSED_STATUS:
        return
    raise LinkError("The server on localhost:" + str(port) + " refuses requests for the host " + authority.split(":")[0]
                    + ". Restart it with " + " ".join(DEV_SERVER_ENV) + " in its environment (Vite, Astro), then run this again."
                    + " Another server takes the host through its start command or its environment."
                    + " A change to the project's files needs the human's approval first.")


def ensure(port, name, wait_seconds):
    if not 0 < port <= MAX_PORT:
        raise LinkError("Not a TCP port: " + str(port))
    wait_until(lambda: is_listening(port), wait_seconds,
               "Nothing listens on localhost:" + str(port) + ". Start the server, then run this again.")
    public = https_port(port)
    authority = name + ":" + str(public)
    expected = {"/": {"Proxy": BACKEND_PREFIX + str(port)}}
    with serve_lock():
        current = handlers(serve_config(), authority)
        if not current:
            tailscale("serve", "--bg", "--https=" + str(public), BACKEND_PREFIX + str(port))
        elif current != expected:
            raise LinkError("HTTPS port " + str(public) + " on this machine already serves " + json.dumps(current)
                            + ". Run the server on another port.")
    assert_host_accepted(port, authority)
    return url(name, port)


def unmap(port):
    tailscale("serve", "--https=" + str(https_port(port)), "off")


def remove(port, name):
    with serve_lock():
        if port not in owned_ports(serve_config(), name):
            raise LinkError("No preview of localhost:" + str(port) + " on this machine. See: tailnet-link status")
        unmap(port)


def prune(name):
    with serve_lock():
        dead = [port for port in owned_ports(serve_config(), name) if not is_listening(port)]
        for port in dead:
            unmap(port)
    return dead
