import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expression, compileTemplate } from '../scripts/build-preview.mjs';
import { createWasmBackend, FEATURE_KEYS } from '../preview/wasm-backend.js';
import { classifyWindow } from '../../quickapp/velamotion_coach/src/common/algorithm/tiny_classifier.js';
import { sampleMotionFrame } from '../../quickapp/velamotion_coach/src/common/sensor/mock_scenarios.js';

test('preview build is derived from the current UX file and covers its original business modules', async () => {
  const info = JSON.parse(await fs.readFile(new URL('../dist/preview/source-info.json', import.meta.url)));
  const source = await fs.readFile(new URL('../../quickapp/velamotion_coach/src/pages/index/index.ux', import.meta.url));
  assert.equal(info.uxSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(info.rpkRuntime, false);
  for (const name of ['motion_engine.js','touch_gesture.js','session_store.js','summary_provider.js','mock_sensor_provider.js']) {
    assert.ok(info.modules.some(p=>p.endsWith('/'+name)), name);
  }
});

test('UX compiler fails on unsupported controls, directives and executable expressions', () => {
  assert.throws(()=>compileTemplate('<video src="x"/>'), /Unsupported UX tag/);
  assert.throws(()=>compileTemplate('<input onclick="foo"/>'), /Unsupported UX attribute/);
  assert.throws(()=>compileTemplate('<div if="true"/>'), /one expression/);
  assert.throws(()=>expression('fetch("https://invalid.example")'), /Unsupported UX expression node/);
  assert.throws(()=>expression('foo; bar'), /Unsupported UX expression/);
  assert.doesNotThrow(()=>compileTemplate('<text for="{{ live.rows }}" if="{{ !$item.hidden }}">{{ $item.name }}</text>'));
});

test('WASM app adapter preserves features required by risk analysis and six scores', async () => {
  const {instance} = await WebAssembly.instantiate(await fs.readFile(new URL('../dist/wasm/classifier.wasm', import.meta.url)), {env:{abort(){throw Error('abort');}}});
  let calls=0;
  const backend=createWasmBackend(instance.exports, ms=>{assert.ok(ms>=0);calls++;});
  for (const scene of ['running','jump_rope','static','fatigue_running']) {
    const frames=Array.from({length:48},(_,i)=>sampleMotionFrame(scene,8+i/16,0));
    const context={heartRate:frames.at(-1).heartRate};
    const actual=backend.classifyWindow({samples:frames,context});
    const reference=classifyWindow(frames,context);
    assert.equal(actual.classIdx,reference.classIdx);
    FEATURE_KEYS.forEach(key=>assert.ok(Math.abs(actual.features[key]-reference.features[key])<1e-8,key));
    actual.probs.forEach((value,i)=>assert.ok(Math.abs(value-reference.probs[i])<1e-10));
  }
  assert.equal(calls,4);
});
