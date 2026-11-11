import re

FENCE = re.compile(r"^[ \t]*(`{3,}|~{3,})[^\n]*\n.*?^[ \t]*\1[ \t]*$", re.S | re.M)
TOKEN = re.compile(
    r"(?P<link>!?\[[^\]\n]*\]\((?P<target>[^()\s]+)\))"
    r"|(?<!`)`(?P<span>[^`\n]+)`(?!`)"
    r"|(?P<bare>(?<![\w/.:@`\[=~-])(?<!\]\()(?:https?://|file://|~/|/)[^\s`'\"<>()\[\]|]+)"
)
WEB_URL = re.compile(r"https?://")
TRAILING_PUNCTUATION = ".,;:!?*_"


def labelled(written, target, url):
    return url if WEB_URL.match(target) else "[" + written + "](" + url + ")"


def rewrite(text, url_for):
    def replace(match):
        written = match.group(0)
        if match.group("link"):
            url = url_for(match.group("target"))
            return written[:match.start("target") - match.start()] + url + ")" if url else written
        if match.group("span"):
            url = url_for(match.group("span"))
            return labelled(written, match.group("span"), url) if url else written
        target = written.rstrip(TRAILING_PUNCTUATION)
        url = url_for(target)
        return labelled(target, target, url) + written[len(target):] if url else written

    pieces = []
    position = 0
    for fence in FENCE.finditer(text):
        pieces += [TOKEN.sub(replace, text[position:fence.start()]), fence.group(0)]
        position = fence.end()
    return "".join(pieces) + TOKEN.sub(replace, text[position:])
