#!/usr/bin/env python3
"""Fetch pinned official themes and regulation scene inputs for the optional extractor.

No runtime download. Every uncompressed bundle must match its hot-update MD5.
Use --list to inspect sizes, --only theme or --only scene to narrow the input set.
"""
import argparse
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
import sys
import urllib.request
import zipfile

import regulation_scenes

ROOT = Path(__file__).resolve().parents[2]
VERSION = '26-11-06-12-56-09-07186384'
BASE = 'https://ak.hycdn.cn/assetbundle/official/Android/assets/'
THEMES = ('ac_n_initial', 'ac_n_iron', 'ac_s_closur')


def wanted(names, only):
    selected = set()
    if only in ('all', 'theme'):
        for name in names:
            if any(name.endswith('/[uc]' + theme + '.ab') or name.endswith('/' + theme + '.ab') for theme in THEMES):
                selected.add(name)
        selected.update(name for name in names if name in (
            'ui/autochess/[uc]autochessouter.ab', 'ui/autochess/[uc]autochessbattle.ab',
            'ui/autochess/[uc]autochesscommon.ab', 'activity/[uc]act3autochess.ab'))
    if only in ('all', 'scene'):
        for stage in regulation_scenes.REGULATION_IDS:
            selected.update(regulation_scenes.prefab_rel(stage, part) for part in (1, 2, 3))
            selected.update(regulation_scenes.STAGE_DEPS[stage])
        selected.update(name for name in names if name.startswith('shaders/'))
    missing = selected - set(names)
    if missing:
        raise ValueError('Pinned version lacks bundles: ' + ', '.join(sorted(missing)))
    return sorted(selected)


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Stronghold-Protocol/local-extract'}), timeout=120) as response:
        return response.read()


def fetch_one(name, entry, out, base):
    target = out / name
    expected = entry['md5']
    if target.is_file() and hashlib.md5(target.read_bytes()).hexdigest() == expected:
        return {'name': name, 'md5': expected, 'existing': True}
    error = None
    for _ in range(3):
        try:
            dat = name.rsplit('.', 1)[0].replace('/', '_').replace('#', '__') + '.dat'
            with zipfile.ZipFile(io.BytesIO(get(base + dat))) as archive:
                files = archive.namelist()
                if len(files) != 1:
                    raise ValueError('Unexpected bundle archive')
                blob = archive.read(files[0])
            if hashlib.md5(blob).hexdigest() != expected:
                raise ValueError('Bundle checksum mismatch')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(blob)
            return {'name': name, 'md5': expected, 'bytes': len(blob)}
        except Exception as exc:
            error = str(exc)
    return {'name': name, 'error': error}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', default=VERSION)
    parser.add_argument('--only', choices=('all', 'theme', 'scene'), default='all')
    parser.add_argument('--out', type=Path, default=ROOT / '.cache/official-regulation' / VERSION)
    parser.add_argument('--index', type=Path)
    parser.add_argument('--list', action='store_true')
    args = parser.parse_args()
    base = BASE + args.version + '/'
    raw = args.index.read_bytes() if args.index else get(base + 'hot_update_list.json')
    doc = json.loads(raw)
    index = {entry['name']: entry for entry in doc['abInfos']}
    names = wanted(index, args.only)
    if args.list:
        print(json.dumps({'version': args.version, 'bytes': sum(index[n].get('totalSize', 0) for n in names), 'bundles': names}, ensure_ascii=False, indent=2))
        return 0
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'hot_update_list.json').write_bytes(raw)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda name: fetch_one(name, index[name], args.out, base), names))
    report = {'version': args.version, 'index_sha256': hashlib.sha256(raw).hexdigest(), 'bundles': results}
    (args.out / 'download-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    for result in results:
        print(json.dumps(result, ensure_ascii=False), flush=True)
    return int(any('error' in r for r in results))


if __name__ == '__main__':
    sys.exit(main())
