import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

COMMAND_TIMEOUT = 15
SHELLS = {"bash", "zsh", "sh", "fish"}
SHELL_FLAGS = {"-l", "--login", "-i", "--interactive"}


class Refused(Exception):
    def __init__(self, message, code=1):
        super().__init__(message)
        self.code = code


class Arguments(argparse.ArgumentParser):
    def error(self, message):
        raise Refused(f"usage: close --folder <dir> [--check]: {message}", 64)


def run(*arguments):
    command_output = subprocess.run(arguments, text=True, capture_output=True,
                                    timeout=COMMAND_TIMEOUT, check=False)
    if command_output.returncode:
        raise Refused(command_output.stderr.strip() or command_output.stdout.strip()
                      or f"{arguments[0]} exited {command_output.returncode}")
    return json.loads(command_output.stdout)


def within(cwd, folder):
    return bool(cwd) and Path(cwd).resolve().is_relative_to(folder)


def matches(terminal, folder):
    foreground = terminal.get("foreground") or {}
    key = (terminal.get("labels") or {}).get("worktree.key")
    return (key == str(folder) or within(terminal.get("cwd"), folder)
            or within(foreground.get("cwd"), folder))


def terminals():
    listing = run("herdr-core", "ls", "--all", "--json")["terminals"]
    live = [run("herdr-core", "get", item["address"], "--json")
            for item in listing if item["state"] == "live"]
    return live, {item["address"] for item in listing if item["state"] != "live"}


def tab_id(terminal):
    return (terminal.get("labels") or {}).get("herdr.tab")


def auxiliary_owner(terminal):
    name = terminal.get("name") or ""
    if tab_id(terminal) or terminal.get("parent") or "-" not in name:
        return None
    return name.rsplit("-", 1)[1]


def descendants(all_terminals, members):
    addresses = {member["address"] for member in members}
    while True:
        children = [terminal for terminal in all_terminals
                    if terminal.get("parent") in addresses
                    and terminal["address"] not in addresses]
        if not children:
            return members
        members += children
        addresses.update(child["address"] for child in children)


def verify(member, folder):
    address = member["address"]
    status = member.get("status") or {}
    if status.get("state") == "working" or (member.get("labels") or {}).get("agent.waiting"):
        raise Refused(f"terminal {address} is working or awaiting background work")
    if not matches(member, folder):
        raise Refused(f"tab also contains terminal {address} outside {folder}")
    foreground = member.get("foreground") or {}
    if foreground.get("cwd") and not within(foreground["cwd"], folder):
        raise Refused(f"terminal {address} foreground is outside {folder}")
    if status.get("state") in ("done", "idle"):
        return
    shell_arguments = foreground.get("argv") or []
    if (not status and foreground.get("name") in SHELLS and shell_arguments
            and all(argument in SHELL_FLAGS for argument in shell_arguments[1:])):
        return
    raise Refused(f"terminal {address} cannot report an idle agent status", 3)


def caller_tab(members):
    by_address = {member["address"]: member for member in members}
    address = os.environ.get("HC_TERMINAL_ID")
    visited = set()
    while address in by_address and address not in visited:
        member = by_address[address]
        if tab_id(member):
            return tab_id(member)
        visited.add(address)
        address = member.get("parent")
    return None


def inspect(folder):
    all_terminals, finished = terminals()
    matching = [terminal for terminal in all_terminals if matches(terminal, folder)]
    tabs = {tab_id(terminal) for terminal in matching if tab_id(terminal)}
    members = descendants(all_terminals, [terminal for terminal in all_terminals
                                        if tab_id(terminal) in tabs])
    member_addresses = {member["address"] for member in members}
    auxiliaries = {terminal["address"] for terminal in all_terminals
                   if auxiliary_owner(terminal) in member_addresses
                   or (auxiliary_owner(terminal) in finished and matches(terminal, folder))}
    if any(terminal["address"] not in member_addresses | auxiliaries for terminal in matching):
        raise Refused("matching terminal has no tab or parent tab", 3)
    for member in members:
        verify(member, folder)
    caller = os.environ.get("HC_TERMINAL_ID")
    own_tab = caller_tab(members)
    ordered_tabs = sorted(tabs, key=lambda tab: (tab == own_tab, tab))
    return {"status": "ready", "tabs": ordered_tabs,
            "terminals": sorted(member["address"] for member in members),
            "auxiliaries": sorted(auxiliaries),
            "caller": any(member["address"] == caller for member in members)}


def close(folder):
    plan = inspect(folder)
    for address in plan["auxiliaries"]:
        run("herdr-core", "kill", address, "--json")
        run("herdr-core", "rm", address, "--json")
    for tab in plan["tabs"]:
        current = inspect(folder)
        if tab not in current["tabs"]:
            raise Refused(f"tab {tab} changed during cleanup")
        response = run("herdr-app", "do", "tab.close", "--id", tab, "--confirmed", "true")
        if response.get("ok") is not True:
            raise Refused(f"tab {tab} could not be closed: {response}")
    return {**plan, "status": "closed" if plan["tabs"] or plan["auxiliaries"] else "absent"}


def main():
    parser = Arguments(prog="herdr close")
    parser.add_argument("--folder", required=True)
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    folder = Path(arguments.folder).resolve()
    if arguments.check:
        print(json.dumps(inspect(folder)), flush=True)
        return
    print(json.dumps(close(folder)), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Refused as error:
        print(f"herdr adapter: {error}", file=sys.stderr)
        sys.exit(error.code)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(f"herdr adapter: {error}", file=sys.stderr)
        sys.exit(1)
