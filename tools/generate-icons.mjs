import fs from 'node:fs/promises';
import path from 'node:path';

import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const svg = await fs.readFile(path.join(root, 'assets/icon.svg'));
const pngDir = path.join(root, 'assets/generated/icons/png');
const icoPath = path.join(root, 'assets/generated/icons/win/icon.ico');

await fs.mkdir(pngDir, { recursive: true });
await fs.mkdir(path.dirname(icoPath), { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const files = [];
for (const size of sizes) {
  const out = path.join(pngDir, `${size}x${size}.png`);
  await sharp(svg).resize(size, size).png().toFile(out);
  files.push(out);
}

await sharp(svg).resize(512, 512).png().toFile(path.join(root, 'assets/icon.png'));

const ico = await pngToIco(
  files.filter(
    (file) => !file.includes('512x512') && !file.includes('1024x1024'),
  ),
);
await fs.writeFile(icoPath, ico);
console.log(`Generated ${sizes.length} PNG sizes and icon.ico`);
