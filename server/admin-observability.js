// i18n-ignore-file: local host diagnostics.
import { PHASE_NAMES } from '../shared/constants.js';
import { CONVENIENCE_DEFAULTS } from '../shared/roomConvenience.js';

export function roomRules(room, match = room?.match) {
  const hp = room?.enemyHpMultiplier ?? match?.gd?.enemyHpMultiplier;
  const independent = room?.independentPools ?? match?.independentPools;
  const unite = room?.uniteLayerGains ?? match?.uniteLayerGainsEnabled;
  const content = room?.content;
  const choices = room?.convenience ?? match?.convenience;
  const convenience = choices && Object.keys(CONVENIENCE_DEFAULTS).every((key) => typeof choices[key] === 'boolean')
    ? Object.fromEntries(Object.keys(CONVENIENCE_DEFAULTS).map((key) => [key, choices[key]])) : null;
  return {
    enemyHpMultiplier: Number.isFinite(hp) ? hp : null,
    independentPools: typeof independent === 'boolean' ? independent : null,
    uniteLayerGains: typeof unite === 'boolean' ? unite : null,
    aiPicksLast: (room?.mode ?? match?.mode) === 'solo' ? true : typeof room?.aiPicksLast === 'boolean' ? room.aiPicksLast : typeof match?.aiPicksLast === 'boolean' ? match.aiPicksLast : null,
    test: typeof room?.test === 'boolean' ? room.test : typeof match?.test === 'boolean' ? match.test : null,
    gameplayPlugins: content ? content.vanilla === false : null,
    convenience,
    pluginRules: content?.rules || null,
    plugins: (content?.plugins || []).map(({ id, version, class: kind }) => ({ id, version, kind })),
  };
}

export function resultRules(record) {
  const result = record?.result || {};
  const rules = record?.rules;
  const convenience = rules?.convenience || result.convenience;
  const modifiedConvenience = Object.keys(CONVENIENCE_DEFAULTS).some((key) => typeof convenience?.[key] === 'boolean' && convenience[key] !== CONVENIENCE_DEFAULTS[key]);
  const custom = (Number.isFinite(result.enemyHpMultiplier) && result.enemyHpMultiplier !== 1)
    || result.independentPools === true || rules?.enemyHpMultiplier != null && rules.enemyHpMultiplier !== 1
    || rules?.independentPools === true || rules?.uniteLayerGains === true
    || rules?.aiPicksLast === false
    || rules?.gameplayPlugins === true || rules?.adminModified === true || modifiedConvenience;
  if (custom) return 'custom';
  if (!rules || rules.enemyHpMultiplier == null || rules.independentPools == null
    || rules.uniteLayerGains == null || rules.aiPicksLast == null || rules.gameplayPlugins == null || rules.adminModified == null
    || !rules.convenience || Object.keys(CONVENIENCE_DEFAULTS).some((key) => typeof rules.convenience[key] !== 'boolean')) return 'unknown';
  return 'standard';
}

export function battleView(match) {
  const now = match.sched?.now?.() ?? Date.now();
  return (match.fields || []).filter((field) => field.cc).map((field) => ({
    id: field.fieldId,
    kind: field.kind,
    players: (field.players || []).map((id) => ({ id, name: match.players.get(id)?.name || id })),
    mode: field.mode,
    authority: field.authority ? { id: field.authority, name: match.players.get(field.authority)?.name || field.authority } : null,
    done: !!field.done,
    verifying: !!field.verifyJob,
    held: !!field.heldResult,
    progress: field.progress ? { killed: field.progress.killed, total: field.progress.total, leaks: field.progress.leaks, gt: field.progress.gt } : null,
    elapsedSeconds: Number.isFinite(field.startAt) ? Math.max(0, Math.floor((now - field.startAt) / 1000)) : null,
    progressAgeSeconds: field.mode === 'client' && Number.isFinite(field.lastReportedAt) ? Math.max(0, Math.floor((now - field.lastReportedAt) / 1000)) : null,
    resultSource: field.resultSource || null,
    takeover: field.lastTakeover ? { ...field.lastTakeover,
      from: match.players.get(field.lastTakeover.from)?.name || field.lastTakeover.from,
      to: field.lastTakeover.to === 'server' ? '服务器' : match.players.get(field.lastTakeover.to)?.name || field.lastTakeover.to } : null,
  }));
}

export function stockView(match, requestedGroup) {
  if (!match?.gd || !Array.isArray(match.poolGroups)) return { error: '当前对局没有可用库存' };
  const now = match.sched?.now?.() ?? Date.now();
  const groups = match.poolGroups.map((group) => ({
    id: group.id,
    players: group.playerIds.map((id) => ({ id, name: match.players.get(id)?.name || id })),
  }));
  const group = match.poolGroups.find((entry) => String(entry.id) === String(requestedGroup)) || match.poolGroups[0];
  if (!group) return { error: '当前对局没有可用库存', groups };
  const gd = match.gd;
  const banned = new Set(match.bannedChess || []);
  const chess = gd.visibleChess.map((id) => {
    const entry = group.pool.entries.get(id);
    return {
      id, name: gd.chess(id)?.name || id, tier: gd.tierOf(id), banned: banned.has(id), available: !!entry,
      cap: entry?.cap ?? null, left: entry ? Math.max(0, entry.left) : null,
      held: entry ? entry.cap - entry.left : null,
    };
  });
  const itemIds = [...new Set(Object.values(gd.shopItemsByTier).flat().map((id) => gd.baseIdOf(id)))];
  const items = itemIds.filter((id) => gd.item(id)?.itemType === 'EQUIP').map((id) => {
    const cap = group.itemPool.cap(id), held = group.itemPool.held(id);
    return { id, name: gd.item(id)?.name || id, tier: gd.item(id)?.tier ?? null,
      cap, held, left: cap == null ? null : Math.max(0, cap - held), debt: group.itemPool.debtOf(id) };
  });
  const personal = group.playerIds.flatMap((id) => {
    const player = match.players.get(id);
    if (!player) return [];
    const entries = [...(player.diyStock?.entries || [])].map(([key, entry]) => ({
      id: key, name: player.gd.chess(key)?.name || key, tier: entry.tier,
      cap: entry.cap, left: Math.max(0, entry.left), held: entry.cap - entry.left, shopLevel: entry.shopLevel,
    }));
    for (const key of player.diyBanned || []) entries.push({ id: key, name: player.gd.chess(key)?.name || key, banned: true });
    return entries.length ? [{ id, name: player.name, entries }] : [];
  });
  return { groups, selected: group.id, round: match.round, phase: PHASE_NAMES[match.phase] || match.phase, capturedAt: now, chess, items, personal,
    disabledBonds: [...new Set([...(match.disabledBonds || []), ...(match.staticInactiveBonds || [])])].map((id) => gd.bond(id)?.name || id) };
}

export function lobbyBlockers(room) {
  if (room.match) return [];
  const blockers = [];
  if (room.versionVote) blockers.push('版本投票进行中');
  const humans = (room.seats || []).filter((seat) => seat && !seat.isBot && !seat.left);
  if (!humans.length) blockers.push('没有可开局的玩家');
  const host = humans.find((seat) => seat.playerId === room.hostId);
  if (!host) blockers.push('没有可用的房主');
  else if (!host.connected) blockers.push(`${host.name}（房主）离线`);
  if (room.mode === 'solo' && (humans.length !== 1 || (room.seats || []).some((seat) => seat?.isBot))) blockers.push('独立模拟的席位配置无效');
  for (const seat of humans) {
    if (seat.playerId !== room.hostId && !seat.connected) blockers.push(`${seat.name} 离线`);
    else if (seat.playerId !== room.hostId && !seat.ready) blockers.push(`${seat.name} 未准备`);
    if (room.content?.trusted && seat.consentCs !== room.content.cs) blockers.push(`${seat.name} 尚未同意插件`);
    if (room.needsContent && seat.content !== 'ready') blockers.push(`${seat.name} 的${room.content?.vanilla === false ? '插件' : '内容'}${seat.content === 'failed' ? '加载失败' : '尚未加载完成'}`);
  }
  return blockers;
}

export function matchWaiting(match) {
  if (match.paused) return ['对局已暂停'];
  const name = (id) => match.players.get(id)?.name || id;
  if (match.phase === 'INFO_CHECK') {
    const pending = (match.order || []).filter((player) => !player.isBot && !player.left && !player.infoReady).map((player) => player.name);
    return pending.length ? [`等待确认开局信息：${pending.join('、')}`] : [];
  }
  if (match.phase === 'BAND_DRAFT' || match.phase === 'SP_DRAFT') {
    const stage = match.phase === 'BAND_DRAFT' ? match.draft : match.sp;
    const pending = (stage?.groups || []).filter((group) => !group.done && group.order?.[group.idx]).map((group) => name(group.order[group.idx]));
    return pending.length ? [`等待${match.phase === 'BAND_DRAFT' ? '选择分队' : '选择机变'}：${pending.join('、')}`] : [];
  }
  if (match.phase === 'PREP') {
    const pending = (match.order || []).filter((player) => player.alive && !player.left && !player.ready).map((player) => player.name);
    return pending.length ? [`等待准备：${pending.join('、')}`] : [];
  }
  return [];
}

export function diagnosticEvents(match) {
  return { events: (match.adminDiagnostics || []).slice(), phase: PHASE_NAMES[match.phase] || match.phase, round: match.round };
}
