import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileEffect, Effect } from '../../public/js/render/vfx/effect.js';
import { cameraBasis } from '../../public/js/render/vfx/geom.js';

// Reduced from upstream #919's production S3 prefab, including its nested background depth.
const material = {
  name: 'background', shader: 'Torappu/Particles/Additive', queue: 'Transparent',
  passes: [{ blend: ['SrcAlpha', 'One'], zTest: 'Disabled', zWrite: false, cull: 'Off' }],
  floats: {}, colors: {}, textures: {},
};
const mesh = { positions: [0, 0, 0, 1, 0, 1, -1, 0, 1, 0, 1, 1],
  uv0: [0, 0, 1, 0, 0, 1, 1, 1], submeshes: [[0, 1, 2, 0, 2, 3]] };
const lib = { mesh: () => mesh };
function fixture(key = 'cetsyr_skill_03_buff_01') {
  const node = (name, parent, pos = [0, 0, 0]) => ({ name, parent, pos, active: true,
    rot: [0, 0, 0, 1], scale: [1, 1, 1], children: [] });
  const nodes = [node(key, null), node('static_offset', 0), node('fixed', 1),
    node('rotation', 2), node('scale', 3, [0, -.053, .104]),
    node('beijing_01', 4, [0, .816, 0]), node('glow_qian', 3, [0, .407, .05]),
    node('front', 3, [0, .6, 0]), node('dark', 3, [0, .693, 0])];
  for (const [i, order] of [[5, 0], [6, 1], [7, 0], [8, -7]]) {
    nodes[i].meshFilter = 'standing';
    nodes[i].meshRenderer = { m_Enabled: true, m_SortingLayer: 0, m_SortingOrder: order, materials: [0] };
  }
  return { key, root: 0, nodes, materials: [material], textures: [], meshes: [] };
}
function entries(desc, lite) {
  const def = compileEffect(desc, lib), fx = new Effect(def, { lib, lite, seed: 1 });
  fx.update(1 / 30);
  const result = new Map();
  fx.gather(cameraBasis(30, [0, -5, -8], 720, .7), e => result.set(def.nodes[e.node].name, e));
  return result;
}
test('Civilight Eterna S3 background stays below operators in full and lite, preserving foreground order', () => {
  for (const lite of [false, true]) {
    const desc = fixture(), rows = entries(desc, lite);
    assert.equal(rows.get('beijing_01').ground, true);
    assert.equal(rows.get('beijing_01').order, 0);
    assert.equal(desc.nodes[5].meshRenderer.m_SortingOrder, 0);
    assert.equal(rows.get('glow_qian').ground, false);
    assert.equal(rows.get('front').ground, false);
    assert.equal(rows.get('dark').ground, true);
  }
});
test('a similarly named background in an unrelated prefab keeps its original pass', () => {
  assert.equal(entries(fixture('unrelated_effect'), false).get('beijing_01').ground, false);
});
