"""Export official full-size dynamic illustrations from the owner's local client.

This only writes an intermediate cache. install-dynamic-illustrations.mjs parses
the skeleton and every atlas page before publishing a manifest entry. Battle
models are never used as an illustration substitute.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path
import aklz4  # noqa: F401 (register the game's LZ4 decoder)
import UnityPy
from extract import locate_client, write_spine, safe_name, atlas_pages, merge_alpha


def controller_metadata(env, skeleton_path=None):
    objects = {o.path_id: o for o in env.objects}
    for obj in env.objects:
        if obj.type.name != 'MonoBehaviour':
            continue
        tree = obj.read_typetree()
        if not tree.get('_cameraSize') or not tree.get('_skeleton'):
            continue
        renderer = objects[tree['_skeleton']['m_PathID']].read_typetree()
        data = objects[renderer['skeletonDataAsset']['m_PathID']].read_typetree()
        skel = objects[data['skeletonJSON']['m_PathID']].read_typetree()
        if skeleton_path and Path(skeleton_path).stem != safe_name(skel['m_Name']).removesuffix('.skel'):
            continue
        go = objects[renderer['m_GameObject']['m_PathID']].read_typetree()
        transforms = [objects[p['component']['m_PathID']] for p in go['m_Component']]
        transform = next(p.read_typetree() for p in transforms if p.type.name == 'Transform')
        size = float(tree['_cameraSize'])
        scale = float(data.get('scale', 0.01))
        sx, sy = [scale * transform['m_LocalScale'][k] for k in ['x', 'y']]
        position = transform['m_LocalPosition']
        return {'viewBounds': {'x': (-size - position['x']) / sx, 'y': (-size - position['y']) / sy,
                               'width': size * 2 / sx, 'height': size * 2 / sy},
                'extraTracks': tree.get('_extraTrackAnimations') or [],
                'nativeParticles': len(tree.get('_particles') or []), 'nativeHolders': len(tree.get('_holders') or []),
                'cameraSize': size, 'skeletonScale': scale}
    return {}


def export(game, registry, out):
    ab = locate_client(game)
    if ab is None:
        raise ValueError('No client at --game')
    records = {}
    for skin_id, row in registry['skins'].items():
        bundle_name = row.get('bundle') or skin_id.replace('@', '_')
        bundle = ab / 'arts/dynchars' / (bundle_name + '.ab')
        if not bundle.exists():
            records[skin_id] = {'error': 'bundle absent', 'bundle': str(bundle)}
            continue
        try:
            env = UnityPy.load(str(bundle))
            objects = {o.path_id: o for o in env.objects}
            candidates = []
            for obj in env.objects:
                if obj.type.name != 'MonoBehaviour':
                    continue
                tree = obj.read_typetree()
                if 'skeletonJSON' in tree:
                    ptr = tree['skeletonJSON']
                    asset = objects.get(ptr.get('m_PathID')) if ptr and not ptr.get('m_FileID') else None
                    name = asset.read_typetree().get('m_Name', '') if asset else ''
                    if name.startswith('dyn_illust_') and '_start' not in name.lower():
                        candidates.append(tree)
            if len(candidates) > 1:
                # Some clients duplicate the same SkeletonData for two materials.
                refs = {t['skeletonJSON']['m_PathID'] for t in candidates}
                if len(refs) == 1:
                    candidates = candidates[:1]
                else:
                    def resolution(tree):
                        area = 0
                        for ref in tree.get('atlasAssets') or []:
                            atlas_obj = objects.get(ref['m_PathID'])
                            for mat_ref in atlas_obj.read_typetree().get('materials') or []:
                                mat = objects.get(mat_ref['m_PathID']).read_typetree()
                                for key, value in mat['m_SavedProperties']['m_TexEnvs']:
                                    texture = objects.get(value['m_Texture']['m_PathID'])
                                    if key == '_MainTex' and texture:
                                        tex = texture.read_typetree()
                                        area += tex['m_Width'] * tex['m_Height']
                        return area
                    # The client may carry a second, lower resolution variant
                    # under the same name. Export the full resolution atlas.
                    candidates = [max(candidates, key=resolution)]
            if len(candidates) != 1:
                raise ValueError('Expected one full illustration skeleton, found ' + str(len(candidates)))
            sub = safe_name(skin_id)
            manifest = {}
            count = write_spine(objects, candidates[0], sub, bundle_name, out, manifest, print)
            if not count:
                raise ValueError('Skeleton, atlas or page export incomplete')
            folder = out / sub
            skeleton = next(folder.glob('*.skel'))
            if skeleton.read_bytes().lstrip().startswith(b'{'):
                dest = skeleton.with_suffix('.json')
                skeleton.replace(dest)
                skeleton = dest
            atlas = next(folder.glob('*.atlas'))
            text = atlas.read_text('utf-8')
            # The native atlas uses # in page names. Web URLs must not treat it
            # as a fragment. Preserve the source bundle and normalize cache names.
            for page in atlas_pages(text):
                name = safe_name(page)
                if name != page:
                    (folder / page).replace(folder / name)
                    text = text.replace(page, name)
            atlas.write_text(text, 'utf-8')
            records[skin_id] = {'bundle': str(bundle), 'bundleSha256': hashlib.sha256(bundle.read_bytes()).hexdigest(),
                                'skeleton': str(skeleton.resolve()), 'atlas': str(atlas.resolve()),
                                'pma': False, 'files': count, **controller_metadata(env, skeleton)}
            print(skin_id + ': exported ' + str(count) + ' files', flush=True)
        except Exception as error:
            records[skin_id] = {'bundle': str(bundle), 'error': str(error)}
            print(skin_id + ': ' + str(error), flush=True)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'index.json').write_text(json.dumps({'game': str(ab), 'skins': records}, ensure_ascii=False, indent=2), 'utf-8')
    return records


def export_stills(game, registry, out):
    ab = locate_client(game)
    index = json.loads((out / 'index.json').read_text('utf-8'))
    packs = {}
    for skin_id, row in registry['skins'].items():
        dest = index['skins'].get(skin_id, {})
        if 'skeleton' not in dest:
            continue
        char_id = row['charId'] if row.get('field') else skin_id.split('@')[0]
        rel = ('chararts/' if row.get('field') else 'skinpack/') + char_id + '.ab'
        try:
            if rel not in packs:
                env = UnityPy.load(str(ab / rel))
                packs[rel] = [o.read() for o in env.objects if o.type.name == 'Texture2D']
            textures = packs[rel]
            name = row.get('bundle') or skin_id.replace('@', '_')
            colors = [t for t in textures if t.m_Name == name]
            alphas = [t for t in textures if t.m_Name == name + '[alpha]']
            if not colors:
                raise ValueError('full-size named texture absent')
            rgb = max(colors, key=lambda t: t.m_Width * t.m_Height)
            if max(rgb.m_Width, rgb.m_Height) < 1000:
                raise ValueError('only a thumbnail is available')
            alpha = max(alphas, key=lambda t: t.m_Width * t.m_Height) if alphas else None
            image = merge_alpha(rgb.image, alpha.image if alpha else None)
            target = Path(dest['skeleton']).parent / 'static-client.png'
            image.save(target)
            dest['static'] = str(target.resolve())
            dest['staticSize'] = list(image.size)
            dest['staticBundle'] = rel
            print(skin_id + ': full static ' + str(image.size), flush=True)
        except Exception as error:
            dest['staticError'] = str(error)
            print(skin_id + ': static ' + str(error), flush=True)
    (out / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2), 'utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game', required=True)
    parser.add_argument('--registry', default='docs/research/dynamic-illustrations.json')
    parser.add_argument('--out', default='.cache/dynamic-extract')
    parser.add_argument('--stills-only', action='store_true')
    parser.add_argument('--metadata-only', action='store_true')
    args = parser.parse_args()
    registry = json.loads(Path(args.registry).read_text('utf-8'))
    if args.metadata_only:
        file = Path(args.out) / 'index.json'
        index = json.loads(file.read_text('utf-8'))
        for row in index['skins'].values():
            if 'bundle' in row and 'skeleton' in row:
                row.update(controller_metadata(UnityPy.load(row['bundle']), row['skeleton']))
        file.write_text(json.dumps(index, ensure_ascii=False, indent=2), 'utf-8')
        print('client camera framing and extra animation tracks recorded')
        sys.exit(0)
    if args.stills_only:
        export_stills(args.game, registry, Path(args.out))
        sys.exit(0)
    result = export(args.game, registry, Path(args.out))
    failed = [key for key, value in result.items() if 'error' in value]
    print(json.dumps({'exported': len(result) - len(failed), 'failed': failed}, ensure_ascii=False))
    sys.exit(1 if failed else 0)
