#!/usr/bin/env node
/**
 * Publish the packaged Windows build to the `desktop-latest` GitHub prerelease.
 *
 * Usage:
 *   pnpm release:desktop             # validate, create/update the release, upload, verify
 *   pnpm release:desktop -- --dry-run  # validate + print the plan, make no writes
 *
 * Prereqs: `pnpm dist:win` has produced the pack/ artifacts and `gh auth login` is done.
 * The repo + tag are read from electron-builder.yml's publish.url so the upload target
 * always matches the in-app update feed (no drift between code and release).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const GH = process.env.GH_BIN ?? 'gh';

const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

const version = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
).version;

const builderYml = fs.readFileSync(
  path.join(ROOT, 'electron-builder.yml'),
  'utf8',
);
const feed = builderYml.match(
  /url:\s*https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/releases\/download\/([^\s]+)/,
);
if (!feed) {
  fail(
    'No publish.url of the form https://github.com/<owner>/<repo>/releases/download/<tag> found in electron-builder.yml',
  );
}
const [, repo, tag] = feed;

const artifacts = {
  exe: path.join(ROOT, 'pack', 'MusicApp-Desktop.exe'),
  yml: path.join(ROOT, 'pack', 'latest.yml'),
  blockmap: path.join(ROOT, 'pack', 'MusicApp-Desktop.exe.blockmap'),
};
for (const [name, p] of Object.entries(artifacts)) {
  if (!fs.existsSync(p)) fail(`Missing ${name}: ${p}\nRun \`pnpm dist:win\` first.`);
}
const exeSize = fs.statSync(artifacts.exe).size;

const ymlVersion = (
  fs.readFileSync(artifacts.yml, 'utf8').match(/^version:\s*(\S+)/m) ?? []
)[1];
if (ymlVersion !== version) {
  fail(
    `latest.yml version (${ymlVersion}) != package.json version (${version}).\nBump done? Rebuild with \`pnpm dist:win\` so latest.yml matches before publishing.`,
  );
}

console.log(`MusicApp Desktop v${version}`);
console.log(`  repo:   ${repo}`);
console.log(`  tag:    ${tag} (prerelease)`);
console.log(`  assets: MusicApp-Desktop.exe (${exeSize} B), latest.yml, .blockmap`);

if (DRY_RUN) {
  console.log('\nDry run — no changes made.');
  process.exit(0);
}

try {
  execFileSync(GH, ['auth', 'status'], { stdio: 'ignore' });
} catch {
  fail('gh is not authenticated. Run: gh auth login');
}

const gh = (args, opts = {}) =>
  execFileSync(GH, args, { cwd: ROOT, encoding: 'utf8', ...opts });

let releaseExists = true;
try {
  gh(['release', 'view', tag, '--repo', repo]);
} catch {
  releaseExists = false;
}

if (!releaseExists) {
  console.log(`\nCreating prerelease ${tag}...`);
  gh(
    [
      'release',
      'create',
      tag,
      '--repo',
      repo,
      '--prerelease',
      '--title',
      `MusicApp Desktop — latest build (v${version})`,
      '--notes',
      `Windows x64 installer for MusicApp Desktop.\n\nDownload **MusicApp-Desktop.exe** below and run it.\n\nv${version}. The app auto-checks this release for newer builds on launch. Windows may show a SmartScreen warning (unsigned build).`,
    ],
    { stdio: 'inherit' },
  );
}

console.log('\nUploading assets (clobber)...');
gh(
  [
    'release',
    'upload',
    tag,
    '--repo',
    repo,
    '--clobber',
    artifacts.exe,
    artifacts.yml,
    artifacts.blockmap,
  ],
  { stdio: 'inherit' },
);

// Keep the rolling tag on the released commit so the repo's Tags view and
// "Source code" archive match the build we just published.
try {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  gh([
    'api',
    '-X',
    'PATCH',
    `repos/${repo}/git/refs/tags/${tag}`,
    '-f',
    `sha=${head}`,
    '-F',
    'force=true',
  ]);
  console.log(`\nTag ${tag} → ${head.slice(0, 7)}`);
} catch (err) {
  console.warn(
    `\n⚠ Could not move tag ${tag} (non-fatal):`,
    err instanceof Error ? err.message : err,
  );
}

const base = `https://github.com/${repo}/releases/download/${tag}`;
const head = async (url) => {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  return {
    ok: res.ok,
    status: res.status,
    length: Number(res.headers.get('content-length') ?? -1),
  };
};

console.log('\nVerifying feed...');
const [ymlRes, exeRes] = await Promise.all([
  head(`${base}/latest.yml`),
  head(`${base}/MusicApp-Desktop.exe`),
]);
if (!ymlRes.ok) fail(`Feed latest.yml unreachable (HTTP ${ymlRes.status})`);
if (!exeRes.ok) fail(`Feed exe unreachable (HTTP ${exeRes.status})`);
if (exeRes.length >= 0 && exeRes.length !== exeSize) {
  console.warn(
    `⚠ remote exe size ${exeRes.length} != local ${exeSize} (GitHub CDN may lag; re-check shortly)`,
  );
}

console.log(`\n✔ Published v${version} → ${base.replace('/download/', '/tag/')}`);
