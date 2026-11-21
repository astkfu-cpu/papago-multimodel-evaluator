import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseBackup} from '../pairwise/backup.js';

export function summarizeBackup(value) {
  const rows = parseBackup(value);
  const applied = rows.filter(row => row.applied).length;
  return {
    records: rows.length,
    applied,
    notApplied: rows.length - applied,
    needsReview: rows.filter(row => row.result.needs_review).length,
    tasks: new Set(rows.map(row => row.sheetId)).size,
    evaluators: new Set(rows.map(row => row.evaluator)).size
  };
}

export async function inspectBackup(path, {sha256 = false} = {}) {
  // Hash and validate the same read, including any BOM or formatting bytes.
  const bytes = await readFile(path);
  const summary = summarizeBackup(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')));
  return sha256 ? {...summary, sha256: createHash('sha256').update(bytes).digest('hex')} : summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const usage = 'Usage: node scripts/inspect-backup.mjs BACKUP_JSON [--sha256]\nRead-only counts for one plugin backup file; no restore or database access.';
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) console.log(usage);
  else if (args.length !== 1 && !(args.length === 2 && args[1] === '--sha256')) { console.error(usage); process.exitCode = 1; }
  else {
    try { console.log(JSON.stringify(await inspectBackup(args[0], {sha256: args.length === 2}), null, 2)); }
    catch {
      // Do not echo parser excerpts, work identifiers or image paths from inputs.
      console.error('Backup inspection failed: file missing, invalid JSON, or unsupported/invalid plugin backup.');
      process.exitCode = 1;
    }
  }
}
