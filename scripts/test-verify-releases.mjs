import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';

const digest = value => createHash('sha256').update(value).digest('hex');

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'papago-release-check-'));
  try {
    for (const name of ['scripts', 'dist', 'pairwise', 'demo']) mkdirSync(join(root, name));
    copyFileSync(new URL('./verify-releases.mjs', import.meta.url), join(root, 'scripts', 'verify-releases.mjs'));
    const entries = [];
    for (const [module, version, folder] of [['absolute', '0.28.1', ''], ['pairwise', '1.1.0', 'pairwise'], ['demo', '1.0.0', 'demo']]) {
      const source = 'synthetic current ' + module;
      const filename = module + '-current.zip';
      const bytes = 'synthetic package bytes ' + module;
      writeFileSync(join(root, folder, 'manifest.json'), source);
      writeFileSync(join(root, 'dist', filename), bytes);
      entries.push({module, version, filename, sha256: digest(bytes), source_files_sha256: {'manifest.json': digest(source)}});
    }
    const oldBytes = 'synthetic archived package bytes';
    writeFileSync(join(root, 'dist', 'pairwise-old.zip'), oldBytes);
    // Historical source differs from current source, while its ZIP stays immutable.
    entries.push({module: 'pairwise', version: '1.0.2', filename: 'pairwise-old.zip', sha256: digest(oldBytes), source_files_sha256: {'manifest.json': digest('synthetic older source')}});
    writeFileSync(join(root, 'dist', 'releases.json'), JSON.stringify(entries));
    const verify = () => {
      const result = spawnSync(process.execPath, [join(root, 'scripts', 'verify-releases.mjs')], {encoding: 'utf8'});
      if (result.error) throw result.error;
      return result;
    };
    run({root, verify});
  } finally {
    assert(resolve(root).startsWith(resolve(tmpdir()) + sep + 'papago-release-check-'));
    rmSync(root, {recursive: true, force: true});
  }
}

test('valid current modules and an unchanged historical package pass', () => fixture(({verify}) => {
  const result = verify();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /passed: 4 packages/);
}));

test('a one-byte package change fails verification', () => fixture(({root, verify}) => {
  const path = join(root, 'dist', 'absolute-current.zip');
  const bytes = readFileSync(path); bytes[0] ^= 1; writeFileSync(path, bytes);
  const result = verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Package digest mismatch: absolute-current.zip/);
}));

test('modified current source fails verification', () => fixture(({root, verify}) => {
  writeFileSync(join(root, 'pairwise', 'manifest.json'), 'synthetic modified source');
  const result = verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Source digest mismatch: pairwise\/manifest.json/);
}));

test('missing current source fails with the affected module and file', () => fixture(({root, verify}) => {
  rmSync(join(root, 'demo', 'manifest.json'));
  const result = verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Source digest mismatch: demo\/manifest.json/);
}));

test('archived packages still require their original bytes', () => fixture(({root, verify}) => {
  writeFileSync(join(root, 'dist', 'pairwise-old.zip'), 'synthetic replaced historical bytes');
  const result = verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Package digest mismatch: pairwise-old.zip/);
}));
