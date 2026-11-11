import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

process.env.NODE_ENV = 'test';

const appPath = path.resolve(import.meta.dirname, '..');

const launch = async (userData) =>
  await electron.launch({
    cwd: appPath,
    env: { ...process.env, MUSICAPP_USER_DATA: userData },
    args: [
      appPath,
      '--no-sandbox',
      '--disable-gpu',
      '--whitelisted-ips=',
      '--disable-dev-shm-usage',
    ],
  });

const accent = (window) =>
  window.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue('--tm-accent')
      .trim(),
  );

test('Phosphor preset injects the green accent', async () => {
  const userData = await fs.mkdtemp(
    path.join(os.tmpdir(), 'musicapp-phosphor-'),
  );
  await fs.writeFile(
    path.join(userData, 'config.json'),
    JSON.stringify({ appearance: { preset: 'phosphor' } }),
  );

  const app = await launch(userData);
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  // getComputedStyle canonicalizes #33ff33 to its shorthand form.
  await expect.poll(() => accent(window), { timeout: 20_000 }).toBe('#3f3');

  await app.close();
});

test('Default preset injects no Phosphor variables', async () => {
  const userData = await fs.mkdtemp(
    path.join(os.tmpdir(), 'musicapp-default-'),
  );

  const app = await launch(userData);
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await expect.poll(() => accent(window)).toBe('');

  await app.close();
});
