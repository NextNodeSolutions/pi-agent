import filecmp
import hashlib
import os
import re
import shutil
import tempfile
from pathlib import Path
from urllib.parse import quote

from tailnet import SETUP_HINT, STATE, LinkError

ROOT = Path.home() / "Public/deliverables"
MOUNT_PATH = "/deliverables"
PORT = 18791
ORIGIN = "http://127.0.0.1:" + str(PORT)
IDENTITY_HEADER = "Tailscale-User-Login"
OWNER_FILE = STATE / "owner"
VIEWER_PREFIX = ".viewer"
HIDDEN_PREFIX = "."
SKIPPED_DIRECTORIES = ("node_modules",)
KEY_DIGEST_LENGTH = 8
MEGABYTE = 1024 * 1024
MAX_PUBLISH_BYTES = 1024 * MEGABYTE
FILE_MODE = 0o644


def owner():
    if not OWNER_FILE.is_file():
        raise LinkError("Files are not served on this machine. " + SETUP_HINT)
    return OWNER_FILE.read_text().strip()


def is_published(name):
    return not name.startswith(HIDDEN_PREFIX) and name not in SKIPPED_DIRECTORIES


def key(directory):
    label = re.sub(r"[^A-Za-z0-9_-]+", "-", directory.name).strip("-") or "files"
    return label + "-" + hashlib.sha256(str(directory).encode()).hexdigest()[:KEY_DIGEST_LENGTH]


def destination(source):
    root = ROOT.resolve()
    if source == root or root in source.parents:
        return source
    return root / key(source.parent) / source.name


def copy_file(source, target):
    if target.is_file() and filecmp.cmp(source, target):
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, pending = tempfile.mkstemp(prefix=HIDDEN_PREFIX, dir=target.parent)
    os.close(descriptor)
    try:
        shutil.copyfile(source, pending)
        shutil.copystat(source, pending)
        os.chmod(pending, FILE_MODE)
        os.replace(pending, target)
    finally:
        if os.path.exists(pending):
            os.unlink(pending)


def tree_files(source):
    for folder, directories, names in os.walk(source):
        directories[:] = filter(is_published, directories)
        paths = (Path(folder, name) for name in names if is_published(name))
        yield from (path for path in paths if path.is_file() and not path.is_symlink())


# Hidden names are left alone: another publication of the same tree may hold a pending copy there.
def remove_stale(target, kept):
    for folder, _, names in os.walk(target, topdown=False):
        stale = [path for path in (Path(folder, name) for name in names if is_published(name)) if path not in kept]
        for path in stale:
            path.unlink()
        if Path(folder) != target and not os.listdir(folder):
            os.rmdir(folder)


def publish(path):
    source = Path(path).expanduser().resolve()
    if not source.exists():
        raise LinkError("No such file or directory: " + str(source))
    target = destination(source)
    if target == source:
        return target
    files = list(tree_files(source)) if source.is_dir() else [source]
    size = sum(file.stat().st_size for file in files)
    if size > MAX_PUBLISH_BYTES:
        raise LinkError(str(source) + " holds " + str(size // MEGABYTE) + " MB, over the "
                        + str(MAX_PUBLISH_BYTES // MEGABYTE) + " MB a link may publish. Link a smaller file or directory.")
    copies = {target / file.relative_to(source) if source.is_dir() else target: file for file in files}
    remove_stale(target, copies)
    for copy, file in copies.items():
        copy_file(file, copy)
    return target


def url(name, target):
    relative = target.relative_to(ROOT.resolve()).as_posix()
    suffix = "" if relative == "." else quote(relative) + ("/" if target.is_dir() else "")
    return "https://" + name + MOUNT_PATH + "/" + suffix
