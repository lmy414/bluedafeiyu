import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(frontend, 'node_modules/opencc-js');
const vendor = path.join(frontend, 'public/vendor/opencc');
fs.mkdirSync(vendor, { recursive: true });
fs.copyFileSync(path.join(source, 'dist/umd/cn2t.js'), path.join(vendor, 'cn2t-1.4.2.js'));
for (const file of ['LICENSE', 'THIRD_PARTY_LICENSES.md', 'LICENSES/Apache-2.0.txt']) {
  const target = path.join(vendor, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(source, file), target);
}
// Keep the ZIP library and its license on the same origin as the website.
const zipVendor = path.join(frontend, 'public/vendor/fflate');
fs.mkdirSync(zipVendor, { recursive: true });
fs.copyFileSync(path.join(frontend, 'node_modules/fflate/esm/browser.js'), path.join(zipVendor, 'fflate-0.8.2.js'));
fs.copyFileSync(path.join(frontend, 'node_modules/fflate/LICENSE'), path.join(zipVendor, 'LICENSE'));
