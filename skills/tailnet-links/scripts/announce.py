import os
import re
import signal
import sys
import termios
import time
from collections import Counter, namedtuple
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
LIMIT_SECONDS = 600
# ps exits 1 for a process that ended.
ENDED_EXITS = (1,)
URL_END = r"\s\x00-\x1f\x7f\"'`<>()\[\]{}|"
SHOWN_URL = re.compile(r"http://(?:\[[0-9A-Fa-f:]+\])?[^" + URL_END + "]*")
LINK_LINE = "  ➜  Tailnet: "
FAILURE_LINE = "  ➜  tailnet-link: "
Command = namedtuple("Command", "terminal shell record serial history_lines shown")


def is_line_mode(tty):
    try:
        return bool(termios.tcgetattr(tty)[LOCAL_FLAGS] & termios.ICANON)
    except termios.error:
        return False


def shown_urls(screen):
    return [url.rstrip(TRAILING_PUNCTUATION) for url in SHOWN_URL.findall(screen)]


# A shell keeps the hook it loaded while these scripts change, so a call this version cannot read ends without a word.
def typed_command(arguments):
    terminal = os.environ.get(TERMINAL_VARIABLE)
    if not terminal or len(arguments) != 4 or not (arguments[0].isdecimal() and arguments[3].isdecimal()):
        return None
    shell, record, serial, history_lines = arguments
    return Command(terminal, int(shell), Path(record), serial, history_lines, Counter(shown_urls(sys.stdin.read())))


# The shell rewrites its record at each prompt and each command, and a shell that ended is no longer the parent.
def is_running(command):
    try:
        return os.getppid() == command.shell and command.record.read_text().strip() == command.serial
    except OSError:
        return False


# Every shell of a terminal runs its own watcher, so a job is announced by the one whose shell started it.
def is_started_by(command, job):
    # A program the shell became through exec keeps the shell's process number.
    if job == command.shell:
        return True
    # A shell that has a record runs its own watcher, and its record stays when it becomes a program through exec.
    if command.record.with_name(str(job)).exists():
        return False
    parent = run(["ps", "-o", "ppid=", "-p", str(job)], empty_exits=ENDED_EXITS)
    return not parent or int(parent) == command.shell


# The terminal keeps the typed command and what earlier commands printed, so a URL is this command's once the
# terminal shows it more often than when the command started.
def added_urls(command, screen):
    seen = Counter()
    for url in shown_urls(screen):
        seen[url] += 1
        if seen[url] > command.shown[url]:
            yield url


# The first URL a program shows for a port is its entry page, so that one is linked.
def shown_servers(command):
    screen = run(["hc", "read", command.terminal, "--lines", command.history_lines])
    servers = [links.local_server(url) for url in added_urls(command, screen)]
    return {server.port: server for server in reversed(servers) if server}


def pending(command, job, attempted):
    ports = listeners.group_ports(job) - attempted
    return {port: server for port, server in shown_servers(command).items() if port in ports} if ports else {}


def line(server):
    try:
        return LINK_LINE + links.preview(server, 0)
    except LinkError as error:
        return FAILURE_LINE + str(error)


# A link takes seconds to make. The command may end, leave the terminal or take its screen meanwhile, so it is
# checked before each link and again before each line.
def is_showing(command, tty, job):
    return is_running(command) and os.tcgetpgrp(tty) == job and is_line_mode(tty)


def announce(command, tty, job, servers):
    attempted = set()
    for port, server in servers.items():
        if not is_showing(command, tty, job):
            break
        text = line(server) + "\n"
        if is_showing(command, tty, job):
            os.write(tty, text.encode())
        attempted.add(port)
    return attempted


# A program that opens a port raises no event, so the foreground job is read on a timer while it may still start one.
def watch(arguments):
    command = typed_command(arguments)
    if not command:
        return
    signal.signal(signal.SIGTTOU, signal.SIG_IGN)
    tty = os.open(TTY, os.O_RDWR | os.O_NOCTTY)
    # Each program that takes the terminal renews the watch, so a command that runs programs without end needs its own limit.
    limit = time.monotonic() + LIMIT_SECONDS
    job, is_own, attempted, deadline = None, False, set(), time.monotonic() + WATCH_SECONDS
    while is_running(command) and time.monotonic() < min(deadline, limit):
        foreground = os.tcgetpgrp(tty)
        if foreground != job:
            job, is_own, deadline = foreground, is_started_by(command, foreground), time.monotonic() + WATCH_SECONDS
        # A program that reads its keys itself draws its own screen, so a line is written only under one that prints lines.
        if is_own and is_line_mode(tty):
            attempted |= announce(command, tty, job, pending(command, job, attempted))
        time.sleep(POLL_SECONDS)
