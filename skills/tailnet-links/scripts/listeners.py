import re

from tailnet import completed

TCP = "-iTCP"
LISTEN_STATE = "-sTCP:LISTEN"
PORT = re.compile(r"^n.*:(\d+)$", re.M)


# lsof exits 1 when nothing matches, which is an answer here and not a failure.
def lsof(*selection):
    return completed(["lsof", "-nP", "-a", *selection]).stdout


def group_ports(group):
    return {int(port) for port in PORT.findall(lsof("-g", str(group), TCP, LISTEN_STATE, "-Fn"))}
