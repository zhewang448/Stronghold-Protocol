#!/usr/bin/env node
// Direct Node entry; Windows double-click uses start-windows.bat for Node/dependency bootstrap.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch } from './launch.mjs';

try {
  if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
    process.exitCode = await launch(['--tunnel', ...process.argv.slice(2)]);
  }
} catch (error) { console.error(error?.stack || error); process.exitCode = 1; }
