import re

from tailnet import run

TCP = "-iTCP"
LISTEN_STATE = "-sTCP:LISTEN"
# A listing takes milliseconds, and the watcher and the root page both wait on it.
TIMEOUT_SECONDS = 5
# lsof exits 1 when nothing matches. Its warnings are turned off, so what it writes then is a failure.
NO_MATCH_EXITS = (1,)
PROCESS_COLUMNS = "pid=,ppid=,pgid="
PORT = re.compile(r"^n.*:(\d+)$", re.M)
PROCESS = re.compile(r"^p(\d+)$", re.M)
NAME = re.compile(r"^n(.+)$", re.M)
ROW = re.compile(r"^\s*(\d+)\s+(\d+)\s+(\d+)\s*$", re.M)


def lsof(*selection):
    return run(["lsof", "-w", "-nP", "-a", *selection], TIMEOUT_SECONDS, NO_MATCH_EXITS)


def with_descendants(children, roots):
    found, waiting = set(roots), list(roots)
    while waiting:
        started = [child for child in children.get(waiting.pop(), ()) if child not in found]
        found.update(started)
        waiting += started
    return found


# A task runner such as turbo gives the program it starts a process group and a terminal of its own, so the group of
# the job holds none of its ports, and its programs are found by the parent they keep.
def job_processes(job):
    children, group_members = {}, set()
    for process, parent, group in ROW.findall(run(["ps", "-axo", PROCESS_COLUMNS], TIMEOUT_SECONDS)):
        children.setdefault(parent, []).append(process)
        if group == job:
            group_members.add(process)
    return with_descendants(children, group_members)


def job_ports(job):
    processes = job_processes(str(job))
    # lsof keeps every process when no process is named, which would be every server of the machine.
    if not processes:
        return set()
    return {int(port) for port in PORT.findall(lsof("-p", ",".join(processes), TCP, LISTEN_STATE, "-Fn"))}


def directory(port):
    owners = PROCESS.findall(lsof(TCP + ":" + str(port), LISTEN_STATE, "-Fp"))
    if not owners:
        return None
    return next(iter(NAME.findall(lsof("-p", owners[0], "-d", "cwd", "-Fn"))), None)
