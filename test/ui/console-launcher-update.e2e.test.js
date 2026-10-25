import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAdmin } from '../../server/admin.js';
import { updatePaths } from '../../server/release-update.js';
import { ROOT, CHROME, hasChrome } from '../e2e/client.mjs';
import { releaseFor, tag, put } from '../helpers/release-fixture.js';
import { APP_VERSION } from '../../shared/constants.js';

test('console displays signed companion launcher and pending/completed state on desktop and phone', {
  skip: process.platform !== 'win32' || process.env.SP_E2E !== '1' || !hasChrome(), timeout: 45000,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-launcher-console-'));
  put(root, 'package.json', JSON.stringify({ version: APP_VERSION }));
  const backup = path.join(root, 'logs/update-backups/release-test');
  put(root, 'logs/release-update-status.json', JSON.stringify({ state:'installed',tag,backup,
    launcher:{state:'pending',asset:'StrongholdProtocolLauncher-v1.2.0-win-x64.zip'},warning:'关闭启动器后自动替换' }));
  const release = releaseFor();
  const base = release.assets[0].browser_download_url.replace(/[^/]+$/, '');
  release.assets.push({name:'StrongholdProtocolLauncher-v1.2.0-win-x64.zip',size:1000,browser_download_url:base+'StrongholdProtocolLauncher-v1.2.0-win-x64.zip'},
    {name:'SHA256SUMS.txt',browser_download_url:base+'SHA256SUMS.txt'}, {name:'SHA256SUMS.txt.sig',browser_download_url:base+'SHA256SUMS.txt.sig'});
  let admin,browser;
  try {
    admin = await startAdmin({root,port:0,settingsFile:path.join(root,'settings.json'),resultsDir:root,onUpdateReady(){},
      lobby:{rooms:new Map(),safeData:()=>({}),onMatchEnd(){},staticOptions:{publicDir:path.join(ROOT,'public'),sharedDir:path.join(ROOT,'shared')}},
      updateOptions:{fetchImpl:async()=>new Response(JSON.stringify([release]))},log:{info(){},warn(){},error(){}}});
    browser=await(await import('puppeteer-core')).default.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--mute-audio']});
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewport({width:1440,height:900});await page.goto(admin.url,{waitUntil:'domcontentloaded'});
    if(await page.$('dialog.release-notes[open]'))await page.click('dialog.release-notes .release-notes__button--primary');
    await page.click('[data-tab="settings"]');
    try { await page.waitForSelector('#launcher-update-state', {timeout:10000}); }
    catch(error) { throw new Error(JSON.stringify({errors,text:await page.$eval('body',el=>el.innerText),status:await(await fetch(admin.url+'/api/update',{headers:{'x-admin-token':admin.token}})).json()}),{cause:error}); }
    assert.match(await page.$eval('#launcher-update-state',el=>el.textContent),/等待关闭启动器/);
    for(const [name,width,height] of [['desktop',1440,900],['phone',390,844]]){
      await page.setViewport({width,height});
      await page.$eval('#release-update',el=>el.scrollIntoView());
      assert.ok(await page.$eval('#release-update',el=>el.scrollWidth<=el.clientWidth),name);
    }
    const response = await fetch(admin.url+'/api/update',{headers:{'x-admin-token':admin.token}});const status=await response.json();
    assert.equal(status.launcher.state,'pending');
    fs.writeFileSync(updatePaths(root).status,JSON.stringify({state:'installed',tag,backup,launcher:{state:'installed',asset:release.assets[1].name}}));
    await page.reload({waitUntil:'domcontentloaded'});await page.click('[data-tab="settings"]');
    await page.waitForFunction(()=>document.querySelector('#launcher-update-state')?.textContent.includes('已更新'));
    await page.waitForSelector('[data-update-check]:not([disabled])');
    for (let attempt=0;attempt<3;attempt++) {
      try { await page.click('[data-update-check]'); break; }
      catch(error) { if(!String(error.message).includes('detached') || attempt===2)throw error; }
    }
    await page.waitForSelector('[data-testid="launcher-update-plan"]');
    assert.match(await page.$eval('[data-testid="launcher-update-plan"]',el=>el.textContent),/同一发布签名|发布签名验签/);
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();await admin?.close();fs.rmSync(root,{recursive:true,force:true});}
});
