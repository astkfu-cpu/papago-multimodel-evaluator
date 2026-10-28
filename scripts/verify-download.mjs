import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Read downloaded bytes only; never extract, modify or install the package.
export async function verifyDownload(zipPath, manifestPath = resolve(dirname(zipPath), 'releases.json')) {
  const filename = basename(zipPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!Array.isArray(manifest)) throw new Error('Release manifest must be an array.');
  const matches = manifest.filter(entry => entry && entry.filename === filename);
  if (matches.length !== 1) throw new Error('Expected exactly one manifest entry for ' + filename);
  const expected = matches[0].sha256;
  if (typeof expected !== 'string' || !/^[a-f\d]{64}$/i.test(expected)) throw new Error('Invalid SHA-256 in manifest for ' + filename);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(zipPath)) hash.update(chunk);
  const sha256 = hash.digest('hex');
  if (sha256 !== expected.toLowerCase()) throw new Error('SHA-256 mismatch for ' + filename + '; download the ZIP and manifest again before installing.');
  return {filename, sha256};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2) {
    console.error('Usage: node scripts/verify-download.mjs ZIP [MANIFEST]\nMANIFEST defaults to releases.json beside ZIP.');
    process.exitCode = 1;
  } else {
    try {
      const result = await verifyDownload(args[0], args[1]);
      console.log(`Verified ${result.filename}\nSHA-256: ${result.sha256}`);
    } catch (error) {
      console.error('Download verification failed: ' + error.message);
      process.exitCode = 1;
    }
  }
}
