"""Verify the actual Batch 1 archives, with optional retained extraction for FYP QA."""
import argparse, hashlib, json, re, stat, subprocess, tempfile, zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--extract-to', type=Path)
parser.add_argument('--report', type=Path)
args = parser.parse_args()
repo = Path(__file__).resolve().parent.parent
library = repo / 'playablebatch1'
source = (library / 'game-downloads.js').read_text()
manifest = json.loads(re.search(r'window.PlayableGameDownloads = ([\s\S]*);\s*$', source)[1])
registry = json.loads((library / 'templates/registry.json').read_text())['records']
sha = lambda data: hashlib.sha256(data).hexdigest()
results = []

with tempfile.TemporaryDirectory(prefix='playable-archive-qa-') as temporary:
    output = (args.extract_to or Path(temporary)).resolve()
    for item in registry:
        language, base = item['language'], item['base']
        entry = manifest[base]['languages'][language]
        archive = library / 'downloads' / entry['filename']
        raw = archive.read_bytes()
        assert len(raw) == entry['bytes'] and sha(raw) == entry['sha256'], archive
        wrapper = base + ('-it' if language == 'it' else '')
        parent = output / language
        root = parent / wrapper
        assert not root.exists(), 'Use a fresh extraction directory: ' + str(root)
        with zipfile.ZipFile(archive) as package:
            assert package.testzip() is None, 'ZIP checksum failure'
            for info in package.infolist():
                parts = info.filename.split('/')
                assert parts[0] == wrapper and '..' not in parts and not info.filename.startswith('/'), info.filename
                assert not stat.S_ISLNK(info.external_attr >> 16), info.filename
            assert wrapper + '/dist/assets/' in package.namelist(), 'Empty assets directory must survive extraction'
            package.extractall(parent)
        assert sorted(p.name for p in root.iterdir()) == ['App.jsx', 'asset_manifest.json', 'check.js', 'dist']
        assert sorted(p.name for p in (root / 'dist').iterdir()) == ['assets', 'bundle.js', 'game.config.json', 'game.html']
        check = subprocess.run(['node', str(root / 'check.js'), '--build'], capture_output=True, text=True)
        assert check.returncode == 0, check.stderr
        assert json.loads(check.stdout)['valid'] is True
        expected = library / item['folder']
        actual_files = sorted(p.relative_to(root) for p in root.rglob('*') if p.is_file())
        expected_files = sorted(p.relative_to(expected) for p in expected.rglob('*') if p.is_file())
        assert actual_files == expected_files, 'Extra or missing archive files'
        for relative in expected_files:
            assert (root / relative).read_bytes() == (expected / relative).read_bytes(), 'Rebuild/source mismatch: ' + str(relative)
        results.append({'number': item['number'], 'taskId': item['taskId'], 'base': base, 'language': language,
                        'filename': entry['filename'], 'bytes': len(raw), 'files': len(actual_files),
                        'valid': True, 'root': str(root) if args.extract_to else None})
    assert len(results) == 76 and sum(r['language'] == 'it' for r in results) == 38
    report = {'archives': len(results), 'passed': len(results), 'failed': 0,
              'largestBytes': max(r['bytes'] for r in results),
              'over5MB': [{k: r[k] for k in ['number', 'language', 'bytes']} for r in results if r['bytes'] > 5 * 1024 * 1024],
              'results': results}
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'results'}))
