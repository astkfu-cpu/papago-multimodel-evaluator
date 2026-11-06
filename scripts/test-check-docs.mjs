import {strict as assert} from 'node:assert';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {test} from 'node:test';
import {checkDocs} from './check-docs.mjs';

function fixture(run) {
  const prefix = join(tmpdir(), 'papago-doc-links-');
  const root = mkdtempSync(prefix);
  try { run(root); }
  finally {
    // Delete only the isolated directory created by this fixture.
    assert(resolve(root).startsWith(resolve(tmpdir()) + sep + 'papago-doc-links-'));
    rmSync(root, {recursive: true, force: true});
  }
}

test('resolves bilingual, encoded, titled and repository-root links and images', () => fixture(root => {
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'README.md'), '# Home');
  writeFileSync(join(root, 'docs', '中文 guide.md'), '# Guide');
  writeFileSync(join(root, 'image(1).png'), 'synthetic');
  writeFileSync(join(root, 'docs', 'entry.md'), '[中文](中文%20guide.md#section)\n[Home](../README.md "Title")\n[Root](/README.md)\n![image](../image(1).png)\n[space](<中文 guide.md>)');
  const result = checkDocs(root);
  assert.equal(result.links, 5);
  assert.deepEqual(result.problems, []);
}));

test('ignores examples in both fence styles, inline code, anchors and network URLs', () => fixture(root => {
  writeFileSync(join(root, 'README.md'), '[web](https://example.invalid/)\n[anchor](#missing)\n[cdn](//example.invalid/a)\n`[example](missing.md)`\n```md\n[example](missing.md)\n````\n~~~md\n[example](missing.md)\n~~~\n[bad](missing.md)');
  const result = checkDocs(root);
  assert.equal(result.links, 1);
  assert.equal(result.problems[0].line, 11);
  assert.equal(result.problems[0].reason, 'missing target');
}));

test('reports missing paths, malformed escapes and repository traversal', () => fixture(root => {
  writeFileSync(join(root, 'README.md'), '[missing](missing.md)\n[encoding](bad%ZZ.md)\n[outside](../outside.md)');
  assert.deepEqual(checkDocs(root).problems.map(p => p.reason), ['missing target', 'invalid URL encoding', 'target outside repository']);
}));

test('does not scan generated files or dependency directories', () => fixture(root => {
  for (const dir of ['node_modules', 'tmp', 'outputs', 'work', '.git']) {
    mkdirSync(join(root, dir));
    writeFileSync(join(root, dir, 'ignored.md'), '[bad](missing.md)');
  }
  writeFileSync(join(root, 'README.md'), '# Public docs');
  assert.deepEqual(checkDocs(root), {documents: 1, links: 0, problems: []});
}));

test('checks same-line reference destinations once per definition, including unused ones', () => fixture(root => {
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', '中文 guide.md'), '# Guide');
  writeFileSync(join(root, 'image(1).png'), 'synthetic');
  writeFileSync(join(root, 'README.md'), '[Guide][guide]\n[Again][guide]\n![Image][picture]\n[guide]: <docs/中文 guide.md> "Guide"\n[picture]: image(1).png\n[unused]: docs/中文%20guide.md#part\n[web]: https://example.invalid/\n[anchor]: #section');
  const result = checkDocs(root);
  assert.equal(result.links, 3);
  assert.deepEqual(result.problems, []);
}));

test('reports reference destination failures at the definition line', () => fixture(root => {
  writeFileSync(join(root, 'README.md'), '# Home\n[bad]: missing.md\n  [encoded]: bad%ZZ.md\n[outside]: ../outside.md');
  const result = checkDocs(root);
  assert.equal(result.links, 3);
  assert.deepEqual(result.problems.map(p => [p.line, p.reason]), [
    [2, 'missing target'], [3, 'invalid URL encoding'], [4, 'target outside repository']
  ]);
}));

test('ignores reference definitions in code and destinations on a following line', () => fixture(root => {
  writeFileSync(join(root, 'README.md'), '```md\n[code]: missing.md\n```\n`[inline]: missing.md`\n    [indented]: missing.md\n[multiline]:\n  missing.md\n[real]: missing.md');
  const result = checkDocs(root);
  assert.equal(result.links, 1);
  assert.deepEqual(result.problems.map(p => [p.line, p.target]), [[8, 'missing.md']]);
}));

test('code spans use exact backtick run lengths even with literal backticks inside', () => fixture(root => {
  const tick = String.fromCharCode(96);
  writeFileSync(join(root, 'README.md'), [
    'Example ' + tick.repeat(2) + '[code](missing.md) ' + tick + ' literal' + tick.repeat(2) + ' [real](real-missing.md)',
    'Example ' + tick.repeat(3) + '![code](missing.png) ' + tick.repeat(2) + ' literal' + tick.repeat(3),
    'Unclosed ' + tick.repeat(2) + '[visible](visible-missing.md)' + tick,
    'Two ' + tick + '[code](missing.md)' + tick + ' then ' + tick.repeat(2) + '[code](missing.md) ' + tick + ' literal' + tick.repeat(2)
  ].join('\r\n'));
  const result = checkDocs(root);
  assert.equal(result.links, 2);
  assert.deepEqual(result.problems.map(p => [p.line, p.target]), [[1, 'real-missing.md'], [3, 'visible-missing.md']]);
}));

test('escaped opening brackets are literal while even escapes and escaped image markers retain links', () => fixture(root => {
  const slash = String.fromCharCode(92);
  writeFileSync(join(root, 'README.md'), [
    slash + '[example](literal-missing.md)',
    slash + '![link](escaped-marker.md)',
    slash.repeat(2) + '[link](even-escape.md)',
    '!' + slash + '[example](literal-missing.png)',
    slash.repeat(3) + '[example](literal-missing.md)',
    '[real](real-missing.md)'
  ].join('\r\n'));
  const result = checkDocs(root);
  assert.equal(result.links, 3);
  assert.deepEqual(result.problems.map(p => [p.line, p.target]), [[2, 'escaped-marker.md'], [3, 'even-escape.md'], [6, 'real-missing.md']]);
}));
