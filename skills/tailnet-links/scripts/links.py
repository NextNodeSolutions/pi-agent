import functools
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit, urlunsplit

import deliverables
import machine
import previews
import tailnet
from tailnet import LinkError

LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1", "0.0.0.0")
DEFAULT_HTTP_PORT = 80
SCHEMELESS_LOCAL = re.compile(r"(localhost|127\.0\.0\.1)(:\d+)?(/.*)?")
DOCUMENT_SUFFIXES = (
    ".html", ".htm", ".md", ".markdown", ".pdf", ".csv", ".xlsx", ".docx", ".pptx",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".mp4", ".mov", ".webm", ".mp3", ".wav",
)


def local_server(target):
    written = "http://localhost:" + target if target.isdigit() else target
    parsed = urlsplit("http://" + written if SCHEMELESS_LOCAL.fullmatch(written) else written)
    return parsed if parsed.scheme == "http" and parsed.hostname in LOCAL_HOSTS else None


def preview(server, wait_seconds):
    base = previews.ensure(server.port or DEFAULT_HTTP_PORT, tailnet.host(), wait_seconds)
    return urlunsplit(("https", urlsplit(base).netloc, server.path, server.query, server.fragment))


def published(path):
    name = tailnet.host()
    machine.assert_serving(name)
    return deliverables.url(name, deliverables.publish(path))


def link(target, wait_seconds):
    server = local_server(target)
    if server:
        return preview(server, wait_seconds)
    parsed = urlsplit(target)
    if parsed.scheme in ("http", "https"):
        raise LinkError("Only a local file, a directory or a localhost server can be linked, not " + target)
    return published(unquote(parsed.path) if parsed.scheme == "file" else target)


def existing_document(written, directory):
    try:
        path = Path(directory, Path(written).expanduser())
        return path if path.suffix.lower() in DOCUMENT_SUFFIXES and path.is_file() else None
    except (OSError, ValueError):
        return None


# A path is read as written first, so a file whose name holds a percent sign still converts.
def document(target, directory):
    parsed = urlsplit(target)
    written = unquote(parsed.path) if parsed.scheme == "file" else target
    return existing_document(written, directory) or existing_document(unquote(written), directory)


class Converter:
    def __init__(self, directory):
        self.directory = directory
        self.notes = []
        self.url_for = functools.lru_cache(maxsize=None)(self.convert)

    def convert(self, target):
        server = local_server(target)
        path = None if server else document(target, self.directory)
        if not path and not (server and previews.is_listening(server.port or DEFAULT_HTTP_PORT)):
            return None
        try:
            return preview(server, 0) if server else published(path)
        except (LinkError, OSError) as error:
            if str(error) not in self.notes:
                self.notes.append(str(error))
            return None
