"""Read current HTML without changing its original package."""
import json, sys
from html.parser import HTMLParser
from pathlib import Path

text = Path(sys.argv[1]).read_text(encoding='utf-8')
offsets = [0]
for line in text.splitlines(keepends=True):
    offsets.append(offsets[-1] + len(line))

class Scan(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.scripts, self.styles, self.edits, self.pending = [], [], [], None
    def position(self):
        line, column = self.getpos()
        return offsets[line - 1] + column
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        start = self.position()
        if tag == 'script':
            kind = (attrs.get('type') or '').lower()
            if kind in ('', 'text/javascript', 'application/javascript', 'module'):
                self.pending = (start, start + len(self.get_starttag_text()), attrs)
        if tag == 'link':
            rel, target = attrs.get('rel'), attrs.get('as')
            if rel == 'stylesheet':
                index = len(self.styles)
                self.styles.append(attrs)
                self.edits.append((start, start + len(self.get_starttag_text()), '<!--TEMPLATE_STYLE_%d-->' % index))
            elif rel == 'modulepreload' or rel == 'preload' and target in ('script', 'style'):
                self.edits.append((start, start + len(self.get_starttag_text()), ''))
    def handle_endtag(self, tag):
        if tag == 'script' and self.pending:
            start, body, attrs = self.pending
            end = self.position()
            close = text.index('>', end) + 1
            self.scripts.append({'attrs': attrs, 'code': text[body:end]})
            self.edits.append((start, close, ''))
            self.pending = None

parser = Scan()
parser.feed(text)
shell = text
for start, end, replacement in sorted(parser.edits, reverse=True):
    shell = shell[:start] + replacement + shell[end:]
print(json.dumps({'shell': shell, 'scripts': parser.scripts, 'styles': parser.styles}, ensure_ascii=False))
