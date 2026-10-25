// i18n-ignore-file: extracts the Chinese player-facing release notes shipped with the installation.
import fs from 'node:fs';
import path from 'node:path';
import { RELEASE_TAG } from './release-version.js';
import { APP_VERSION } from '../shared/constants.js';

export function parseReleaseNotes(markdown, version = RELEASE_TAG) {
  const sections = markdown.split(/^## /m).slice(1);
  const section = sections.find((s) => s.split('\n')[0].includes(`${version}：`));
  if (!section) return { version, title: version, entries: [] };
  const [title, ...lines] = section.split(/\r?\n/);
  const entries = lines.filter((s) => s.startsWith('- '))
    .filter((s) => !/^- (?:.*验证[：：]|golden 与工具链[：：]|渲染限制[：：]|已知渲染限制[：：])/.test(s))
    .map((s) => s.slice(2).replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'));
  return { version, title: title.trim(), entries };
}

export function readReleaseNotes(root) {
  try { return parseReleaseNotes(fs.readFileSync(path.join(root, 'docs', 'LOCAL-CHANGELOG.md'), 'utf8')); }
  catch { return { version: RELEASE_TAG, title: RELEASE_TAG, entries: [] }; }
}

/** Read the upstream version's own section; extension versions have a separate baseline. */
export function parseUpstreamReleaseNotes(markdown, version = APP_VERSION) {
  const sections = markdown.split(/^## /m).slice(1);
  const section = sections.find((s) => s.split(/\r?\n/, 1)[0].split(/\s/, 1)[0].replace(/^v/, '') === version);
  if (!section) return { version, title: version, entries: [] };
  const [title, ...lines] = section.split(/\r?\n/);
  const entries = lines.filter((s) => s.startsWith('- ')).map((s) => s.slice(2)
    .replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'));
  return { version, title: title.trim(), entries };
}

export function readUpstreamReleaseNotes(root) {
  try { return parseUpstreamReleaseNotes(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')); }
  catch { return { version: APP_VERSION, title: APP_VERSION, entries: [] }; }
}
