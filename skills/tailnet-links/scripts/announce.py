import os
import re
import signal
import sys
import termios
import time
from collections import namedtuple
from pathlib import Path

import links
import listeners
from rewrite import TRAILING_PUNCTUATION
from tailnet import LinkError, run

TERMINAL_VARIABLE = "HC_TERMINAL_ID"
TTY = "/dev/tty"
LOCAL_FLAGS = 3
POLL_SECONDS = 1
WATCH_SECONDS = 60
HISTORY_LINES = "200"
# ps exits 1 for a process that ended, which is an answer here and not a failure.
PARENT_EXITS = (0, 1)
URL_END = r"\s\x00-\x1f\x7f\"'`<>()\[\]{}|"
SHOWN_URL = re.compile(r"http://(?:\[[0-9A-Fa-f:]+\])?[^" + URL_END + "]*")
LINK_LINE = "  ➜  Tailnet: "
FAILURE_LINE = "  ➜  tailnet-link: "
Command = namedtuple("Command", "terminal shell record serial typed_row")


def is_line_mode(tty):
    try:
        return bool(termios.tcgetattr(tty)[LOCAL_FLAGS] & termios.ICANON)
    except termios.error:
        return False


def last_row(screen):
    return next((row.rstrip() for row in reversed(screen.splitlines()) if row.strip()), "")


# A shell keeps the hook it loaded while these scripts change, so a call this version cannot read ends without a word.
def typed_command(arguments):
    terminal = os.environ.get(TERMINAL_VARIABLE)
    if not terminal or len(arguments) != 3 or not arguments[0].isdigit():
        return None
    shell, record, serial = arguments
    return Command(terminal, int(shell), Path(record), serial, last_row(sys.stdin.read()))


# The shell rewrites its record at each prompt and each command, and a shell that ended is no longer the parent.
def is_running(command):
    try:
        return os.getppid() == command.shell and command.record.read_text().strip() == command.serial
    except OSError:
        return False


# Every shell of a terminal runs its own watcher, so a job is announced by the one whose shell started it.
def is_started_by(shell, job):
    # A program the shell became through exec keeps the shell's process number.
    if job == shell:
        return True
    parent = run(["ps", "-o", "ppid=", "-p", str(job)], accepted_exits=PARENT_EXITS)
    return not parent or int(parent) == shell


# The screen keeps what earlier commands printed, so a URL counts from the row of this command down.
def printed(screen, typed_row):
    rows = [row.rstrip() for row in screen.splitlines()]
    starts = [index for index, row in enumerate(rows) if row == typed_row]
    return "\n".join(rows[starts[-1]:] if typed_row and starts else rows)


# The first URL a program shows for a port is its entry page, so that one is linked.
def shown_servers(command):
    screen = run(["hc", "read", command.terminal, "--lines", HISTORY_LINES])
    urls = SHOWN_URL.findall(printed(screen, command.typed_row))
    servers = [links.local_server(url.rstrip(TRAILING_PUNCTUATION)) for url in urls]
    return {server.port: server for server in reversed(servers) if server}


def pending(command, job, attempted):
    ports = listeners.group_ports(job) - attempted
    return {port: server for port, server in shown_servers(command).items() if port in ports} if ports else {}


def line(server):
    try:
        return LINK_LINE + links.preview(server, 0)
    except LinkError as error:
        return FAILURE_LINE + str(error)


def announce(tty, job, servers):
    for server in servers.values():
        text = line(server) + "\n"
        # Linking takes seconds, so the line is dropped when the program left the terminal or took its screen meanwhile.
        if os.tcgetpgrp(tty) == job and is_line_mode(tty):
            os.write(tty, text.encode())
    return set(servers)


# A program that opens a port raises no event, so the foreground job is read on a timer while it may still start one.
def watch(arguments):
    command = typed_command(arguments)
    if not command:
        return
    signal.signal(signal.SIGTTOU, signal.SIG_IGN)
    tty = os.open(TTY, os.O_RDWR | os.O_NOCTTY)
    job, is_own, attempted, deadline = None, False, set(), time.monotonic() + WATCH_SECONDS
    while is_running(command) and time.monotonic() < deadline:
        foreground = os.tcgetpgrp(tty)
        if foreground != job:
            job, is_own, deadline = foreground, is_started_by(command.shell, foreground), time.monotonic() + WATCH_SECONDS
        # A program that reads its keys itself draws its own screen, so a line is written only under one that prints lines.
        if is_own and is_line_mode(tty):
            attempted |= announce(tty, job, pending(command, job, attempted))
        time.sleep(POLL_SECONDS)
