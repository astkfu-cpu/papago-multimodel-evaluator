import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const releases=JSON.parse(readFileSync(resolve(root,'dist/releases.json'),'utf8'));
for(const r of releases){
 if(sha(resolve(root,'dist',r.filename))!==r.sha256)throw new Error('Package digest mismatch: '+r.filename);
 if(r.module==='pairwise' && r.version!=='1.1.0')continue; // Archived package, kept immutable.
 const folder=r.module==='pairwise'?'pairwise':r.module==='demo'?'demo':'';
 for(const [name,expected] of Object.entries(r.source_files_sha256)){
  const path=resolve(root,folder,name);
  if(!existsSync(path) || sha(path)!==expected)throw new Error('Source digest mismatch: '+r.module+'/'+name);
 }
}
console.log('Release package and current source SHA-256 checks passed: '+releases.length+' packages.');
