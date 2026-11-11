import os
import re
import signal
import termios
import time

import links
import listeners
from rewrite import TRAILING_PUNCTUATION
from tailnet import LinkError, run

TERMINAL_VARIABLE = "HC_TERMINAL_ID"
TERMINAL = "/dev/tty"
LOCAL_FLAGS = 3
POLL_SECONDS = 1
WATCH_SECONDS = 60
HISTORY_LINES = "200"
SHOWN_URL = re.compile(r"http://[^\s\"'<>()|]+")
LINK_LINE = "  ➜  Tailnet: "
FAILURE_LINE = "  ➜  tailnet-link: "


def is_line_mode(terminal):
    return bool(termios.tcgetattr(terminal)[LOCAL_FLAGS] & termios.ICANON)


def shown_server(url):
    try:
        server = links.local_server(url.rstrip(TRAILING_PUNCTUATION))
        return (server.port or links.DEFAULT_HTTP_PORT, server) if server else None
    except ValueError:
        return None


# The first URL a program shows for a port is its entry page, so that one is linked.
def shown_servers(address):
    screen = run(["hc", "read", address, "--lines", HISTORY_LINES])
    servers = [server for server in map(shown_server, SHOWN_URL.findall(screen)) if server]
    return dict(reversed(servers))


def pending(address, job, announced):
    ports = listeners.group_ports(job) - announced
    return {port: server for port, server in shown_servers(address).items() if port in ports} if ports else {}


def line(server):
    try:
        return LINK_LINE + links.preview(server, 0)
    except LinkError as error:
        return FAILURE_LINE + str(error)


def announce(terminal, servers):
    for server in servers.values():
        os.write(terminal, (line(server) + "\n").encode())
    return set(servers)


# A program that opens a port raises no event, so the foreground job is read on a timer while it may still start one.
def watch(_arguments):
    address = os.environ.get(TERMINAL_VARIABLE)
    if not address:
        raise LinkError("announce runs in a Herdr terminal, which " + TERMINAL_VARIABLE + " names. Link a port with: tailnet-link <port>")
    signal.signal(signal.SIGTTOU, signal.SIG_IGN)
    terminal = os.open(TERMINAL, os.O_RDWR | os.O_NOCTTY)
    shell = os.getpgid(os.getppid())
    job, deadline, announced = shell, time.monotonic() + WATCH_SECONDS, set()
    while time.monotonic() < deadline:
        foreground = os.tcgetpgrp(terminal)
        if foreground != job:
            job, deadline = foreground, time.monotonic() + WATCH_SECONDS
        # A program that draws the whole screen keeps it, so a line is written only under one that prints lines.
        if job != shell and is_line_mode(terminal):
            announced |= announce(terminal, pending(address, job, announced))
        time.sleep(POLL_SECONDS)
