import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const launcher = fileURLToPath(new URL('../Siteyi-Ac.cmd', import.meta.url));
const fixtureParent = path.resolve(tmpdir());

function project(root, installed) {
  mkdirSync(path.join(root, 'scripts'), {recursive:true});
  writeFileSync(path.join(root, 'package.json'), '{"name":"anime-takvimi-membership"}');
  writeFileSync(path.join(root, 'scripts', 'open-local.mjs'),
    'console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}));');
  if(installed) {
    mkdirSync(path.join(root, 'node_modules', 'vinext', 'dist'), {recursive:true});
    writeFileSync(path.join(root, 'node_modules', 'vinext', 'dist', 'cli.js'), '');
  }
}

function cleanup(root) {
  assert.equal(path.dirname(path.resolve(root)), fixtureParent);
  assert.ok(path.basename(root).startsWith('anime launcher '));
  rmSync(root,{recursive:true,force:true});
}

function launch(directory) {
  copyFileSync(launcher, path.join(directory, 'Siteyi-Ac.cmd'));
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d','/c','Siteyi-Ac.cmd','--no-open'], {
    cwd:directory, encoding:'utf8', timeout:10000, windowsHide:true,
    env:{...process.env, PATH:path.dirname(process.execPath)+';'+(process.env.PATH || '')},
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout+'\n'+result.stderr);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}

test('output launchers reuse the installed source when the distributed copy has no packages', {skip:process.platform!=='win32'}, ()=>{
  const root=mkdtempSync(path.join(fixtureParent, 'anime launcher '));
  try {
    const source=path.join(root,'work','anime-membership');
    const packaged=path.join(root,'outputs','anime-takvimi-guncel');
    project(source,true);
    project(packaged,false);
    for(const directory of [path.join(root,'outputs'), packaged]) {
      const result=launch(directory);
      assert.equal(result.cwd,source);
      assert.deepEqual(result.args,['--no-open']);
    }
  } finally {cleanup(root);}
});

test('an installed standalone copy keeps its own files and data', {skip:process.platform!=='win32'}, ()=>{
  const root=mkdtempSync(path.join(fixtureParent, 'anime launcher '));
  try {
    const source=path.join(root,'work','anime-membership');
    const packaged=path.join(root,'outputs','anime-takvimi-guncel');
    project(source,true);
    project(packaged,true);
    assert.equal(launch(packaged).cwd,packaged);
  } finally {cleanup(root);}
});