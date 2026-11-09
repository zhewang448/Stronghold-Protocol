#!/usr/bin/env python3
"""Install the optional official Closure terminal theme into ignored public/assets.

Uses the repository's UnityPy/LZ4AK extraction environment. Downloads only three
public Android bundles from the pinned official version, checking their MD5s.
Run explicitly; setup and the game never download official bundles automatically.
"""
import argparse
import hashlib
import io
import json
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VERSION = '26-11-06-12-56-09-07186384'
THEME = 'ac_s_closur'
BUNDLES = [
    ('ui/autochess/autochessvariantskin/[uc]ac_s_closur.ab', 'c70c6b965823516ab93ca8c27f806667', None),
    ('audio/sound_beta_2/voice_cn/ac_s_closur.ab', '4817f7e6004b8bb760e3cef35c5bde7f', 'cn'),
    ('audio/sound_beta_2/voice/ac_s_closur.ab', '33b992fe87ece929f4be1289797bed3c', 'jp'),
]


def acquire(cache, name, expected, offline=False):
    path = cache / name
    if path.is_file():
        blob = path.read_bytes()
    elif offline:
        raise ValueError('Missing cached bundle: ' + name)
    else:
        dat = name.rsplit('.', 1)[0].replace('/', '_').replace('#', '__') + '.dat'
        url = 'https://ak.hycdn.cn/assetbundle/official/Android/assets/' + VERSION + '/' + dat
        request = urllib.request.Request(url, headers={'User-Agent': 'Stronghold-Protocol/terminal-theme'})
        with urllib.request.urlopen(request, timeout=60) as response:
            compressed = response.read()
        with zipfile.ZipFile(io.BytesIO(compressed)) as archive:
            names = archive.namelist()
            if len(names) != 1:
                raise ValueError('Unexpected bundle archive: ' + name)
            blob = archive.read(names[0])
    if hashlib.md5(blob).hexdigest() != expected:
        raise ValueError('Bundle checksum mismatch: ' + name)
    if not path.is_file():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(blob)
    return path


def install(cache, output, offline=False):
    import aklz4  # noqa: F401: registers the official client's LZ4AK codec
    import UnityPy

    manifest = {'version': 1, 'id': THEME, 'resourceVersion': VERSION,
                'source': 'https://ak.hypergryph.com/news/0787',
                'sprites': {}, 'voices': {'cn': {}, 'jp': {}}, 'files': {}, 'bundles': []}

    def save(relative, blob):
        path = output / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(blob)
        manifest['files'][relative] = {'bytes': len(blob), 'sha256': hashlib.sha256(blob).hexdigest()}
        return relative

    for name, md5, language in BUNDLES:
        bundle = acquire(cache, name, md5, offline)
        manifest['bundles'].append({'name': name, 'md5': md5})
        env = UnityPy.load(str(bundle))
        for obj in sorted(env.objects, key=lambda value: value.path_id):
            kind = obj.type.name
            if kind not in ('Sprite', 'Texture2D', 'TextAsset', 'AudioClip'):
                continue
            data = obj.read()
            asset = data.m_Name
            safe = re.sub(r'[^A-Za-z0-9_-]', '_', asset)
            if kind == 'Sprite':
                relative = 'sprites/' + safe + '.png'
                if asset in manifest['sprites']:
                    relative = 'sprites/' + safe + '-' + str(obj.path_id) + '.png'
                stream = io.BytesIO()
                data.image.save(stream, format='PNG')
                save(relative, stream.getvalue())
                manifest['sprites'].setdefault(asset, relative)
            elif kind == 'Texture2D' and asset == 'ac_s_closur_spine':
                stream = io.BytesIO()
                data.image.save(stream, format='PNG')
                save('spine/mascot.png', stream.getvalue())
            elif kind == 'TextAsset':
                blob = data.m_Script
                if isinstance(blob, str):
                    blob = blob.encode('utf-8', errors='surrogateescape')
                if asset == 'ac_s_closur_spine':
                    skeleton = json.loads(blob)
                    save('spine/mascot.json', blob)
                    manifest['spine'] = {'skel': 'spine/mascot.json', 'atlas': 'spine/mascot.atlas',
                                         'bounds': {key: skeleton['skeleton'][key] for key in ('x', 'y', 'width', 'height')},
                                         'anims': {'idle': 'Idle'}, 'pma': True}
                    manifest['animations'] = list(skeleton['animations'])
                elif asset == 'ac_s_closur_spine.atlas':
                    save('spine/mascot.atlas', blob.replace(b'ac_s_closur_spine.png', b'mascot.png'))
                elif asset in ('skin_config', 'effect_preview_config'):
                    json.loads(blob)
                    save('config/' + asset + '.json', blob)
            elif kind == 'AudioClip' and language:
                samples = data.samples
                if len(samples) != 1:
                    raise ValueError('Unexpected audio samples: ' + asset)
                blob = next(iter(samples.values()))
                extension = '.ogg' if blob.startswith(b'OggS') else '.wav'
                relative = save('audio/' + language + '/' + safe + extension, blob)
                manifest['voices'][language][asset] = relative
    if 'spine' not in manifest or len(manifest['voices']['cn']) != 19 or len(manifest['voices']['jp']) != 19:
        raise ValueError('Incomplete terminal theme extraction')
    temporary = output / 'manifest.json.tmp'
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(output / 'manifest.json')
    return {'id': THEME, 'directory': str(output.resolve()), 'sprites': len(manifest['sprites']),
            'animations': len(manifest['animations']), 'voices': {k: len(v) for k, v in manifest['voices'].items()},
            'bytes': sum(value['bytes'] for value in manifest['files'].values())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=ROOT / '.cache/terminal-themes' / VERSION)
    parser.add_argument('--out', type=Path, default=ROOT / 'public/assets/terminal-themes' / THEME)
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--plan', action='store_true', help='print pinned download identities without loading UnityPy')
    args = parser.parse_args()
    try:
        result = {'version': VERSION, 'bundles': BUNDLES} if args.plan else install(args.cache, args.out, args.offline)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
