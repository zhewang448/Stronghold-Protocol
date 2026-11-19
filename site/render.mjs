import fs from 'node:fs/promises';
import { t } from '../shared/i18n.js';

const repository = 'https://github.com/zhewang448/Stronghold-Protocol';
const upstream = 'https://github.com/sganggs/Stronghold-Protocol';
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const e = escapeHtml;
const arrow = '<svg class="arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 16 16 4M4 4h12v12"/></svg>';
const label = (text, className = '') => `<span class="${className}">${e(t(text))}</span>`;
const sourceText = text => e(t(text));
const docUrl = (path, commit) => `${repository}/blob/${commit}/${path}`;
export const HERO_SCREENSHOTS = Object.freeze({
  strategy: 'assets/screenshots/strategy-minimap.webp',
  namecard: 'assets/screenshots/namecard-room.webp',
  report: 'assets/screenshots/training-report.webp',
});

function figure(feature) {
  const p = feature.picture;
  return `<figure class="feature-picture"><a class="zoomable" href="${p.file}" data-zoom data-caption="${e(feature.title + ' · ' + feature.imageUse)}" aria-label="${e(t('放大图片：{name}', { name: feature.title }))}"><img src="${p.file}" width="${p.width}" height="${p.height}" loading="lazy" decoding="async" alt="${e(feature.title + '；' + feature.imageUse)}">${label('放大查看', 'zoom-hint')}</a><figcaption>${sourceText(feature.imageUse)}</figcaption></figure>`;
}

function feature(f, index, data) {
  const source = f.upstreamSourceExists ? f.upstreamSource : `${upstream}/tree/${data.upstreamCommit}`;
  const comparison = f.comparisonPicture
    ? `<div class="comparison paired"><div><h4>${e(t('上游 {version}', { version: data.upstreamRelease }))}</h4>${figure({ ...f, picture: f.comparisonPicture, imageUse: f.comparisonCaption })}<p class="pair-explanation">${sourceText(f.upstream)}</p></div><div><h4>${e(t('本库'))}</h4>${figure(f)}<a class="pair-source" href="${source}" target="_blank" rel="noreferrer">${e(t('查看对照源码'))}${arrow}</a></div></div>`
    : `<div class="comparison"><div class="upstream-note"><h4>${e(t('上游 {version}', { version: data.upstreamRelease }))}</h4><p>${sourceText(f.upstream)}</p><a href="${source}" target="_blank" rel="noreferrer">${e(t('查看对照源码'))}${arrow}</a></div>${figure(f)}</div>`;
  return `<article class="feature" id="${f.id}" data-audience="${f.audiences.join(' ')}" data-feature="${f.id}" aria-labelledby="${f.id}-title">
    <div class="feature-heading"><h3 id="${f.id}-title"><a href="#${f.id}" class="permalink">${sourceText(f.title)}</a></h3><span class="feature-position" aria-hidden="true">${String(index + 1).padStart(2, '0')} / ${data.features.length}</span></div>
    <p class="feature-benefit">${sourceText(f.benefit)}</p>
    ${comparison}
    <div class="feature-details"><dl><div><dt>${e(t('入口'))}</dt><dd>${sourceText(f.entry)}</dd></div><div><dt>${e(t('默认'))}</dt><dd>${sourceText(f.default)}</dd></div><div><dt>${e(t('范围'))}</dt><dd>${sourceText(f.scope)}</dd></div></dl><div class="feature-source"><p>${sourceText(f.origin)}</p><a href="${docUrl(f.doc, data.forkCommit)}" target="_blank" rel="noreferrer">${e(t('详细用法与来源'))}${arrow}</a><a href="${f.forkSource}" target="_blank" rel="noreferrer">${e(t('本库对应源码'))}${arrow}</a></div></div>
  </article>`;
}

function chapters(data) {
  return data.groups.map(group => {
    const features = data.features.filter(f => f.group === group.id);
    return `<section class="chapter" id="${group.id}" data-chapter="${group.id}" aria-labelledby="${group.id}-heading"><header class="chapter-heading"><div><h2 id="${group.id}-heading">${sourceText(group.title)}</h2><p>${sourceText(group.description)}</p></div><span class="chapter-count">${e(t('{n} 项逐项图解', { n: features.length }))}</span></header>${features.map(f => feature(f, data.features.indexOf(f), data)).join('\n')}</section>`;
  }).join('\n');
}

export function render(data, versions) {
  const nav = data.groups.map((g, i) => `<a href="#${g.id}"><span class="chapter-number" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>${sourceText(g.title)}</a>`).join('');
  const rows = data.features.map(f => `<tr data-audience="${f.audiences.join(' ')}"><th scope="row"><a href="#${f.id}">${sourceText(f.title)}${arrow}</a></th><td>${sourceText(data.groups.find(g => g.id === f.group).title)}</td><td>${e(f.audiences.map(role => role === 'host' ? t('服主') : t('玩家')).join(' / '))}</td></tr>`).join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="theme-color" content="#0c0f0e">
<title>本库改进图鉴 · 卫戍协议：盟约</title><meta name="description" content="对照上游 v0.4.0，逐项查看本库在调配、战场信息、外观、联机、试算、个人数据与开服维护上的改进。附真实截图、入口、默认值与来源。">
<meta property="og:title" content="卫戍协议：盟约 · 本库改进图鉴"><meta property="og:description" content="在上游基础上，完善日常操作、联机协作与开服维护。"><meta property="og:type" content="website"><meta property="og:image" content="https://zhewang448.github.io/Stronghold-Protocol/assets/plates/strategy.png"><link rel="canonical" href="https://zhewang448.github.io/Stronghold-Protocol/">
<link rel="icon" href="assets/mark.svg" type="image/svg+xml"><link rel="stylesheet" href="styles.css"><link rel="preload" as="image" href="assets/plates/strategy.png"><script type="module" src="app.js"></script></head><body>
<a class="skip-link" href="#main">${e(t('跳到正文'))}</a>
<header class="masthead"><a class="brand" href="#top"><span class="brand-mark" aria-hidden="true"></span>${e(t('卫戍协议 · 本库特色'))}</a><nav class="top-nav" aria-label="${e(t('主要导航'))}"><a href="#loadout">${e(t('改进图鉴'))}</a><a href="#summary">${e(t('对照总览'))}</a><a href="#download">${e(t('下载与开服'))}</a><a href="${repository}" target="_blank" rel="noreferrer">GitHub${arrow}</a><span lang="zh-CN" class="language-label">${e(t('中文'))}</span></nav><button class="directory-toggle" type="button" aria-expanded="false" aria-controls="chapter-navigation" hidden>${e(t('章节目录'))}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button></header>
<aside class="sidebar" id="chapter-navigation"><h2>${e(t('章节导航'))}</h2><nav aria-label="${e(t('图鉴章节'))}">${nav}<a class="mobile-summary" href="#summary">${e(t('差异总表'))}</a><a class="mobile-summary" href="#download">${e(t('下载与开服'))}</a></nav><div class="sidebar-info"><p>${e(t('玩家与服主'))}</p><p>${e(t('全部逐项图解'))}</p></div><p class="sidebar-legal">${e(t('非官方 · 非商业'))}<br>${e(t('代码与素材权利分别说明'))}</p></aside>
<main id="main"><section class="hero" id="top" aria-labelledby="hero-title"><div class="hero-copy"><p class="project-name">${e(t('卫戍协议：盟约'))}</p><h1 id="hero-title">${e(t('本库改进图鉴'))}</h1><p class="hero-description">${e(t('在上游基础上，完善日常操作、'))}<br class="desktop-break">${e(t('联机协作与开服维护。'))}</p><div class="hero-actions"><a class="button primary" href="#loadout">${e(t('查看本库改进'))}${arrow}</a><a class="button" href="#download">${e(t('下载与开服'))}${arrow}</a></div><p class="hero-footnote">${e(t('选策略前看地图，准备时看预计叠层。'))}<br>${e(t('让小变化，在真正用到时更顺手。'))}</p></div>
<div class="hero-media"><figure class="hero-main-picture"><figcaption>${e(t('策略轮选 · 本库小地图实拍 · 2026-11-06'))}</figcaption><a href="${HERO_SCREENSHOTS.strategy}" data-zoom data-caption="策略轮选 · 本库小地图实拍 · 2026-11-06" aria-label="${e(t('放大小地图实拍'))}"><img src="assets/plates/strategy.png" width="1226" height="712" fetchpriority="high" alt="本库策略轮选左侧显示本局战场小地图，右侧保留策略选择与详情"><span class="image-corners" aria-hidden="true"></span></a></figure><div class="hero-secondary-pictures"><figure><a href="${HERO_SCREENSHOTS.namecard}" data-zoom data-caption="等待室名片 · 2026-11-06" aria-label="${e(t('放大等待室名片'))}"><img src="assets/plates/namecard.png" width="592" height="322" alt="等待室中的人物立绘与独立姓名牌底图" decoding="async"></a><figcaption>${e(t('等待室名片 · 2026-11-06'))}</figcaption></figure><figure><a href="${HERO_SCREENSHOTS.report}" data-zoom data-caption="图形战报 · 2026-11-12" aria-label="${e(t('放大图形战报'))}"><img src="assets/plates/report.png" width="598" height="322" alt="作战试算的 A/B 时间曲线与伤害构成战报" decoding="async"></a><figcaption>${e(t('图形战报 · 2026-11-12'))}</figcaption></figure></div></div>
<div class="comparison-baseline"><div><strong>${e(t('对照基线'))}</strong><span>${e(t('上游'))} <a href="${upstream}/commit/${data.upstreamCommit}">${e(data.upstreamRelease)} / ${data.upstreamCommit.slice(0, 7)}</a><span class="baseline-divider">·</span>${e(t('本库'))} <a href="${repository}/commit/${data.forkCommit}">${e(data.forkRelease)} / ${data.forkCommit.slice(0, 8)}</a></span></div><p>${e(t('同一能力说明具体增强；截图日期、适用范围与社区来源随条目保留。'))}</p></div>
<a class="hero-next" href="#loadout"><strong>${e(t('从使用场景开始'))}</strong><span>${e(t('配阵容 / 看战场 / 管外观 / 组队 / 复盘 / 备份 / 开服'))}</span>${arrow}</a></section>
<section class="comparison-policy" aria-labelledby="comparison-heading"><h2 id="comparison-heading">${e(t('怎样阅读这份对照'))}</h2><p>${e(t('本页按固定源码快照说明差异，不代表上游后续版本的功能现状。上游已有的能力会说明本库增强部分；社区移植保留原作者来源。'))}</p><p>${e(t('本库界面图片保留拍摄日期与用途。历史截图用于说明相关操作；同一开关的关闭与开启不作为上游和本库的对照。演示数值不构成性能或战力结论。'))}</p><p>${e(t('对照整理日期'))}：${e(data.date)} · ${e(t('当前源码快照'))}：${data.forkCommit.slice(0, 8)} · <a href="${repository}/releases/tag/${versions.extension}">${e(t('正式发布说明'))}</a></p></section>
<section class="comparison-policy" aria-labelledby="release-highlights"><h2 id="release-highlights">${e(versions.extension)}</h2><ul>${data.releaseHighlights.map(text => `<li>${sourceText(text)}</li>`).join('')}</ul><p><a href="${repository}/releases/tag/${versions.extension}">${e(t('正式发布说明'))}</a></p></section>
${chapters(data)}
<section class="summary-section" id="summary" aria-labelledby="summary-heading"><h2 id="summary-heading">${e(t('差异总表'))}</h2><p>${e(t('快速查找本库改进，再跳到对应图解。'))}</p><div class="filters" role="group" aria-label="${e(t('按使用人群筛选'))}" hidden><button type="button" data-filter="all" aria-pressed="true">${e(t('全部'))}</button><button type="button" data-filter="player" aria-pressed="false">${e(t('玩家'))}</button><button type="button" data-filter="host" aria-pressed="false">${e(t('服主'))}</button></div><p class="filter-status" role="status" aria-live="polite" hidden></p><div class="table-wrap"><table><caption class="visually-hidden">${e(t('本库改进条目与适用人群'))}</caption><thead><tr><th scope="col">${e(t('改进条目'))}</th><th scope="col">${e(t('使用场景'))}</th><th scope="col">${e(t('适用人群'))}</th></tr></thead><tbody>${rows}</tbody></table></div></section>
<section class="download-section" id="download" aria-labelledby="download-heading"><h2 id="download-heading">${e(t('下载与开服'))}</h2><div class="download-paths"><div><h3>${e(t('我是玩家'))}</h3><ol><li>${e(t('取得服主分享的游戏地址'))}</li><li>${e(t('在浏览器打开并加入同盟'))}</li><li>${e(t('先调配，再与朋友一起开始'))}</li></ol><a class="button" href="${docUrl('docs/PLAYING.md', data.forkCommit)}">${e(t('查看游玩说明'))}${arrow}</a></div><div><h3>${e(t('我要开服'))}</h3><ol><li>${e(t('下载 Windows 启动器或源码'))}</li><li>${e(t('新建 / 导入实例并启动服务'))}</li><li>${e(t('把游戏地址分享给朋友'))}</li></ol><a class="button primary" href="${repository}/releases/latest">${e(t('下载本库正式版'))}${arrow}</a><p><a href="${docUrl('launcher/README.md', data.forkCommit)}">${e(t('启动器说明'))}</a> · <a href="${docUrl('docs/DEPLOY.md', data.forkCommit)}">${e(t('其他系统与源码部署'))}</a></p></div></div><p class="download-versions">${e(t('扩展正式版'))} ${e(versions.extension)} · ${e(t('基础游戏'))} ${e(versions.game)} · ${e(t('启动器'))} ${e(versions.launcher)}<br>${e(t('关闭启动器窗口会保留后台服务；停服请使用停止服务器。'))}</p></section>
<footer id="credits"><h2>${e(t('共同基础与贡献来源'))}</h2><p>${e(t('游戏玩法、确定性模拟、官方数据与插件基础继承上游。本库特色包含原创扩展、社区适配和持续维护，各项来源随图解说明。'))}</p><p>${data.commonFoundation.map(sourceText).join('；')}。</p><p>${e(t('感谢 sganggs 及上游贡献者，LongQianChen、SiderLock、Stardust-minus、DoraCat、isomerpoi、xinhai-ai、DoingStone、RyantArgnisan 等社区作者。完整范围与许可见仓库声明。'))}</p><nav aria-label="${e(t('来源与文档'))}"><a href="${upstream}">${e(t('上游项目'))}</a><a href="${repository}/blob/main/README.md#仓库索引">${e(t('社区贡献'))}</a><a href="${docUrl('docs/LOCAL-CHANGELOG.md', data.forkCommit)}">${e(t('更新记录'))}</a><a href="${repository}/blob/main/LICENSE">${e(t('代码许可'))}</a><a href="${repository}/blob/main/NOTICE.md">${e(t('素材与截图声明'))}</a><a href="${repository}/issues">${e(t('反馈问题'))}</a></nav><div class="footer-legal"><p>${e(t('非官方、非商业同人项目。与明日方舟官方无隶属或授权关系，游戏素材与数据的权利归原权利人。'))}</p><p>${e(t('本库'))} ${e(versions.extension)} · ${e(t('上游对照'))} ${data.upstreamRelease} · ${e(t('启动器'))} ${e(versions.launcher)}</p></div><section class="star-invite" id="star-invite" aria-labelledby="star-heading"><h2 id="star-heading">${e(t('喜欢这些小优化，欢迎点个 Star'))}</h2><p>${e(t('如果本库让你的游玩或开服更顺手，欢迎点个 Star，支持这个非商业同人项目继续改进。'))}</p><a class="button primary" href="${repository}" target="_blank" rel="noreferrer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z"/></svg>${e(t('去 GitHub 点个 Star'))}${arrow}</a></section></footer>
</main><dialog class="lightbox" aria-labelledby="lightbox-caption"><div class="lightbox-toolbar"><p id="lightbox-caption"></p><button type="button" data-close aria-label="${e(t('关闭图片'))}">${e(t('关闭'))}<span aria-hidden="true">Esc</span></button></div><div class="lightbox-image"><img alt=""></div><a class="lightbox-original" href="#" target="_blank" rel="noreferrer">${e(t('打开原图'))}${arrow}</a></dialog></body></html>`;
}

export async function readCatalogue(root = new URL('./', import.meta.url)) {
  return JSON.parse(await fs.readFile(new URL('catalogue.json', root), 'utf8'));
}
