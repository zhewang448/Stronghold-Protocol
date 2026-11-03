import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('avatar crop previews the saved square, supports drag/zoom and preserves the avatar on cancel', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async t => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-avatar-crop-'));
  t.after(async () => { await browser.close(); await server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  fs.mkdirSync('test/e2e/out', { recursive: true });
  for (const [width, height] of [[1280, 800], [390, 844]]) {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width, height });
    await page.goto(server.url + '/dev/game-mock.html?phase=PREP&render=fallback&shot=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!globalThis.__SP_VIEW__);
    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 300;
      const context = canvas.getContext('2d');
      for (const [index, color] of ['#ff0000', '#00ff00', '#0000ff'].entries()) { context.fillStyle = color; context.fillRect(index * 300, 0, 300, 300); }
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const file = path.join(dir, 'stripes.png'); fs.writeFileSync(file, Buffer.from(image, 'base64'));
    await page.evaluate(async () => { const { openAccountPanel } = await import('/js/ui/accounts.js'); openAccountPanel(); });
    const choose = async () => {
      const chooser = page.waitForFileChooser();
      await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.includes('更换头像')).click());
      await (await chooser).accept([file]);
      await page.waitForSelector('[data-testid="avatar-crop"]');
    };
    await choose();
    const box = await (await page.$('[data-testid="avatar-crop"]')).boundingBox();
    assert.ok(Math.abs(box.width - box.height) < 1);
    assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= height);
    await page.$eval('[data-testid="avatar-crop-zoom"]', element => { element.value = '2'; element.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction(() => document.querySelector('.lacct-crop__image').style.width === '600%');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width * 3, box.y + box.height / 2, { steps: 12 }); await page.mouse.up();
    await page.screenshot({ path: `test/e2e/out/avatar-crop-${width}.png` });
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.includes('使用头像')).click());
    await page.waitForSelector('.lacct__pic img');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.localAccount')).avatar);
    const pixel = await page.evaluate(async src => {
      const image = new Image(); image.src = src; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, pixel: [...context.getImageData(64, 64, 1, 1).data] };
    }, saved);
    assert.deepEqual([pixel.width, pixel.height], [128, 128]);
    assert.ok(pixel.pixel[0] > 230 && pixel.pixel[1] < 25 && pixel.pixel[2] < 25, JSON.stringify(pixel));
    await choose();
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.localAccount')).avatar), saved);
    assert.deepEqual(errors, []);
    await page.close();
  }
});
