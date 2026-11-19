// Client presentation policy, not battle content. The owner supplies first-use
// defaults and may temporarily force a value; the browser keeps its own saved
// preference separately. All user controls are allowed by default.
// i18n-ignore-file: catalogue labels are host-console text; client UI keeps t().
import { SKIN_LIMITS, isCharId } from './protocol.js';
import { UI_LIMITS } from './plugins/ui.js';
import { isPluginId } from './plugins/manifest.js';
import { migrateThemePreferences, normalizeUiTheme } from './themePreferences.js';
import { CURSOR_SIZES, DEFAULT_CURSOR_SIZE } from './cursor.js';
const bool = (key, label, value, group) => ({ key, label, default: value, type: 'boolean', group });
const number = (key, label, value, min, max, step, group) => ({ key, label, default: value, type: 'number', min, max, step, group });
const choice = (key, label, value, options, group) => ({ key, label, default: value, type: 'choice', options, group });
const settings = '声音、显示与资源';
const lobbyMediaGroup = '大厅背景与音乐';
export const CLIENT_PREFERENCE_FIELDS = Object.freeze([
  number('settings.bgm', '背景音乐', 0.6, 0, 1, 0.01, settings),
  number('settings.sfx', '音效', 0.8, 0, 1, 0.01, settings),
  number('settings.voice', '干员语音', 0.8, 0, 1, 0.01, settings),
  choice('settings.voiceLang', '语音语言', 'cn', ['cn', 'jp', 'en', 'kr'], settings),
  bool('settings.voiceNative', '本土语言', false, settings),
  { key: 'settings.voiceOverrides', label: '逐干员语音配置', default: {}, type: 'voiceOverrides', group: settings },
  ...[
    ['muted', '静音', false], ['damageNumbers', '显示伤害数字', true], ['officialDamageNumbers', '官方伤害数字', false],
    ['ammoEnergyCount', '显示弹药与能量数量', false], ['fullscreenWakeLock', '全屏时保持屏幕常亮', false],
    ['bondTimers', '盟约效果剩余时间', false], ['combatMetrics', '作战统计', true], ['chatBubbles', '显示消息提示气泡', true],
    ['deploymentZoom', '部署时镜头缩放', false], ['deploySnap', '部署时按格子吸附', true], ['showFps', '显示帧率', true], ['preload', '预载资源', false],
    ['officialBattleHud', '还原战场状态条', true], ['shopPortraitFocus', '突出商店人像', false],
    ['preloadOptional', '预载可选资源', false], ['preloadDynamic', '下载动态立绘', false], ['otherSkins', '显示其他玩家的皮肤', true],
    ['upstreamReleaseNotes', '显示上游更新内容', true], ['extensionReleaseNotes', '显示扩展更新内容', true],
  ].map(([key, label, value]) => bool('settings.' + key, label, value, settings)),
  choice('settings.fpsLimit', '帧率上限', 0, [0, 30, 60, 120], settings),
  choice('settings.quality', '画面质量', 'high', ['low', 'medium', 'high'], settings),
  choice('settings.officialFx', '官方特效', 'auto', ['auto', 'off', 'lite', 'full'], settings),
  choice('settings.dynamicIllustrations', '动态立绘', 'auto', ['auto', 'static'], settings),
  choice('settings.textSize', '文字大小', 'sm', ['sm', 'md', 'lg', 'xl'], settings),
  { key: 'settings.uiTheme', label: '界面主题', default: '', type: 'themeId', options: ['', 'ac_n_initial', 'ac_n_iron', 'ac_s_closur'], group: settings },
  bool('settings.themeVoice', '对局主题语音', false, settings),
  bool('settings.themeMotion', '主题动画', true, settings),
  choice('settings.cursorTheme', '骷髅手指光标', 'system', ['system', 'arknights'], settings),
  choice('settings.cursorSize', '鼠标大小', DEFAULT_CURSOR_SIZE, [DEFAULT_CURSOR_SIZE, ...CURSOR_SIZES], settings),
  bool('settings.watchDuringBattle', '作战中查看队友', false, settings),
  { key: 'settings.preloadVoiceLang', label: '预载语音语言', default: ['cn', 'jp'], type: 'voiceLanguages', group: settings },
  { key: 'settings.keys', label: '快捷键', type: 'keys', default: { buy: 'KeyW', refresh: 'KeyR', freeze: 'KeyF', levelUp: 'KeyD', retreat: 'KeyQ', sell: 'KeyX', ready: 'Space' }, group: '界面、语言与操作' },
  { key: 'language', label: '界面语言', type: 'language', default: 'zh', group: '界面、语言与操作' },
  bool('backupReminder.enabled', '定期提醒导出个人数据', true, '界面、语言与操作'),
  choice('loadout.view', '干员调配显示方式', 'deck', ['deck', 'list'], '界面、语言与操作'),
  ...['l', 'r', 't', 'b'].map((key, i) => number('screenFit.' + key, ['左侧适配（像素）', '右侧适配（像素）', '顶部适配（像素）', '底部适配（像素）'][i], 0, -100, 100, 1, '界面、语言与操作')),
  number('screenFit.ui', '界面大小（百分比）', 100, 75, 100, 5, '界面、语言与操作'),
  { key: 'cosmetics.ids', label: '个人外观插件', default: [], type: 'pluginIds', group: '外观' },
  { key: 'uiPlugins.ids', label: '个人界面插件', default: [], type: 'pluginIds', group: '外观' },
  choice('skinRandom.scope', '皮肤随机范围', 'all', ['all', 'equipped', 'unequipped'], '外观'),
  bool('skinRandom.auto', '每局自动随机皮肤', false, '外观'),
  { key: 'skinRandom.locked', label: '皮肤锁定干员', default: {}, type: 'skinLocks', group: '外观' },
  choice('hubBackdrop.theme', '大厅背景主题', 'night', ['night', 'frost', 'ember', 'calm', 'custom'], lobbyMediaGroup),
  number('hubBackdrop.dim', '大厅背景暗度（百分比）', 45, 0, 85, 1, lobbyMediaGroup),
  number('hubBackdrop.blur', '大厅背景模糊', 0, 0, 16, 1, lobbyMediaGroup),
  bool('hubBackdrop.overlay', '背景战术网格', true, lobbyMediaGroup),
  bool('hubBackdrop.motion', '背景动态效果', true, lobbyMediaGroup),
  bool('hubBackdrop.videoSound', '播放背景视频声音', false, lobbyMediaGroup),
  bool('hubBackdrop.videoPaused', '暂停背景视频', false, lobbyMediaGroup),
].map(field => Object.freeze(field)));
const clone = value => JSON.parse(JSON.stringify(value));
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const byKey = new Map(CLIENT_PREFERENCE_FIELDS.map(f => [f.key, f]));
export const clientPreferenceField = key => byKey.get(key) || null;
export const clientPreferenceDefaults = () => Object.fromEntries(CLIENT_PREFERENCE_FIELDS.map(f => [f.key, clone(f.default)]));
export const defaultClientPreferencePolicy = () => ({ defaults: clientPreferenceDefaults(), userControls: Object.fromEntries(CLIENT_PREFERENCE_FIELDS.map(f => [f.key, true])) });
const codes = new Set([...Array.from({ length: 26 }, (_, i) => 'Key' + String.fromCharCode(65 + i)), ...Array.from({ length: 10 }, (_, i) => 'Digit' + i),
  'Space', 'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown']);
export function validClientPreference(field, value) {
  if (field.type === 'themeId') return typeof value === 'string' && normalizeUiTheme(value) === value;
  if (field.type === 'boolean') return typeof value === 'boolean';
  if (field.type === 'choice') return field.options.includes(value);
  if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value) && value >= field.min && value <= field.max
    && (field.step >= 1 ? Number.isInteger((value - field.min) / field.step) : true);
  if (field.type === 'language') return typeof value === 'string' && /^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(value) && value.length <= 32;
  if (field.type === 'pluginIds') return Array.isArray(value) && value.length <= (field.key === 'uiPlugins.ids' ? UI_LIMITS.maxPlugins : 32) && new Set(value).size === value.length && value.every(isPluginId);
  if (field.type === 'voiceLanguages') return Array.isArray(value) && value.length <= 4 && new Set(value).size === value.length && value.every(v => ['cn', 'jp', 'en', 'kr'].includes(v));
  if (field.type === 'voiceOverrides') return object(value) && Object.keys(value).length <= 512 && Object.entries(value).every(([id, lang]) => /^char_\d+_[a-z0-9]+$/.test(id) && id.length <= 80 && ['cn', 'jp', 'en', 'kr', 'native'].includes(lang));
  if (field.type === 'skinLocks') return object(value) && Object.keys(value).length <= SKIN_LIMITS.entries && Object.entries(value).every(([id, on]) => isCharId(id) && on === true);
  if (field.type === 'keys') return object(value) && Object.keys(value).length === Object.keys(field.default).length && Object.keys(field.default).every(key => Object.hasOwn(value, key) && codes.has(value[key])) && new Set(Object.values(value)).size === Object.keys(field.default).length;
  return false;
}
// Old full console saves include both sets of keys, even when the live fields
// were untouched. A non-default or locked live value takes precedence.
const legacyLobby = [
  bool('lobbyMedia.backdrop', '使用自定义大厅背景', false, lobbyMediaGroup),
  bool('lobbyMedia.music', '使用自定义大厅音乐', false, lobbyMediaGroup),
  number('lobbyMedia.dim', '自定义背景暗度', 0.35, 0, 0.8, 0.01, lobbyMediaGroup),
  choice('lobbyMedia.scene', '大厅场景', 'official', ['official', 'night', 'frost', 'ember', 'calm'], lobbyMediaGroup),
];
function migrateLobbyPolicy(raw) {
  const defaults = { ...raw.defaults }, userControls = { ...raw.userControls };
  const [backdrop, , dim, scene] = legacyLobby.map(field => field.key);
  const theme = 'hubBackdrop.theme', darkness = 'hubBackdrop.dim';
  const unlockedDefault = key => userControls[key] !== false && (!Object.hasOwn(defaults, key) || defaults[key] === byKey.get(key).default);
  const migrate = (key, value, locked) => {
    defaults[key] = value;
    if (locked) userControls[key] = false;
  };
  const oldThemeLocked = userControls[backdrop] === false || userControls[scene] === false;
  const custom = defaults[backdrop] === true;
  const oldScene = defaults[scene] ?? 'official';
  const changedScene = oldScene !== 'official';
  if (unlockedDefault(theme) && (custom || changedScene || oldThemeLocked)) {
    migrate(theme, custom ? 'custom' : changedScene ? oldScene : 'night', oldThemeLocked);
  }
  const oldDimLocked = userControls[dim] === false;
  const oldDim = defaults[dim] ?? 0.35;
  const changedDim = Object.hasOwn(defaults, dim) && (!Object.hasOwn(defaults, darkness) || oldDim !== 0.35);
  if (unlockedDefault(darkness) && (oldDimLocked || changedDim)) {
    migrate(darkness, Math.round(oldDim * 100), oldDimLocked);
  }
  // Music files and playback stay under the player's current local music controls.
  for (const field of legacyLobby) {
    delete defaults[field.key];
    delete userControls[field.key];
  }
  return { defaults, userControls };
}

/** Partial updates preserve omitted fields. Invalid updates are atomic. */
export function normalizeClientPreferencePolicy(raw, current = defaultClientPreferencePolicy()) {
  if (!object(raw) || Object.keys(raw).some(k => !['defaults', 'userControls'].includes(k))) return { error: '客户端设置配置格式无效' };
  for (const section of ['defaults', 'userControls']) {
    if (!Object.hasOwn(raw, section)) continue;
    if (!object(raw[section])) return { error: '客户端设置配置格式无效' };
    for (const field of legacyLobby) {
      if (!Object.hasOwn(raw[section], field.key)) continue;
      const value = raw[section][field.key];
      if (!(section === 'userControls' ? typeof value === 'boolean' : validClientPreference(field, value))) return { error: '客户端设置值无效：' + field.label };
    }
  }
  raw = migrateLobbyPolicy(raw);
  const next = migrateLobbyPolicy(clone(current));
  const aliases = { 'settings.terminalTheme': 'settings.uiTheme', 'settings.terminalVoice': 'settings.themeVoice' };
  for (const section of ['defaults', 'userControls']) {
    next[section] ||= {};
    for (const [old, key] of Object.entries(aliases)) {
      if (Object.hasOwn(next[section], old) && !Object.hasOwn(next[section], key)) next[section][key] = section === 'defaults' && key === 'settings.uiTheme' ? normalizeUiTheme(next[section][old]) : next[section][old];
      delete next[section][old];
    }
    for (const field of CLIENT_PREFERENCE_FIELDS) if (!Object.hasOwn(next[section], field.key)) next[section][field.key] = section === 'defaults' ? clone(field.default) : true;
  }
  for (const section of ['defaults', 'userControls']) {
    for (const [inputKey, inputValue] of Object.entries(raw[section])) {
      const key = aliases[inputKey] || inputKey;
      if (key !== inputKey && Object.hasOwn(raw[section], key)) continue;
      const value = section === 'defaults' && inputKey === 'settings.terminalTheme' ? normalizeUiTheme(inputValue) : inputValue;
      const field = byKey.get(key);
      if (!field || !(section === 'userControls' ? typeof value === 'boolean' : validClientPreference(field, value))) return { error: '客户端设置值无效：' + (field?.label || key) };
      next[section][key] = clone(value);
    }
  }
  return { config: next };
}

/** Explicit current values win over retired aliases; missing fields stay absent. */
export function migrateClientSettings(raw) {
  const value = migrateThemePreferences(object(raw) ? raw : {});
  if (!Object.hasOwn(value, 'dynamicIllustrations')) {
    if (value.dynamicIllustration === false || value.dynamicIllust === false) value.dynamicIllustrations = 'static';
  }
  if (value.dynamicIllustrations === false) value.dynamicIllustrations = 'static';
  if (value.dynamicIllustrations === true) value.dynamicIllustrations = 'auto';
  if (!Object.hasOwn(value, 'deploymentZoom') && typeof value.prepDeployFold === 'boolean') value.deploymentZoom = value.prepDeployFold;
  if (!Object.hasOwn(value, 'ammoEnergyCount') && (Object.hasOwn(value, 'ammoCount') || Object.hasOwn(value, 'mysticEnergy'))) value.ammoEnergyCount = value.ammoCount === true || value.mysticEnergy === true;
  return value;
}
