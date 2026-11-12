import base64
import json
import os
import sys

import announce
import deliverables
import joinkey
import links
import machine
import previews
import tailnet
from rewrite import rewrite
from tailnet import LinkError

USAGE = """usage: tailnet-link <target>...   print one HTTPS tailnet URL per target
       tailnet-link status          previews with their server state, and the file server
       tailnet-link remove <port>   stop previewing a local port
       tailnet-link prune           remove the previews whose server is gone
       tailnet-link setup           join the tailnet when needed, then serve this machine's files
       tailnet-link join-key        print a one-off key that joins one Linux VM, for a pipe only

A target is a file, a directory, a port (4321) or a local URL (http://localhost:4321/page).
A file or a directory is copied to the published root; link it again after changing it.
A port is previewed on its number plus 10000, or minus 10000 above 55535, for as long as its server runs.
Name a file called like a command with its path: ./status"""
PORT_WAIT_SECONDS = 20
USAGE_EXIT = 2


def show_status(_arguments):
    name = tailnet.host()
    for port in previews.owned_ports(tailnet.serve_config(), name):
        state = "live" if previews.is_listening(port) else "dead: restart the server on this port, or run tailnet-link prune"
        print(previews.url(name, port) + "  ->  localhost:" + str(port) + "  " + state)
    is_serving = machine.is_mounted(name) and machine.is_serving()
    root = deliverables.url(name, deliverables.ROOT.resolve())
    print(root + "  ->  " + str(deliverables.ROOT) + "  " + ("live" if is_serving else "down: run tailnet-link setup"))


def remove(arguments):
    if len(arguments) != 1 or not arguments[0].isdecimal():
        raise LinkError("remove takes the local port of one preview, as listed by: tailnet-link status")
    previews.remove(int(arguments[0]), tailnet.host())


def prune(_arguments):
    for port in previews.prune(tailnet.host()):
        print("removed the preview of localhost:" + str(port))


def setup(_arguments):
    print(machine.setup())


def rewrite_texts(arguments):
    texts = json.loads(base64.b64decode(arguments[0]))
    converter = links.Converter(os.getcwd())
    print(json.dumps({"texts": [rewrite(text, converter.url_for) for text in texts], "notes": converter.notes}))


def print_join_key(_arguments):
    if sys.stdout.isatty():
        raise LinkError("join-key prints a credential. Pipe it to the command that joins the VM.")
    print(joinkey.mint())


COMMANDS = {"status": show_status, "remove": remove, "prune": prune, "setup": setup, "rewrite": rewrite_texts,
            "join-key": print_join_key, "announce": announce.watch}


def link_targets(arguments):
    for target in arguments:
        print(links.link(target, PORT_WAIT_SECONDS))


def main():
    arguments = sys.argv[1:]
    if not arguments or arguments[0] in ("-h", "--help", "help"):
        print(USAGE)
        return 0 if arguments else USAGE_EXIT
    command = COMMANDS.get(arguments[0])
    try:
        command(arguments[1:]) if command else link_targets(arguments)
    except (LinkError, OSError) as error:
        print("tailnet-link: " + str(error), file=sys.stderr)
        return 1
    return 0
