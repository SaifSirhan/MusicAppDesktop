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

const seed = async (prefix, config) => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  if (config) {
    await fs.writeFile(
      path.join(userData, 'config.json'),
      JSON.stringify(config),
    );
  }
  return userData;
};

test('Docker preset is the default and injects the blue accent', async () => {
  const userData = await seed('musicapp-docker-');

  const app = await launch(userData);
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await expect.poll(() => accent(window), { timeout: 20_000 }).toBe('#1d63ed');

  await app.close();
});

test('Phosphor preset injects the green accent', async () => {
  const userData = await seed('musicapp-phosphor-', {
    appearance: { preset: 'phosphor' },
  });

  const app = await launch(userData);
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  // getComputedStyle canonicalizes #33ff33 to its shorthand form.
  await expect.poll(() => accent(window), { timeout: 20_000 }).toBe('#3f3');

  await app.close();
});

test('Explicit default preset injects no accent variables', async () => {
  const userData = await seed('musicapp-default-', {
    appearance: { preset: 'default' },
  });

  const app = await launch(userData);
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await expect.poll(() => accent(window)).toBe('');

  await app.close();
});
