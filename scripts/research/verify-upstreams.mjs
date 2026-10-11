import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const lock = JSON.parse(readFileSync(resolve(root, 'research/upstream-lock.json'), 'utf8'));
const modules = readFileSync(resolve(root, '.gitmodules'), 'utf8');
if (lock.schemaVersion !== 1 || lock.repositories.length !== 8) throw new Error('invalid_upstream_lock');
if ((modules.match(/^\[submodule /gm) ?? []).length !== 8) throw new Error('unexpected_submodules');
const allLinks = spawnSync('git', ['ls-files', '--stage', '--', 'research/upstream'], { cwd: root, encoding: 'utf8' });
if (allLinks.status !== 0 || allLinks.stdout.split('\n').filter(line => line.startsWith('160000 ')).length !== 8) throw new Error('unexpected_upstream_gitlinks');
const cataloguePath = resolve(root, 'research/upstream/catalogue.lock.json');
if (existsSync(cataloguePath)) {
  const catalogue = JSON.parse(readFileSync(cataloguePath, 'utf8'));
  if (catalogue.schema_version !== 1 || catalogue.items.length !== 8) throw new Error('invalid_research_catalogue');
  const catalogueIds = new Set();
  for (const item of catalogue.items) {
    const current = lock.repositories.find(entry => entry.id === item.id);
    if (!current || catalogueIds.has(item.id) || item.repository !== current.repository ||
        item.submodule_path !== current.path || item.revision !== current.commit ||
        item.https_url !== current.url.slice(0, -4) || item.linked_to_production !== false) throw new Error('research_catalogue_mismatch');
    catalogueIds.add(item.id);
  }
}
const checkedOut = process.argv.includes('--checkouts');
const seen = new Set();
for (const entry of lock.repositories) {
  if (!/^[a-z0-9-]+$/.test(entry.id) || entry.path !== 'research/upstream/' + entry.id ||
      !/^[a-f0-9]{40}$/.test(entry.commit) || entry.url !== 'https://github.com/' + entry.repository + '.git' ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(entry.repository) || seen.has(entry.id)) throw new Error('invalid_upstream_entry');
  seen.add(entry.id);
  const block = `[submodule "${entry.id}"]\n\tpath = ${entry.path}\n\turl = ${entry.url}`;
  if (!modules.includes(block)) throw new Error('gitmodules_mismatch_' + entry.id);
  const indexed = spawnSync('git', ['ls-files', '--stage', '--', entry.path], { cwd: root, encoding: 'utf8' });
  if (indexed.status !== 0 || !indexed.stdout.startsWith(`160000 ${entry.commit} 0\t${entry.path}`)) throw new Error('gitlink_mismatch_' + entry.id);
  if (checkedOut) {
    if (!existsSync(resolve(root, entry.path, '.git'))) throw new Error('checkout_missing_' + entry.id);
    const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(root, entry.path), encoding: 'utf8' });
    if (result.status !== 0 || result.stdout.trim() !== entry.commit) throw new Error('checkout_mismatch_' + entry.id);
  }
}
console.log(JSON.stringify({ repositories: seen.size, gitlinksVerified: true, checkoutsVerified: checkedOut, adoption: 'research-only' }));
