import re

from tailnet import run

TCP = "-iTCP"
LISTEN_STATE = "-sTCP:LISTEN"
# A listing takes milliseconds, and the watcher and the root page both wait on it.
TIMEOUT_SECONDS = 5
# lsof exits 1 when nothing matches. Its warnings are turned off, so what it writes then is a failure.
NO_MATCH_EXITS = (1,)
PORT = re.compile(r"^n.*:(\d+)$", re.M)
PROCESS = re.compile(r"^p(\d+)$", re.M)
NAME = re.compile(r"^n(.+)$", re.M)


def lsof(*selection):
    return run(["lsof", "-w", "-nP", "-a", *selection], TIMEOUT_SECONDS, NO_MATCH_EXITS)


def group_ports(group):
    return {int(port) for port in PORT.findall(lsof("-g", str(group), TCP, LISTEN_STATE, "-Fn"))}


def directory(port):
    owners = PROCESS.findall(lsof(TCP + ":" + str(port), LISTEN_STATE, "-Fp"))
    if not owners:
        return None
    return next(iter(NAME.findall(lsof("-p", owners[0], "-d", "cwd", "-Fn"))), None)
