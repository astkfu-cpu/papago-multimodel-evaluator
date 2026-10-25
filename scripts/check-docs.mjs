import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const ignored = new Set(['.git', 'node_modules', 'tmp', 'outputs', 'work']);

function withoutCode(text) {
  let fence = null;
  return text.split('\n').map(line => {
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}\\s*$').test(line)) fence = null;
      return '';
    }
    if (opening) { fence = opening[1]; return ''; }
    return line.replace(/(`+)[^`]*?\1/g, match => ' '.repeat(match.length));
  }).join('\n');
}

// Offline check of inline Markdown links/images. It does not resolve anchors,
// reference-style links, HTML links or external URLs.
export function checkDocs(directory) {
  const root = resolve(directory), files = [], problems = [];
  function walk(folder) {
    for (const entry of readdirSync(folder, {withFileTypes: true})) {
      const path = resolve(folder, entry.name);
      if (entry.isDirectory() && !ignored.has(entry.name)) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path);
    }
  }
  walk(root);
  let links = 0;
  for (const file of files) {
    const text = withoutCode(readFileSync(file, 'utf8'));
    const pattern = /!?\[[^\]\r\n]*\]\(\s*(?:<([^>\r\n]+)>|((?:\\.|[^()\s]|\([^()\r\n]*\))+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
    for (const match of text.matchAll(pattern)) {
      const target = match[1] ?? match[2];
      if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//') || target.startsWith('#')) continue;
      const pathname = target.split(/[?#]/, 1)[0];
      if (!pathname) continue;
      links++;
      const location = {file: relative(root, file), line: text.slice(0, match.index).split('\n').length, target};
      let decoded;
      try { decoded = decodeURIComponent(pathname).replace(/\\([\\() ])/g, '$1'); }
      catch { problems.push({...location, reason: 'invalid URL encoding'}); continue; }
      const resolved = decoded.startsWith('/') ? resolve(root, '.' + decoded) : resolve(dirname(file), decoded);
      const fromRoot = relative(root, resolved);
      if (fromRoot === '..' || fromRoot.startsWith('..' + sep) || isAbsolute(fromRoot)) {
        problems.push({...location, reason: 'target outside repository'});
      } else if (!existsSync(resolved)) problems.push({...location, reason: 'missing target'});
    }
  }
  return {documents: files.length, links, problems};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkDocs(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  for (const issue of result.problems) console.error(`${issue.file}:${issue.line}: ${issue.reason}: ${issue.target}`);
  console.log(`Checked ${result.links} inline local links in ${result.documents} Markdown files; ${result.problems.length} problems.`);
  if (result.problems.length) process.exitCode = 1;
}
