import html
import mimetypes
import re
import sys
from datetime import datetime
from email.utils import formatdate
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

import deliverables

VIEWER = Path(__file__).resolve().parent / "viewer"
PAGE = (VIEWER / "page.html").read_text()
ASSETS = deliverables.MOUNT_PATH + "/" + deliverables.VIEWER_PREFIX
MARKDOWN_SUFFIXES = (".md", ".markdown")
MARKDOWN_TYPE = "text/markdown"
UNREGISTERED_TYPES = {".webp": "image/webp", ".avif": "image/avif"}
RAW_QUERY = "raw"
INDEX_NAME = "index.html"
RANGE = re.compile(r"bytes=(\d*)-(\d*)")
CHUNK_BYTES = 256 * 1024
KILOBYTE = 1024
DOCUMENT = '<article id="document"></article><script type="module" src="' + ASSETS + '/viewer.js"></script>'
REFUSAL = ("<h1>Not your device</h1><p>Published files open only on a device signed in to Tailscale as the owner of"
           " this machine. Servers and cloud machines are refused.</p>")
PARENT_ROW = '<li><a href="../">../</a></li>'

for suffix, kind in UNREGISTERED_TYPES.items():
    mimetypes.add_type(kind, suffix)


def locate(path):
    parts = [part for part in path.split("/") if part]
    is_asset = parts[:1] == [deliverables.VIEWER_PREFIX]
    served = parts[1:] if is_asset else parts
    if not all(map(deliverables.is_published, served)):
        return None
    base = (VIEWER if is_asset else deliverables.ROOT).resolve()
    try:
        candidate = base.joinpath(*served).resolve()
    except (OSError, ValueError):
        return None
    is_inside = candidate == base or base in candidate.parents
    return candidate if is_inside and candidate.exists() else None


def content_type(target):
    guessed = MARKDOWN_TYPE if target.suffix.lower() in MARKDOWN_SUFFIXES else mimetypes.guess_type(target.name)[0]
    kind = guessed or "application/octet-stream"
    is_text = kind.startswith("text/") or kind.endswith(("javascript", "json", "xml"))
    return kind + "; charset=utf-8" if is_text else kind


def span(header, size):
    requested = RANGE.fullmatch(header or "")
    if not requested or not any(requested.groups()):
        return 0, size - 1
    first, last = requested.groups()
    if not first:
        return max(size - int(last), 0), size - 1
    return int(first), min(int(last or size - 1), size - 1)


def size_label(size):
    return str(size) + " B" if size < KILOBYTE else str(size // KILOBYTE) + " KB"


def listing(directory, request_path):
    entries = sorted((entry for entry in directory.iterdir() if deliverables.is_published(entry.name)),
                     key=lambda entry: entry.stat().st_mtime, reverse=True)
    rows = "".join(
        '<li><a href="{href}">{name}</a><span>{size}</span><time>{modified}</time></li>'.format(
            href=deliverables.MOUNT_PATH + quote(request_path + entry.name) + ("/" if entry.is_dir() else ""),
            name=html.escape(entry.name + ("/" if entry.is_dir() else "")),
            size="" if entry.is_dir() else size_label(entry.stat().st_size),
            modified=datetime.fromtimestamp(entry.stat().st_mtime).strftime("%Y-%m-%d %H:%M"))
        for entry in entries)
    parent = "" if request_path == "/" else PARENT_ROW
    return "<h1>" + html.escape(request_path) + '</h1><ul class="listing">' + parent + rows + "</ul>"


def chunks(target, first, length):
    with open(target, "rb") as reader:
        reader.seek(first)
        for offset in range(0, length, CHUNK_BYTES):
            yield reader.read(min(CHUNK_BYTES, length - offset))


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "tailnet-link"

    def do_GET(self):
        self.respond()

    def do_HEAD(self):
        self.respond()

    def log_request(self, code="-", size="-"):
        pass

    def respond(self):
        if self.headers.get(deliverables.IDENTITY_HEADER) != self.server.owner:
            return self.send_page(HTTPStatus.FORBIDDEN, "Refused", REFUSAL)
        request = urlsplit(self.path)
        path = unquote(request.path)
        target = locate(path)
        if target is None:
            return self.send_page(HTTPStatus.NOT_FOUND, "Not found", "<h1>Not found</h1><p>" + html.escape(path) + "</p>")
        if target.is_dir():
            return self.send_directory(target, path)
        if target.suffix.lower() in MARKDOWN_SUFFIXES and request.query != RAW_QUERY:
            return self.send_page(HTTPStatus.OK, target.name, DOCUMENT)
        return self.send_file(target)

    def send_directory(self, directory, path):
        if not path.endswith("/"):
            self.send_response(HTTPStatus.MOVED_PERMANENTLY)
            self.send_header("Location", deliverables.MOUNT_PATH + quote(path) + "/")
            self.send_header("Content-Length", "0")
            return self.end_headers()
        index = locate(path + INDEX_NAME)
        if index and index.is_file():
            return self.send_file(index)
        return self.send_page(HTTPStatus.OK, path, listing(directory, path))

    def send_page(self, status, title, body):
        page = PAGE.format(title=html.escape(title), assets=ASSETS, body=body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(page)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(page)

    def send_file(self, target):
        size = target.stat().st_size
        whole = (0, size - 1)
        first, last = span(self.headers.get("Range"), size)
        if first > last and (first, last) != whole:
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header("Content-Range", "bytes */" + str(size))
            self.send_header("Content-Length", "0")
            return self.end_headers()
        self.send_response(HTTPStatus.OK if (first, last) == whole else HTTPStatus.PARTIAL_CONTENT)
        self.send_header("Content-Type", content_type(target))
        self.send_header("Content-Length", str(last - first + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Last-Modified", formatdate(target.stat().st_mtime, usegmt=True))
        self.send_header("Cache-Control", "no-cache")
        if (first, last) != whole:
            self.send_header("Content-Range", "bytes " + str(first) + "-" + str(last) + "/" + str(size))
        self.end_headers()
        if self.command != "HEAD":
            self.send_bytes(target, first, last - first + 1)

    def send_bytes(self, target, first, length):
        try:
            for chunk in chunks(target, first, length):
                self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            return


def main():
    server = ThreadingHTTPServer(("127.0.0.1", deliverables.PORT), Handler)
    server.owner = deliverables.owner()
    server.serve_forever()


if __name__ == "__main__":
    main()
