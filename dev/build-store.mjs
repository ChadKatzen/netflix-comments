// Builds dist/stream-comments-<version>.zip for the Chrome Web Store: copies extension/, removes dev-only
// entries (localhost matches, broad optional host permissions), and zips it.
import { cpSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'extension'), out = join(root, 'dist', 'extension');
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
cpSync(src, out, { recursive: true, filter: (p) => !/\.DS_Store$/.test(p) });
const m = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
m.content_scripts[0].matches = m.content_scripts[0].matches.filter((x) => !/localhost|127\.0\.0\.1/.test(x));
m.host_permissions = m.host_permissions.filter((x) => !/localhost|127\.0\.0\.1/.test(x));
delete m.optional_host_permissions; // the store flags broad optional hosts; self-hosters can edit the manifest
writeFileSync(join(out, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
const zip = join(root, 'dist', `community-swim-${m.version}.zip`);
rmSync(zip, { force: true });
execSync(`cd "${out}" && zip -qr "${zip}" . -x ".*"`);
console.log('built', zip);
console.log('matches:', m.content_scripts[0].matches.join(' '), '| host_permissions:', m.host_permissions.join(' '));
