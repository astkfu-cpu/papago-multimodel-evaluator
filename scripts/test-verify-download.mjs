import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {verifyDownload} from './verify-download.mjs';

async function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'papago-download-'));
  const bytes = Buffer.from('synthetic downloaded bytes');
  const zip = join(root, '公开 package.zip'), manifest = join(root, 'releases.json');
  const entry = {filename: '公开 package.zip', sha256: createHash('sha256').update(bytes).digest('hex')};
  writeFileSync(zip, bytes); writeFileSync(manifest, JSON.stringify([entry]));
  try { await run({root, zip, manifest, entry, bytes}); }
  finally {
    assert(resolve(root).startsWith(resolve(tmpdir()) + sep + 'papago-download-'));
    rmSync(root, {recursive: true, force: true});
  }
}

test('uses sibling manifest, accepts uppercase digests and never changes files', () => fixture(async ({zip, manifest, entry, bytes}) => {
  writeFileSync(manifest, JSON.stringify([{...entry, sha256: entry.sha256.toUpperCase()}]));
  const before = readFileSync(manifest);
  assert.deepEqual(await verifyDownload(zip), entry);
  assert.deepEqual(readFileSync(zip), bytes);
  assert.deepEqual(readFileSync(manifest), before);
}));

test('one-byte changes are rejected without rewriting the download', () => fixture(async ({zip, bytes}) => {
  const altered = Buffer.from(bytes); altered[0] ^= 1; writeFileSync(zip, altered);
  await assert.rejects(verifyDownload(zip), /SHA-256 mismatch/);
  assert.deepEqual(readFileSync(zip), altered);
}));

test('supports a separately named manifest and reports missing files', () => fixture(async ({root, zip, manifest}) => {
  const other = join(root, 'download-manifest.json'); writeFileSync(other, readFileSync(manifest));
  await verifyDownload(zip, other);
  await assert.rejects(verifyDownload(join(root, 'absent.zip'), join(root, 'absent.json')), /ENOENT/);
  rmSync(zip);
  await assert.rejects(verifyDownload(zip, manifest), /ENOENT/);
}));

test('invalid, absent and ambiguous manifest entries cannot pass', () => fixture(async ({zip, manifest, entry}) => {
  for (const [value, message] of [[{}, /must be an array/], [[], /exactly one/], [[entry, entry], /exactly one/], [[{...entry, sha256: 'bad'}], /Invalid SHA-256/]]) {
    writeFileSync(manifest, JSON.stringify(value));
    await assert.rejects(verifyDownload(zip, manifest), message);
  }
  writeFileSync(manifest, '{broken');
  await assert.rejects(verifyDownload(zip, manifest), SyntaxError);
}));

test('CLI handles paths with spaces and returns failure for corruption or missing arguments', () => fixture(async ({zip, bytes}) => {
  const script = new URL('./verify-download.mjs', import.meta.url);
  const invoke = args => spawnSync(process.execPath, [fileURLToPath(script), ...args], {encoding: 'utf8'});
  const good = invoke([zip]); assert.equal(good.status, 0, good.stderr); assert.match(good.stdout, /Verified/);
  writeFileSync(zip, Buffer.concat([bytes, Buffer.from('changed')]));
  const bad = invoke([zip]); assert.equal(bad.status, 1); assert.match(bad.stderr, /SHA-256 mismatch/);
  assert.equal(invoke([]).status, 1);
}));
