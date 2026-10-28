import { addMessages, setLang, t } from '../../shared/i18n.js';

const byId = (id) => document.getElementById(id);
const phaseButtons = [...document.querySelectorAll('#phase-selector button')];
const galleryButtons = [...document.querySelectorAll('#gallery-selector button')];
const demo = byId('demo');
const openDemo = byId('open-demo');
const galleryImage = byId('gallery-image');
const galleryCaption = byId('gallery-caption');

function renderCopy() {
  const copy = {
    'source-link': t('查看源码'),
    'hero-title': t('先看看同盟作战的模样。'),
    'hero-description': t('从大厅到战场，浏览真实界面截图，也可以亲自体验模拟的局内操作。'),
    'experience-link': t('进入互动预览'),
    'gallery-link': t('浏览界面'),
    'hero-note': t('无需本地服务器 · 仅为模拟演示'),
    'experience-title': t('试试局内操作'),
    'experience-description': t('使用模拟数据切换阶段、购买干员和操作界面；不会连接房间或影响正式存档。'),
    'open-demo': t('单独打开'),
    'demo-note': t('互动预览为中文；干员形象和部分图标使用占位画面；手机建议横屏或单独打开。'),
    'gallery-title': t('更多界面'),
    'gallery-description': t('以下为项目中的实际截图，点击下方选项切换。'),
    'footer-note': t('非官方 · 非商业同人项目'),
  };
  for (const [id, text] of Object.entries(copy)) byId(id).textContent = text;
  const phaseLabels = [t('整备'), t('敌方情报'), t('策略轮选'), t('机变'), t('战斗'), t('结算')];
  const galleryLabels = [t('在线玩家与房间邀请'), t('多人分组轮选'), t('回合统计'), t('主机控制台'), t('手机界面')];
  phaseButtons.forEach((button, index) => { button.textContent = phaseLabels[index]; });
  galleryButtons.forEach((button, index) => { button.textContent = galleryLabels[index]; });
  byId('phase-selector').setAttribute('aria-label', t('选择预览阶段'));
  byId('gallery-selector').setAttribute('aria-label', t('选择截图'));
  demo.title = t('局内界面互动预览');
  byId('hero-image').alt = t('界面截图：{name}', { name: galleryLabels[1] });
  const selected = galleryButtons.find((button) => button.getAttribute('aria-pressed') === 'true');
  galleryCaption.textContent = selected.textContent;
  galleryImage.alt = t('界面截图：{name}', { name: selected.textContent });
  document.title = `${t('界面预览')} · ${t('卫戍协议：盟约')}`;
}

function selectButton(buttons, selected) {
  for (const button of buttons) button.setAttribute('aria-pressed', String(button === selected));
}

for (const button of phaseButtons) {
  button.addEventListener('click', () => {
    const params = new URLSearchParams({ phase: button.dataset.phase, render: 'fallback', shot: '1' });
    if (button.dataset.variant) params.set('variant', button.dataset.variant);
    const url = `dev/game-mock.html?${params}`;
    demo.src = url;
    openDemo.href = url;
    selectButton(phaseButtons, button);
  });
}

for (const button of galleryButtons) {
  button.addEventListener('click', () => {
    galleryImage.src = `media/features/${button.dataset.image}`;
    galleryImage.alt = t('界面截图：{name}', { name: button.textContent });
    galleryCaption.textContent = button.textContent;
    selectButton(galleryButtons, button);
  });
}

const language = (navigator.languages?.[0] || navigator.language || 'zh').toLowerCase();
const pack = language.startsWith('zh-tw') || language.startsWith('zh-hk') ? 'zh-TW'
  : ['en', 'ja', 'ko'].find((code) => language === code || language.startsWith(`${code}-`));
if (pack) {
  try {
    const response = await fetch(new URL(`../i18n/${pack}.json`, import.meta.url));
    if (response.ok) {
      addMessages(pack, await response.json());
      setLang(pack);
      document.documentElement.lang = pack;
    }
  } catch (error) {
    console.warn('[preview] language pack unavailable', error);
  }
}
renderCopy();
