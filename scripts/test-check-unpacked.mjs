import {strict as assert} from 'node:assert';
import {mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {checkUnpacked} from './check-unpacked.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'papago-unpacked-'));
  const manifest = {manifest_version: 3, name: 'Synthetic extension', version: '1.0.0', background: {service_worker: 'worker.js'}, side_panel: {default_path: 'panel.html'}, content_scripts: [{js: ['content.js', 'content.js'], css: ['style.css']}]};
  const save = value => writeFileSync(join(root, 'manifest.json'), JSON.stringify(value));
  save(manifest);
  for (const name of ['worker.js', 'panel.html', 'content.js', 'style.css']) writeFileSync(join(root, name), 'synthetic');
  try { run({root, manifest, save}); }
  finally { assert(resolve(root).startsWith(resolve(tmpdir()) + sep + 'papago-unpacked-')); rmSync(root, {recursive: true, force: true}); }
}

test('checks declared files once, accepts UTF-8 BOM and preserves file bytes', () => fixture(({root, manifest}) => {
  writeFileSync(join(root, 'manifest.json'), '\uFEFF' + JSON.stringify(manifest));
  const before = readFileSync(join(root, 'manifest.json'));
  assert.deepEqual(checkUnpacked(root), {name: manifest.name, version: manifest.version, checkedFiles: 4});
  assert.deepEqual(readFileSync(join(root, 'manifest.json')), before);
  assert.equal(readFileSync(join(root, 'worker.js'), 'utf8'), 'synthetic');
}));

test('missing manifests, declared files and directories used as files fail', () => fixture(({root}) => {
  assert.throws(() => checkUnpacked(join(root, 'wrong folder')), /manifest.json not found/);
  rmSync(join(root, 'worker.js'));
  assert.throws(() => checkUnpacked(root), /Missing declared file: worker.js/);
  mkdirSync(join(root, 'worker.js'));
  assert.throws(() => checkUnpacked(root), /Missing declared file/);
}));

test('rejects malformed manifests and absolute or escaping declared paths', () => fixture(({root, manifest, save}) => {
  for (const path of ['../outside.js', '/outside.js', 'C:\\outside.js', '', 42]) {
    save({...manifest, background: {service_worker: path}});
    assert.throws(() => checkUnpacked(root), /relative declared|leaves the extension/);
  }
  for (const value of [null, {...manifest, manifest_version: 2}, {...manifest, name: ''}, {...manifest, content_scripts: {}}, {...manifest, content_scripts: [{js: 'content.js'}]}]) {
    save(value); assert.throws(() => checkUnpacked(root));
  }
  writeFileSync(join(root, 'manifest.json'), '{invalid'); assert.throws(() => checkUnpacked(root), SyntaxError);
}));

test('CLI supports spaces, help and nonzero failure without a success result', () => fixture(({root}) => {
  const script = fileURLToPath(new URL('./check-unpacked.mjs', import.meta.url));
  const folder = join(root, 'directory with spaces'); mkdirSync(folder);
  writeFileSync(join(folder, 'manifest.json'), JSON.stringify({manifest_version: 3, name: 'Empty shell', version: '1.0.0'}));
  const invoke = args => spawnSync(process.execPath, [script, ...args], {encoding: 'utf8'});
  const good = invoke([folder]); assert.equal(good.status, 0, good.stderr); assert.equal(JSON.parse(good.stdout).checkedFiles, 0);
  for (const args of [[], [join(root, 'absent')], [root, root]]) { const bad = invoke(args); assert.equal(bad.status, 1); assert.equal(bad.stdout, ''); }
  for (const flag of ['--help', '-h']) { const help = invoke([flag]); assert.equal(help.status, 0); assert.match(help.stdout, /DIRECTORY/); }
}));

test('current public extension directories pass declared-file inspection', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  assert(checkUnpacked(root).checkedFiles > 0);
  assert(checkUnpacked(join(root, 'pairwise')).checkedFiles > 0);
});
