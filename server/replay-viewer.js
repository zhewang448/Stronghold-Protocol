/* global document, location, window */
// i18n-ignore-file: host-only Chinese console, served only by admin.js.
import { DIFFICULTY_NAMES } from '/shared/constants.js';
import { DEFAULT_VERSION, versionById } from '/shared/versions.js';
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kindName = { normal: '各自行动', unite: '联防', boss: '最终攻势', hidden: '隐秘核心' };
const sourceName = { client: '浏览器上报', server: '服务器接管', synthetic: '控制台判定或合成结果', 'boss-credited': '共享血池结算' };
const reasonName = { 'shared-boss': '领袖战缺少实时共享血池与全队生命同步，尝试播放仅模拟当前战场，最长播放至记录时长，结果可能不同。', synthetic: '这场战斗采用合成结果，无法原样重放。', unfinished: '战斗未结束，没有可核对的结果。', version: '版本已变，无法保证原样重放。' };
let replay, selected, runner, view, sequence = 0, paused = false, loading = false;
const nameOf = (pid) => replay.players?.find((p) => p.playerId === pid)?.name || pid;
const number = (n) => Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const bossLike = (f) => f.kind === 'boss' || f.kind === 'hidden';
const warnings = (f) => [!replay.compatible && reasonName.version, bossLike(f) && reasonName['shared-boss']].filter(Boolean).join(' ');
const playingText = () => selected.playable ? '正在播放，结束后核对结果…' : `正在尝试播放；${warnings(selected)}`;

function stop() {
  sequence++;
  runner?.dispose(); runner = null;
  view?.destroy(); view = null;
  paused = loading = false;
  $('field').hidden = true;
  $('pause').disabled = $('restart').disabled = true;
  $('pause').textContent = '暂停';
}

function showDetails(f) {
  const pp = Object.entries(f.result?.perPlayer || {});
  const formations = (f.lineup || f.spec.players).map((p) => `<h3>${esc(nameOf(p.playerId))} · 上场阵容</h3>
    <div class="xscroll"><table><thead><tr><th scope="col">单位</th><th scope="col">位置 / 朝向</th><th scope="col">技能 / 模组</th><th scope="col">潜能 / 练度</th><th scope="col">装备</th></tr></thead>
    <tbody>${p.units.map((u) => `<tr><th scope="row">${esc(u.name || u.chessId || u.tokenId)}${u.standIn ? '（补位）' : ''}${u.diy ? `（自选 ${esc(u.diy.charId)}）` : ''}</th>
      <td>${esc(u.row)}, ${esc(u.col)} / ${esc(u.dir)}</td><td>${esc(u.diy?.skillIndex ?? u.skillIndex ?? '—')} / ${esc(u.diy?.uniEquipId ?? u.moduleId ?? '—')}</td>
      <td>${esc(u.potential ?? '—')} / ${esc(u.cultivate ?? '—')}</td><td>${(u.itemNames || u.items || []).map(esc).join('、') || '—'}</td></tr>`).join('') || '<tr><td colspan="5">空阵容</td></tr>'}</tbody></table></div>`).join('');
  $('details').innerHTML = `<h3>已采纳结果 · ${esc(sourceName[f.source] || '尚无结果')}</h3>
    <p class="meta">战斗时长 ${number(f.result?.time)} 秒 · ${f.result?.reason === 'cleared' ? '已清场' : esc(f.result?.reason || '未完成')}</p>
    <ul>${pp.map(([pid, p]) => `<li>${esc(nameOf(pid))}：击杀 ${number(p.killed)} / ${number(p.total)}，漏怪 ${(p.leaked || []).filter((e) => e.counted !== false).length}，伤害 ${number(p.damageDealt)}，领袖伤害 ${number(p.bossDamage)}${p.perfect ? '，完美作战' : ''}</li>`).join('')}</ul>
    ${formations}<h3>敌人（按实际出场计划）</h3><ul class="enemy-list">${(f.enemies || f.spec.spawns).map((e) => `<li>${esc(e.name || e.enemyKey)} × ${e.count || 1} · ${number(e.time)} 秒${e.boss ? ' · 领袖' : ''}</li>`).join('') || '<li>没有敌人</li>'}</ul>
    <details><summary>完整战斗输入与结果</summary><p class="meta">包含盟约、效果、技能、模组及联防携带状态。</p><pre class="xscroll"></pre></details>`;
  $('details').querySelector('pre').textContent = JSON.stringify({ spec: f.spec, result: f.result }, null, 2);
}

function choose(index) {
  stop();
  selected = replay.rounds.flatMap((r) => r.fields)[index];
  const f = selected;
  for (const b of document.querySelectorAll('[data-field]')) b.setAttribute('aria-pressed', String(Number(b.dataset.field) === index));
  $('field-title').textContent = `${kindName[f.kind] || f.kind} · ${f.players.map(nameOf).join('、')}`;
  $('field-meta').textContent = `第 ${f.spec.round} 回合 · 战场 ${f.fieldId} · ${sourceName[f.source] || '尚无结果'}`;
  $('digest').className = f.reason ? 'warn' : 'meta';
  $('digest').textContent = (f.canAttempt && warnings(f)) || reasonName[f.reason] || '播放结束后，将核对模拟结果与已采纳结果。';
  $('play').disabled = !f.playable && !f.canAttempt;
  $('play').textContent = !f.playable && f.canAttempt ? '仍然尝试播放' : '播放战斗';
  showDetails(f);
}

async function play() {
  if (!selected || loading || (!selected.playable && !selected.canAttempt)) return;
  if (!selected.playable && !window.confirm(`${warnings(selected)} 可能无法播放或得出不同结果。仍然尝试？`)) return;
  stop();
  const seq = sequence, f = selected;
  loading = true;
  $('play').disabled = true;
  $('digest').className = 'meta';
  $('digest').textContent = '正在加载模拟器和战场…';
  try {
    const [{ createBattleRunner }, { createFieldView }, { data }, { assets }, { resultDigest }] = await Promise.all([
      import('/js/battle/runner.js'), import('/js/render/app.js'), import('/js/data.js'), import('/js/assets.js'), import('/sim/spec.js'),
    ]);
    await data.loadAll('chess', 'tokens', 'items', 'enemies', 'stages', 'bonds', 'config');
    if (seq !== sequence) return;
    let replayContent = null, contentIndex = null;
    if (f.spec.cs) {
      const { loadContentSet, loadVersionSet } = await import('/js/content.js');
      const version = replay.version || DEFAULT_VERSION;
      const set = version !== DEFAULT_VERSION
        ? await loadVersionSet(f.spec.cs, version)
        : await loadContentSet(f.spec.cs, { allowVanilla: true });
      if (seq !== sequence) return;
      if (set.canSim === false) throw new Error('该回放需要脚本插件授权，请在原房间确认脚本后查看实时战场');
      contentIndex = set.index;
      data.setContent({ id: set.cs, values: set.values });
      replayContent = { cs: set.cs, version: set.version, data: Object.fromEntries(set.values), bounds: set.bounds, scripts: set.scripts || [], hashInput: set.index, nativeVerified: set.nativeVerified };
    } else {
      if (replay.version && replay.version !== DEFAULT_VERSION) throw new Error('历史版本回放缺少内容身份，无法加载原版本数据');
      data.setContent(null);
    }
    await assets.ready();
    if (seq !== sequence) return;
    $('field').hidden = false;
    const nextView = await createFieldView($('field'), { data, assets, settings: { quality: 'high', damageNumbers: true } });
    if (seq !== sequence) { nextView.destroy(); return; }
    view = nextView;
    view.setStage(data.lookup('stages', f.spec.stageId));
    const net = { on: () => () => {}, send() {}, request: async () => ({ ok: true }) };
    runner = createBattleRunner({ net, store: null, vanillaCs: () => contentIndex?.vanilla && !replayContent?.version ? f.spec.cs : 'original',
      simContent: () => replayContent, contentFor: async () => replayContent });
    runner.on('field', (field) => { view.enterBattle(field); view.setCamera(f.kind, { rect: field.rect, side: 'L', instant: true }); });
    runner.on('snap', (snap) => view.pushSnapshot(snap));
    runner.on('ev', (ev) => view.pushEvents(ev));
    runner.on('state', (state) => { if (state) view.setLocalFeed({ on: true, speed: state.speed }); });
    runner.on('result', ({ result }) => {
      const actual = resultDigest(result);
      const same = actual.json === f.digest?.json;
      $('digest').className = same && f.playable ? 'good' : 'warn';
      $('digest').textContent = bossLike(f)
        ? `领袖战尝试播放结束：本次结果${same ? '摘要相同，仍无法保证原样重放。' : '与记录不同。'} ${warnings(f)}`
        : replay.compatible
        ? same ? '与记录一致' : '与记录不一致：当时采纳的结果与本次模拟不同。'
        : `版本不一致：本次结果${same ? '摘要相同，仍无法保证原样重放。' : '与记录不同。'}`;
      $('pause').disabled = true;
    });
    // No live b.pool / team-LP updates were recorded. End a boss attempt at its recorded game time
    // so a field that depended on another field or the match's overtime drain cannot idle forever.
    const spec = bossLike(f) ? { ...f.spec, timeLimit: Math.max(1 / 30, f.result.time) } : f.spec;
    await runner.onStart({ t: 'b.start', spec, battleId: f.battleId, fieldId: f.fieldId, kind: f.kind, elapsed: 0,
      speed: Number($('speed').value), authoritative: true, watch: false, done: false });
    if (seq !== sequence) return;
    if (!runner.state()) throw new Error('模拟器无法读取此战斗');
    $('restart').disabled = false;
    $('pause').disabled = !!runner.state()?.done;
    if (!runner.state()?.done) $('digest').textContent = playingText();
  } catch (e) {
    if (seq !== sequence) return;
    $('digest').className = 'bad';
    $('digest').textContent = `播放失败：${e.message}。可重新播放，或检查本机素材与版本。`;
    $('restart').disabled = false;
  } finally {
    if (seq === sequence) { loading = false; $('play').disabled = false; }
  }
}

$('play').onclick = $('restart').onclick = play;
$('pause').onclick = () => {
  paused = !paused;
  runner?.setPaused(paused);
  $('pause').textContent = paused ? '继续播放' : '暂停';
  if (!runner?.state()?.done) $('digest').textContent = paused
    ? `已暂停${selected.playable ? '，继续播放后核对结果。' : `；${warnings(selected)}`}`
    : playingText();
};
$('speed').onchange = () => runner?.setSpeed(Number($('speed').value));
$('timeline').onclick = (e) => { const b = e.target.closest('[data-field]'); if (b) choose(Number(b.dataset.field)); };
window.addEventListener('pagehide', stop);

async function init() {
  try {
    const id = new URLSearchParams(location.search).get('id');
    const response = await fetch(`/api/replay?id=${encodeURIComponent(id || '')}`, { headers: { 'X-Admin-Token': document.querySelector('meta[name="admin-token"]').content } });
    replay = await response.json();
    if (!response.ok || replay.error) throw new Error(replay.error || '读取失败');
    const modeName = replay.mode.startsWith('mode_single_') ? '独立模拟' : '同盟';
    $('match-meta').textContent = `房间 ${replay.room} · 游戏版本 ${versionById(replay.version || DEFAULT_VERSION)?.label || replay.version} · ${modeName} / ${DIFFICULTY_NAMES[replay.difficulty] || replay.difficulty} · ${new Date(replay.savedAt).toLocaleString('zh-CN')} · 种子 ${replay.seed} · 程序版本 ${replay.made.app}${replay.made.release ? ` / ${replay.made.release}` : ''}`;
    $('notice').className = replay.compatible ? 'meta' : 'warn';
    $('notice').textContent = replay.compatible ? '录制与当前模拟器、数据指纹一致。最终攻势和隐秘核心可确认后尝试播放，无法保证原样重放；合成结果和未完成战斗仅供查看。' : '版本已变，无法保证原样重放。普通战斗、联防、最终攻势和隐秘核心可确认后尝试播放；合成结果和未完成战斗仅供查看。';
    const rounds = new Map(); let index = 0;
    for (const r of replay.rounds) {
      if (!rounds.has(r.round)) rounds.set(r.round, { fields: [], admin: [] });
      const group = rounds.get(r.round);
      group.fields.push(...r.fields.map((f) => ({ f, index: index++ })));
      group.admin.push(...r.admin);
    }
    $('timeline').innerHTML = [...rounds.entries()].sort((a, b) => a[0] - b[0]).map(([round, r]) => `<details open><summary>第 ${round} 回合${r.admin.length ? ' · 有控制台干预' : ''}</summary>
      ${r.fields.map(({ f, index: i }) => `<button class="field-choice" data-field="${i}" aria-pressed="false">${esc(kindName[f.kind] || f.kind)} · ${f.players.map((p) => esc(nameOf(p))).join('、')}<br><span class="meta">${esc(sourceName[f.source] || '未完成')}${f.playable ? ' · 可播放' : f.canAttempt ? ' · 可尝试播放' : ' · 仅查看'}</span></button>`).join('')}
      ${r.admin.length ? `<details><summary>控制台操作 ${r.admin.length} 条</summary><ul>${r.admin.map((a) => `<li>${esc(a.action)}${a.player ? ` · ${esc(a.player)}` : ''}${a.value != null ? ` · ${esc(JSON.stringify(a.value))}` : ''}</li>`).join('')}</ul></details>` : ''}</details>`).join('') || '<p class="meta">没有战斗输入。旧服务器串流模式或录制前结束的对局不可播放。</p>';
    document.querySelector('main').hidden = false;
    if (index) choose(0);
    else $('notice').textContent += ' 本局没有可播放的战场输入。';
  } catch (e) { $('notice').className = 'bad'; $('notice').textContent = `${e.message}。请返回控制台刷新记录；服务器重启后需重新打开控制台。`; }
}
init();
