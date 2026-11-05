// Local support evidence, separate from the official dynamic qualification list.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atlasInfo } from './assets/atlas.mjs';
import { parseSkel, parseSpineJson } from './assets/skel.mjs';
import { isCompletePng, pngSize } from './assets/formats.mjs';
const root = path.resolve(import.meta.dirname, '..');
const read = async p => JSON.parse(await fs.readFile(path.join(root, p), 'utf8'));
const registry = await read('docs/research/dynamic-illustrations.json'), manifest = await read('data/assets.json');
const evidence = '.cache/dynamic-illustrations-new-operators/followup';
let browser = { results: [] }; try { browser = await read(evidence + '/catalogue/results.json'); } catch { /* not run */ }
const rows = [];
for (const [id, row] of Object.entries(registry.skins)) {
  const art = row.field ? manifest.chars[row.charId] : manifest.chars[row.charId]?.skins?.[id], entry = row.field ? art?.[row.field] : art?.dynamic;
  const result = { id, name: row.name || art?.name, charId: row.charId, officialDynamic: row.officialDynamic === true,
    kind: row.field ? '精二本体' : '目录皮肤', source: entry?.source || null, installed: !!entry, issues: [],
    crops: Object.keys(entry?.frames || {}), nativeLayers: entry?.nativeLayers || null };
  if (entry) {
    try {
      const bytes = await fs.readFile(path.join(root, 'public', entry.skel));
      const atlas = atlasInfo(await fs.readFile(path.join(root, 'public', entry.atlas), 'utf8'));
      const meta = entry.skel.endsWith('.json') ? parseSpineJson(JSON.parse(bytes), atlas.regions) : parseSkel(bytes, atlas.regions);
      result.version = meta.version; result.animations = meta.animations; result.pages = atlas.pages;
      result.skeletonSha256 = createHash('sha256').update(bytes).digest('hex');
      for (const page of entry.textures) if (!isCompletePng(await fs.readFile(path.join(root, 'public', page)))) result.issues.push('无效纹理 ' + page);
      if (meta.missingRegions.length) result.issues.push('附件区域缺失');
      result.pma = entry.pma;
      result.boundsFromClient = !!entry.skeletonBounds;
      const still = row.field ? art.illustE2 : art.illust;
      result.still = still; result.staticSize = pngSize(await fs.readFile(path.join(root, 'public', still)));
      if (Math.max(result.staticSize?.width || 0, result.staticSize?.height || 0) < 1000) result.issues.push('完整静态图缺失');
      const observed = browser.results.find(e => e.id === id);
      result.browserVerified = !!observed && (!observed.identity || observed.identity === entry.identity);
      result.browserSamples = observed?.samples?.length || 0;
      result.extraUnityEffects = (entry.nativeLayers?.particles || 0) + (entry.nativeLayers?.holders || 0);
    } catch (e) { result.issues.push(e.message); }
  }
  rows.push(result);
}
const result = { generatedAt: new Date().toISOString(), qualification: registry.official, rows };
await fs.mkdir(path.join(root, evidence), { recursive: true });
await fs.writeFile(path.join(root, evidence, 'support-matrix.json'), JSON.stringify(result, null, 2));
const md = ['# 动态外观支持矩阵', '',
  '官方资格依据 `skin_table.json` 的 `dynIllustId`，来源原始 SHA-256：`' + registry.official.sha256 + '`。',
  '范围为本库已收录皮肤与可选干员的精二本体。旧 URL 的 404 与官方动态资格分别记录；以下资源来源均是本机官方客户端，原包 SHA-256 保存在逐项 JSON 证据中。', '',
  '浏览器验证是逐个加载真实素材、播放所有列出的动作、渲染已登记头像/半身裁切，并检查关闭后的引用归零。没有经核实裁切的入口保持静态。',
  '前后景静态层随清单安装；原生额外 Spine 轨已接入。Unity 独立粒子和 holder 数量单列，尚未重建为本 UI 的粒子效果；不能把核心 Spine 骨架验证等同于 Unity 全部粒子一致。', '',
  '| ID / 外观 | 官方动态 | 来源 / 骨架 / 页数 / PMA | 静态大图 | 显示验证 / 裁切 | 剩余缺口 |',
  '| --- | --- | --- | --- | --- | --- |'];
for (const r of rows) {
  const missing = [...r.issues];
  if (!r.crops.length) missing.push('小图无验证裁切，保持静态');
  if (r.extraUnityEffects) missing.push('Unity 附加效果 ' + r.extraUnityEffects + ' 项未重建');
  md.push(`| ${r.id} · ${r.name || r.kind} | ${r.officialDynamic ? '是' : '待核实'} | 客户端 / ${r.version || '未安装'} / ${r.pages?.length || 0} 页 / ${r.pma ? 'PMA' : 'straight'} | ${r.staticSize ? r.staticSize.width + '×' + r.staticSize.height : '缺失'} | ${r.browserVerified ? r.browserSamples + ' 动作通过' : '尚未验证'}；${r.crops.join('、') || '完整预览'} | ${missing.join('；') || '核心立绘无缺项'} |`);
}
md.push('', '## 官方有动态、本库皮肤目录尚未收录', '', '| ID | 外观 | 官方动态资源 |', '| --- | --- | --- |');
for (const r of registry.official.outsideCatalogue) md.push(`| ${r.id} | ${r.name || '精二本体'} | ${r.dynIllustId} |`);
md.push('', '机器证据：`.cache/dynamic-illustrations-new-operators/followup/support-matrix.json`；运行 `node tools/audit-dynamic-illustrations.mjs` 重新核对当前文件与显示证据。', '');
await fs.writeFile(path.join(root, 'docs/DYNAMIC-ILLUSTRATIONS-SUPPORT.md'), md.join('\n'));
console.log(JSON.stringify({ entries: rows.length, installed: rows.filter(r => r.installed).length, verified: rows.filter(r => r.browserVerified).length,
  issues: rows.filter(r => r.issues.length).map(r => ({ id: r.id, issues: r.issues })), outsideCatalogue: registry.official.outsideCatalogue.length }));
