// Native UI actions against a real disposable server. No existing game service is restarted.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Client, hasChrome, startRealServer, OUT } from "../e2e/client.mjs";
import { textProblems } from "../e2e/text-fit.mjs";

describe("named loadout presets (real browser)", { skip: !(process.env.SP_E2E === "1" && hasChrome()) }, () => {
  let srv, P;
  before(async () => { srv = await startRealServer(); P = (await import("puppeteer-core")).default; });
  after(async () => { await srv?.stop(); });
  const button = id => `[data-testid="${id}"]`;
  const library = c => c.page.evaluate(() => JSON.parse(localStorage.getItem("sp.pref.loadoutPresets")));
  async function input(c, name) {
    await c.click(button("preset-name")); await c.page.keyboard.down("Control"); await c.page.keyboard.press("A"); await c.page.keyboard.up("Control"); await c.page.keyboard.type(name);
  }
  async function create(c, name) {
    await c.click(button("preset-selector")); await c.click(button("preset-save-as"));
    await input(c, name); await c.click(button("preset-save-confirm"));
    await c.page.waitForSelector(".lp-dialog", { hidden: true });
  }
  async function settle(c) {
    await c.page.waitForSelector(".lp-dialog");
    await c.page.evaluate(() => Promise.all([...document.querySelectorAll(".lp-veil, .lp-dialog")].flatMap(e => e.getAnimations()).map(a => a.finished.catch(() => {}))));
  }
  test("invalid imports preserve settings and legacy empty ops restores defaults", { timeout: 120000 }, async () => {
    const c = new Client(P, srv.base, "invalid-import", { prefix: "loadout-invalid-import", w: 1280, h: 720 });
    try {
      await c.open(); await c.enter("导入保护回归"); await c.click(".lobby-screen [data-testid=loadout-open]");
      await c.click(button("loadout-filter")); await c.click(button("loadout-view-list"));
      await c.page.waitForSelector(".lo-list__rows select[data-cult=potential]");
      await c.page.select(".lo-list__rows select[data-cult=potential]", "1");
      const before = await c.page.evaluate(() => localStorage.getItem("sp.pref.loadout"));
      const paste = async value => {
        await c.click(button("loadout-import"));
        await c.page.$eval(button("loadout-io-text"), e => e.scrollIntoView({ block: "center" }));
        await c.click(button("loadout-io-text")); await c.page.keyboard.type(JSON.stringify(value));
      };
      await paste({ kind: "stronghold.loadout", v: 2, byChar: { char_199_yak: { skill: 9 } }, ops: {} });
      await c.click(button("loadout-io-apply")); await c.page.waitForSelector(".lo-transfer-dialog .lp-error");
      assert.equal(await c.page.evaluate(() => localStorage.getItem("sp.pref.loadout")), before);
      await c.page.keyboard.press("Escape");
      await paste({ kind: "stronghold.loadout", v: 2, byChar: { char_199_yak: { skill: 999 } }, ops: {},
        extension: { v: 1, sections: { skills: true } } });
      assert.equal(await c.page.$eval(button("loadout-io-apply"), e => e.disabled), true);
      assert.equal(await c.page.evaluate(() => localStorage.getItem("sp.pref.loadout")), before);
      await c.page.keyboard.press("Escape");
      await paste({ kind: "stronghold.loadout", v: 2, byChar: {}, ops: {}, skins: { char_199_yak: 999 },
        extension: { v: 1, sections: { skins: true } } });
      assert.equal(await c.page.$eval(button("loadout-io-apply"), e => e.disabled), true);
      assert.equal(await c.page.evaluate(() => localStorage.getItem("sp.pref.loadout")), before);
      await c.page.keyboard.press("Escape");
      await paste({ kind: "stronghold.loadout", v: 2, byChar: { char_199_yak: { skill: 0 } },
        ops: { char_999999_missing: { potential: 6, cultivate: 3 } } });
      await c.click(button("loadout-io-apply")); await c.page.waitForSelector(".lo-transfer-dialog .lp-error");
      assert.equal(await c.page.evaluate(() => localStorage.getItem("sp.pref.loadout")), before);
      await c.page.keyboard.press("Escape");
      await paste({ kind: "stronghold.loadout", v: 2, byChar: { char_199_yak: { skill: 0 } }, ops: {} });
      assert.equal(await c.page.$eval("[data-import-part=potential]", e => e.disabled), false);
      await c.click(button("loadout-io-apply")); await c.page.waitForSelector(".lo-transfer-dialog", { hidden: true });
      assert.deepEqual(await c.page.evaluate(() => JSON.parse(localStorage.getItem("sp.pref.loadout")).ops), {});
      assert.deepEqual(c.problems, []);
    } finally { await c.close(); }
  });
  test("version filters and scoped file export/import use consistent classification", { timeout: 180000 }, async () => {
    const c = new Client(P, srv.base, "filter-transfer", { prefix: "loadout-filter-transfer", w: 1440, h: 900 });
    try {
      await c.open(); await c.enter("筛选导入回归"); await c.click(".lobby-screen [data-testid=loadout-open]");
      await c.page.waitForFunction(() => !document.querySelector("[data-testid=preset-save]")?.disabled);
      await c.click(button("loadout-filter"));
      await c.page.select(button("loadout-operator-mode"), "exclusive");
      await c.page.waitForFunction(() => document.querySelectorAll(".lo-op[data-chess]").length === 4);
      await c.page.screenshot({ path: path.join(OUT, "loadout-filter-versions-1440.png") });
      await c.click("[data-filter-version=act2autochess]");
      await c.page.waitForFunction(() => document.querySelectorAll(".lo-op[data-chess]").length === 0);
      await c.click("[data-filter-version=act1autochess]");
      assert.equal(await c.page.$$(".lo-op[data-chess]").then(x => x.length), 0);
      await c.page.select(button("loadout-operator-mode"), "all");
      await c.click(button("loadout-view-list"));
      await c.page.waitForSelector(".lo-list__rows select[data-cult=potential]");
      await c.page.select(".lo-list__rows select[data-cult=potential]", "1");
      const before = await c.page.evaluate(() => JSON.parse(localStorage.getItem("sp.pref.loadout")));
      await c.click(button("loadout-export"));
      await c.page.select(button("loadout-transfer-mode"), "exclusive");
      await c.page.waitForFunction(() => { try { return JSON.parse(document.querySelector("[data-testid=loadout-io-text]").value).v === 3; } catch { return false; } });
      const text = await c.page.$eval(button("loadout-io-text"), e => e.value);
      assert.equal(JSON.parse(text).extension.scope.charIds.length, 4);
      await c.page.screenshot({ path: path.join(OUT, "loadout-export-scope-1440.png") });
      await c.page.keyboard.press("Escape"); await c.click(button("loadout-import"));
      await c.page.$eval(button("loadout-io-text"), e => e.scrollIntoView({ block: "center" }));
      await c.click(button("loadout-io-text")); await c.page.keyboard.type(text);
      await c.page.waitForFunction(() => !document.querySelector("[data-import-part=skills]").disabled);
      await c.page.$eval(".lo-transfer-dialog .modal__body", e => { e.scrollTop = 0; });
      await c.page.screenshot({ path: path.join(OUT, "loadout-import-scope-1440.png") });
      await c.click(button("loadout-io-apply")); await c.page.waitForSelector(".lo-transfer-dialog", { hidden: true });
      const after = await c.page.evaluate(() => JSON.parse(localStorage.getItem("sp.pref.loadout")));
      assert.deepEqual(after.ops, before.ops, "off-scope settings stay intact through file roundtrip");
      await c.click(button("loadout-export"));
      const fullText = await c.page.$eval(button("loadout-io-text"), e => e.value);
      await c.page.select("select[aria-label='导出格式']", "upstream");
      assert.equal(await c.page.$eval(button("loadout-transfer-mode"), e => e.disabled), true);
      const compatible = JSON.parse(await c.page.$eval(button("loadout-io-text"), e => e.value));
      assert.equal(compatible.v, 2); assert.equal(compatible.extension, undefined);
      await c.page.keyboard.press("Escape");
      await c.page.select(".lo-list__rows select[data-cult=potential]", "2");
      await c.click(button("loadout-import"));
      await c.page.$eval(button("loadout-io-text"), e => e.scrollIntoView({ block: "center" }));
      await c.click(button("loadout-io-text")); await c.page.keyboard.type(fullText);
      await c.page.$eval("[data-import-part=potential]", e => e.scrollIntoView({ block: "center" }));
      await c.click("[data-import-part=potential]");
      await c.click(button("loadout-io-apply")); await c.page.waitForSelector(".lo-transfer-dialog", { hidden: true });
      assert.equal(await c.page.$eval(".lo-list__rows select[data-cult=potential]", e => e.value), "2", "unchecked potential remains unchanged");
      for (const [w, h] of [[844,390], [640,360]]) {
        await c.page.setViewport({ width:w, height:h });
        await c.page.select(button("loadout-operator-mode"), "exclusive");
        await c.page.screenshot({ path: path.join(OUT, `loadout-filter-versions-${w}.png`) });
        await c.page.select(button("loadout-operator-mode"), "all");
        await c.click(button("loadout-import"));
        await c.page.$eval(button("loadout-io-text"), e => e.scrollIntoView({ block: "center" }));
        await c.click(button("loadout-io-text")); await c.page.keyboard.type(text);
        await c.page.$eval(".lo-transfer-dialog .modal__body", e => { e.scrollTop = 0; });
        await c.page.screenshot({ path: path.join(OUT, `loadout-import-scope-${w}.png`) });
        await c.page.keyboard.press("Escape");
      }
      assert.deepEqual(c.problems, []);
    } finally { await c.close(); }
  });
  test("version scope, protected outside operators, entry animation and reduced motion", { timeout: 180000 }, async () => {
    const c = new Client(P, srv.base, "preset-scope", { prefix: "loadout-presets-scope", w: 1440, h: 900 });
    try {
      await c.open(); await c.enter("范围动画回归");
      await c.click(".lobby-screen [data-testid=loadout-open]");
      await c.page.waitForFunction(() => !document.querySelector("[data-testid=preset-save]")?.disabled);
      const animation = await c.page.$eval(".lp-toolbar", e => ({ name: getComputedStyle(e).animationName, delay: getComputedStyle(e).animationDelay }));
      assert.equal(animation.name, "lo-tr-right"); assert.equal(animation.delay, "0.25s");
      await c.click(button("preset-save")); await input(c, "第二期独有方案");
      await c.click("[data-preset-scope=exclusive]");
      await c.page.waitForFunction(() => !document.querySelector("[data-preset-roster-version]")?.disabled);
      await c.page.$eval(".lp-dialog .modal__body", e => { e.scrollTop = 0; }); await settle(c);
      await c.page.screenshot({ path: path.join(OUT, "loadout-presets-scope-1440.png") });
      await c.click(button("preset-save-confirm")); await c.page.waitForSelector(".lp-dialog", { hidden: true });
      const exclusive = (await library(c)).items[0];
      assert.equal(exclusive.snapshot.scope.mode, "exclusive"); assert.equal(exclusive.snapshot.scope.charIds.length, 4);
      await c.click(button("loadout-filter")); await c.click(button("loadout-view-list"));
      await c.page.waitForSelector(".lo-list__rows select[data-cult=potential]");
      await c.page.select(".lo-list__rows select[data-cult=potential]", "1");
      const before = await c.page.evaluate(() => localStorage.getItem("sp.pref.loadout"));
      await c.click(button("preset-selector")); await c.click(`[data-preset-id="${exclusive.id}"]`);
      assert.equal(await c.page.$(button("preset-guard-save")), null, "outside roster changes do not mark preset dirty");
      await c.click(button("preset-apply-confirm")); await c.page.waitForSelector(".lp-dialog", { hidden: true });
      assert.equal(await c.page.evaluate(() => localStorage.getItem("sp.pref.loadout")), before, "outside roster settings kept");
      await c.click(button("preset-selector")); await c.click(button("preset-save-as")); await input(c, "第二期全部方案");
      await c.click("[data-preset-scope=roster]");
      await c.click(button("preset-save-confirm")); await c.page.waitForSelector(".lp-dialog", { hidden: true });
      assert.equal((await library(c)).items.find(p => p.name === "第二期全部方案").snapshot.scope.charIds.length, 112);
      await c.click(button("preset-selector")); await c.click(button("preset-save-as")); await input(c, "第一期独有空范围");
      await c.click("[data-preset-scope=exclusive]"); await c.click("[data-preset-roster-version=act2autochess]"); await c.click("[data-preset-roster-version=act1autochess]");
      await c.click(button("preset-save-confirm")); await c.page.waitForSelector(".lp-error");
      assert.equal((await library(c)).items.length, 2); await c.page.keyboard.press("Escape");
      await c.click("[data-testid=loadout-view-deck]");
      await c.page.setViewport({ width: 640, height: 360 }); await c.page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
      assert.equal(await c.page.$eval(".lp-toolbar", e => getComputedStyle(e).animationName), "none");
      await c.page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
      assert.equal(await c.page.$eval(".lp-toolbar", e => getComputedStyle(e).animationName), "lo-tr-right");
      await c.click(button("preset-selector")); await c.click(button("preset-save-as")); await c.click("[data-preset-scope=roster]");
      await settle(c); await c.page.$eval(".lp-dialog .modal__body", e => { e.scrollTop = 0; });
      await c.page.screenshot({ path: path.join(OUT, "loadout-presets-scope-640.png") });
      await c.page.keyboard.press("Escape");
      assert.deepEqual(c.problems, []);
    } finally { await c.close(); }
  });
  test("save, switch guard, cross-view controls, rename, delete, reload and all viewport geometry", { timeout: 180000 }, async () => {
    const c = new Client(P, srv.base, "presets", { prefix: "loadout-presets", w: 1440, h: 900 });
    try {
      await c.open(); await c.enter("预设回归");
      await c.click(".lobby-screen [data-testid=loadout-open]");
      await c.page.waitForFunction(() => !document.querySelector("[data-testid=preset-save]")?.disabled);
      // Save default settings with an explicit empty roster for the current version.
      await c.click(button("preset-save")); await input(c, "日常配置");
      await c.click(button("preset-include-diy"));
      await c.page.waitForSelector("[data-preset-version]");
      assert.equal(await c.page.$eval(".lp-versions", e => e.textContent.includes("空编队")), true);
      await c.click(button("preset-save-confirm"));
      await c.page.waitForSelector(".lp-dialog", { hidden: true });
      const first = (await library(c)).items[0];
      assert.equal(first.name, "日常配置");
      assert.equal(Object.keys(first.snapshot.diy).length, 1);
      assert.equal(await c.page.$eval(button("preset-save"), e => e.disabled), true);
      await create(c, "低练度挑战");
      const second = (await library(c)).items.find(p => p.name === "低练度挑战");
      // Use the normal list controls to modify a real operator.
      await c.click(button("loadout-filter")); await c.click(button("loadout-view-list"));
      await c.page.waitForSelector(".lo-list__rows select[data-cult=potential]");
      await c.page.select(".lo-list__rows select[data-cult=potential]", "1");
      await c.page.waitForFunction(() => document.querySelector("[data-testid=preset-selector]").textContent.includes("已修改"));
      await c.click(button("preset-selector")); await c.click(`[data-preset-id="${first.id}"]`);
      await c.page.waitForSelector(button("preset-guard-save"));
      await c.page.keyboard.press("Escape");
      assert.equal((await library(c)).activeId, second.id, "cancel leaves active preset");
      await c.click(button("preset-selector")); await c.click(`[data-preset-id="${first.id}"]`);
      await c.click(button("preset-guard-save"));
      await c.click(button("preset-apply-confirm"));
      await c.page.waitForSelector(".lp-dialog", { hidden: true });
      assert.equal((await library(c)).activeId, first.id);
      assert.ok(Object.values((await library(c)).items.find(p => p.id === second.id).snapshot.loadout.ops).some(e => e.potential === 1));
      // Reopen retains association; no automatic preset write while browsing.
      await c.page.reload({ waitUntil: "networkidle0" });
      await c.page.waitForSelector(".lobby-screen");
      await c.click(".lobby-screen [data-testid=loadout-open]");
      await c.page.waitForFunction(() => document.querySelector("[data-testid=preset-selector]")?.textContent.includes("日常配置"));
      await c.click(button("preset-selector")); await c.click(button("preset-manage"));
      await c.click(button("preset-rename")); await input(c, "日常配置改名");
      await c.click(button("preset-rename-confirm"));
      assert.equal((await library(c)).items.find(p => p.id === first.id).name, "日常配置改名");
      await c.click(button("preset-delete")); await c.click(button("preset-delete-confirm"));
      assert.equal((await library(c)).activeId, null);
      await c.page.keyboard.press("Escape");
      // Return to the card view to verify the more crowded desktop header as well.
      await c.click("[data-testid=loadout-view-deck]");
      // Desktop and mobile snapshots cover save and management dialogs with long names.
      for (const [w, h] of [[1440,900], [1280,720], [844,390], [640,360]]) {
        await c.page.setViewport({ width: w, height: h });
        if (w <= 844) await c.page.evaluate(() => { document.documentElement.dataset.text = "xl"; });
        await c.click(button("preset-selector")); await c.click(button("preset-save-as"));
        await input(c, "低练度挑战与跨版本编队方案名称测试");
        await c.page.$eval(button("preset-include-diy"), e => e.scrollIntoView({ block: "center" }));
        await c.click(button("preset-include-diy"));
        await settle(c);
        await c.page.$eval(".lp-dialog .modal__body", e => { e.scrollTop = 0; });
        await c.page.screenshot({ path: path.join(OUT, `loadout-presets-save-${w}.png`) });
        const geometry = await c.page.evaluate(() => {
          const boxes = [...document.querySelectorAll(".lp-dialog .modal__actions .btn, .lp-toolbar")].map(e => e.getBoundingClientRect());
          return boxes.every(r => r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1);
        });
        assert.equal(geometry, true, `${w}: controls remain within viewport`);
        await c.page.keyboard.press("Escape");
        await c.click(button("preset-selector")); await c.click(button("preset-manage"));
        await settle(c);
        await c.page.screenshot({ path: path.join(OUT, `loadout-presets-manage-${w}.png`) });
        const problems = await c.page.evaluate(textProblems, ".lp-dialog");
        assert.deepEqual(problems, [], `${w}: dialog text fits`);
        await c.page.keyboard.press("Escape");
      }
      await c.page.evaluate(() => { document.documentElement.dataset.text = "sm"; });
      await c.page.setViewport({ width: 1440, height: 900 });
      // Long list remains usable, and keyboard navigation changes focus only.
      for (let n = (await library(c)).items.length; n < 20; n++) await create(c, "预设方案" + n);
      const full = await library(c);
      await c.click(button("preset-selector")); await settle(c);
      assert.equal(await c.page.$eval(button("preset-save-as"), e => e.disabled), true);
      await c.page.focus(".lp-choice");
      await c.page.keyboard.press("ArrowDown");
      assert.equal((await library(c)).activeId, full.activeId);
      await c.page.keyboard.press("End");
      assert.deepEqual(await c.page.evaluate(textProblems, ".lp-dialog"), [], "20 presets keep readable, nonoverlapping rows");
      await c.page.screenshot({ path: path.join(OUT, "loadout-presets-20.png") });
      await c.page.keyboard.press("Escape");
      assert.deepEqual(c.problems, [], "no page, network or console errors");
    } finally { await c.close(); }
  });
});
