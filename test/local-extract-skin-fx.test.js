import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('skin hook extraction normalizes real fromEffect/toEffect pairs and rewrites nested modes', () => {
  const script = `import sys,json
from types import SimpleNamespace
sys.path.insert(0,${JSON.stringify(path.resolve('tools/local-extract'))})
import fx
class Env:
 def tt(self,obj):
  if obj.kind=='root': return {'m_Component':[{'component':1}]}
  return {'_replaceEffectPairs':[{'fromEffect':'Default_FX','toEffect':'Skin_FX'},{'fromEffect':'Default_FX','toEffect':'Skin_FX'}, {'fromEffect':'','toEffect':'bad'}]}
 def resolve(self,file,ptr): return ('fixture',SimpleNamespace(kind='hook',type=SimpleNamespace(name='MonoBehaviour')))
 def script(self,obj): return ('','CharacterSkinHooker')
env=Env()
original=fx.go_children
fx.go_children=lambda env,node: []
pairs=fx.skin_effect_pairs(env,SimpleNamespace(kind='root',assets_file=None))
assert pairs=={'default_fx':'skin_fx'},pairs
mode=[{'name':'Default','attack':{'cast':[{'effects':['Default_FX','untouched']}]} }]
rewritten=fx.replace_skin_keys(mode,pairs)
assert rewritten[0]['attack']['cast'][0]['effects']==['skin_fx','untouched']
assert mode[0]['attack']['cast'][0]['effects'][0]=='Default_FX'
print('skin hook pairs and nested modes verified')
`;
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-B', '-c', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified/);
});
