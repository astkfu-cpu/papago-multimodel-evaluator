import {readFile} from 'node:fs/promises';
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

export async function inspectBackup(path) {
  const text = await readFile(path, 'utf8');
  return summarizeBackup(JSON.parse(text.replace(/^\uFEFF/, '')));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const usage = 'Usage: node scripts/inspect-backup.mjs BACKUP_JSON\nRead-only counts for one plugin backup file; no restore or database access.';
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) console.log(usage);
  else if (args.length !== 1) { console.error(usage); process.exitCode = 1; }
  else {
    try { console.log(JSON.stringify(await inspectBackup(args[0]), null, 2)); }
    catch {
      // Do not echo parser excerpts, work identifiers or image paths from inputs.
      console.error('Backup inspection failed: file missing, invalid JSON, or unsupported/invalid plugin backup.');
      process.exitCode = 1;
    }
  }
}
