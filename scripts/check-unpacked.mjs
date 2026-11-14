import {existsSync, readFileSync, statSync} from 'node:fs';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export function checkUnpacked(directory) {
  const root = resolve(directory), manifestPath = resolve(root, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error('manifest.json not found; select the directory directly containing it.');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  if (manifest?.manifest_version !== 3 || typeof manifest.name !== 'string' || !manifest.name.trim() || typeof manifest.version !== 'string' || !manifest.version.trim()) {
    throw new Error('Expected a Manifest V3 extension with a name and version.');
  }
  const files = new Set();
  function add(path) {
    if (typeof path !== 'string' || !path || /^[a-z]:|^[/\\]/i.test(path)) throw new Error('Expected a relative declared file path.');
    const target = resolve(root, path.replace(/\\/g, '/')), local = relative(root, target);
    if (local === '..' || local.startsWith('..' + sep) || isAbsolute(local)) throw new Error('Declared file path leaves the extension directory.');
    if (!existsSync(target) || !statSync(target).isFile()) throw new Error('Missing declared file: ' + path);
    files.add(local);
    return target;
  }
  if (manifest.background?.service_worker !== undefined) add(manifest.background.service_worker);
  if (manifest.side_panel?.default_path !== undefined) {
    const panel = add(manifest.side_panel.default_path);
    const html = readFileSync(panel, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    for (const match of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
      const tag = match[0];
      const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(a => [a[1].toLowerCase(), a[2] ?? a[3]]));
      const ref = /^<script\b/i.test(tag) ? attrs.src
        : (attrs.rel ?? '').toLowerCase().split(/\s+/).includes('stylesheet') ? attrs.href : undefined;
      if (!ref || /^[a-z][a-z\d+.-]*:|^\/\//i.test(ref)) continue;
      const pathname = ref.split(/[?#]/, 1)[0];
      if (!pathname) continue;
      const decoded = decodeURIComponent(pathname);
      const target = decoded.startsWith('/') ? resolve(root, '.' + decoded) : resolve(dirname(panel), decoded);
      add(relative(root, target));
    }
  }
  const groups = manifest.content_scripts === undefined ? [] : manifest.content_scripts;
  if (!Array.isArray(groups)) throw new Error('content_scripts must be an array.');
  for (const group of groups) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) throw new Error('Content script entries must be objects.');
    for (const key of ['js', 'css']) {
      const paths = group[key] === undefined ? [] : group[key];
      if (!Array.isArray(paths)) throw new Error('Content script file lists must be arrays.');
      for (const path of paths) add(path);
    }
  }
  return {name: manifest.name, version: manifest.version, checkedFiles: files.size};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const usage = 'Usage: node scripts/check-unpacked.mjs DIRECTORY\nCheck declared background, side-panel and content-script files without installing.';
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) console.log(usage);
  else if (args.length !== 1) { console.error(usage); process.exitCode = 1; }
  else {
    try { console.log(JSON.stringify(checkUnpacked(args[0]))); }
    catch (error) { console.error('Unpacked directory check failed: ' + error.message); process.exitCode = 1; }
  }
}
