"""Read a Windows client's active hot update over its packaged bundles, without modifying either tree."""
import errno
import gc
import json
import os
import shutil
import tempfile
from contextlib import contextmanager
from functools import partial
from pathlib import Path, PurePosixPath


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TEMP_PREFIX = 'sp-client-bundles-'


def resource_index(path):
    doc = json.loads(path.read_text(encoding='utf-8'))
    records = {}
    for rec in doc['abInfos']:
        name = rec['name']
        rel = PurePosixPath(name)
        if rel.is_absolute() or '..' in rel.parts or '\\' in name or ':' in name:
            raise ValueError(f'unsafe bundle path: {name}')
        records[name] = rec
    return doc, records


def _bundle_temp_dir(base, log):
    override = os.environ.get('TMPDIR')
    if override:
        try:
            return tempfile.TemporaryDirectory(prefix=TEMP_PREFIX, dir=Path(override).resolve())
        except OSError as error:
            log(f'client bundles: cannot use TMPDIR {override}: {error}')

    try:
        system_temp = Path(tempfile.gettempdir())
    except OSError:
        system_temp = None

    volume = base.stat().st_dev
    cache = PROJECT_ROOT / '.cache'
    # base is <install>/Arknights_Data/StreamingAssets/AB/Windows.
    install_parent = base.parents[2].parent.parent
    for parent in (cache, system_temp, install_parent):
        if parent is None:
            continue
        try:
            if parent == cache and not cache.exists() and PROJECT_ROOT.stat().st_dev == volume:
                cache.mkdir(exist_ok=True)
            if parent.stat().st_dev == volume:
                return tempfile.TemporaryDirectory(prefix=TEMP_PREFIX, dir=parent)
        except OSError:
            continue

    # Copies can still work on another volume when there is enough space.
    if system_temp is not None:
        return tempfile.TemporaryDirectory(prefix=TEMP_PREFIX, dir=system_temp)
    cache.mkdir(exist_ok=True)
    return tempfile.TemporaryDirectory(prefix=TEMP_PREFIX, dir=cache)


@contextmanager
def client_bundles(base, log=partial(print, flush=True)):
    """The active indexes, not mtimes, select downloaded replacements. Missing updates never use stale base art.

    A temporary linked tree lets every existing job (including multiprocessing FX dependency scans) see one root.
    PlayCover, archived bundles and base-only installs retain their original paths.
    """
    base = Path(base).resolve()
    if base.parts[-3:] != ('StreamingAssets', 'AB', 'Windows'):
        yield base
        return
    hot = base.parents[2] / 'PersistentData' / 'Bundles'
    if not (hot / 'hot_update_list.json').is_file() or not (hot / 'persistent_res_list.json').is_file():
        yield base
        return
    current, active = resource_index(hot / 'hot_update_list.json')
    packaged, original = resource_index(base / 'hot_update_list.json')
    downloaded, installed = resource_index(hot / 'persistent_res_list.json')
    # The client's timestamp-prefixed version ids order releases; an old download cache cannot override a new base.
    if current['versionId'][:17] < packaged['versionId'][:17]:
        yield base
        return
    if (downloaded.get('manifestName'), downloaded.get('manifestVersion')) != (
            current.get('manifestName'), current.get('manifestVersion')):
        raise ValueError('hot update and installed resource indexes disagree')
    selected, updated, missing = {}, 0, 0
    for name, rec in active.items():
        src = None
        if installed.get(name, {}).get('hash') == rec['hash'] and (hot / name).is_file():
            src = hot / name
            updated += 1
        elif original.get(name, {}).get('hash') == rec['hash'] and (base / name).is_file():
            src = base / name
        if src is not None:
            selected[name] = src
        else:
            missing += 1
    selected['hot_update_list.json'] = hot / 'hot_update_list.json'
    log(f'client bundles: {packaged["versionId"]} + {current["versionId"]}; '
        f'{updated} cached updates, {len(selected) - 1 - updated} packaged, {missing} unavailable')
    with _bundle_temp_dir(base, log) as tmp:
        root = Path(tmp) / 'Windows'
        root.mkdir()
        log(f'client bundles: preparing {len(selected)} local files in {tmp}')
        copies = []
        for name, src in selected.items():
            dst = root / name
            dst.parent.mkdir(parents=True, exist_ok=True)
            try:
                dst.symlink_to(src)
            except OSError:  # Windows may disallow symlinks; a hard link or temporary copy is read identically.
                try:
                    os.link(src, dst)
                except OSError:
                    copies.append((src, dst))
        if copies:
            required = sum(src.stat().st_size for src, _ in copies)
            free = shutil.disk_usage(tmp).free
            sizes = f'{required / 2**30:.2f} GiB to copy, {free / 2**30:.2f} GiB free'
            if required > free:
                raise OSError(errno.ENOSPC, f'{sizes}. Set TMPDIR to a writable folder on the game drive '
                              'or a drive with sufficient free space', tmp)
            log(f'client bundles: copying {len(copies)} local files to {tmp} ({sizes})')
            for src, dst in copies:
                shutil.copy2(src, dst)
        log(f'client bundles: ready ({len(selected) - len(copies)} linked, {len(copies)} copied)')
        try:
            yield root
        finally:
            # UnityPy readers can form cycles around mapped bundle files. Release them before Windows
            # removes the temporary links; the installed client and its hot-update files stay untouched.
            gc.collect()
