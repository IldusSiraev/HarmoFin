// Usage: node optimize.mjs <path-to-existing-sharp-package>
// No package is added to the product. Original PNGs remain unchanged.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const sharp = require(process.argv[2] ?? 'sharp');
for (const name of ['everyday-and-goals-v2', 'shared-goals-v2']) {
  for (const width of [640, 960]) {
    const output = fileURLToPath(new URL(`../../apps/web/public/illustrations/${name}-${width}.webp`, import.meta.url));
    await sharp(fileURLToPath(new URL(`./${name}.png`, import.meta.url))).resize({ width }).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(output);
    console.log(name, width, (await stat(output)).size);
  }
}
