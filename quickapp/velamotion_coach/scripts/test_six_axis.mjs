import assert from 'node:assert/strict';
import { SixAxisSensorProvider, NativeSensorTransport } from '../src/common/sensor/six_axis_provider.js';
import { EmulatorUorbTransport } from '../src/common/sensor/emulator_uorb_transport.js';
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function harness() {
  let now = 10000; let id = 0;
  const timers = new Map(); const output = []; const states = [];
  const options = {};
  const sensor = { subscribeAccelerometer(o) { options.accel = o; },
    subscribeGyroscope(o) { options.gyro = o; },
    unsubscribeAccelerometer() {}, unsubscribeGyroscope() {} };
  const deps = { now: () => now, setTimeout(fn, delay) { const n = ++id; timers.set(n, { fn, at: now + delay }); return n; },
    clearTimeout(n) { timers.delete(n); } };
  const provider = new SixAxisSensorProvider({ ...deps, sensor });
  function advance(to) {
    for (;;) {
      const next = [...timers].sort((a,b) => a[1].at-b[1].at)[0];
      if (!next || next[1].at > to) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = to;
  }
  function frame(kind, t, values = [t, 2*t, 3*t]) {
    options[kind].callback({ timestampMs: t, x: values[0], y: values[1], z: values[2] });
  }
  const start = () => provider.start((b) => output.push(...b), { onStatus: (s) => states.push(s) });
  return { provider, output, states, timers, sensor, options, advance, frame, start, deps };
}
test('aligns both monotonic timelines at 16 Hz and retains nonzero floating point gyro', () => {
  const h=harness(); h.start();
  for(let t=0;t<=1000;t+=20) { h.advance(10000+t); h.frame('accel',t,[1+t/1000,2,9.81]); h.frame('gyro',t+1,[.1+(t+1)/1000,.2,.3]); }
  h.advance(11100);
  assert.equal(h.output.length,16);
  h.output.forEach((s,i) => { assert.equal(s.sensorTimestampMs,1+i*62.5); assert.ok(Math.abs(s.accX-(1+s.sensorTimestampMs/1000))<1e-8); assert.ok(Math.abs(s.gyroX-(.1+s.sensorTimestampMs/1000))<1e-8); assert.equal(s.source,'native_uorb'); });
  h.provider.stop(); assert.equal(h.timers.size,0);
});
test('missing gyro never emits and times out', () => {
  const h=harness(); h.start(); h.frame('accel',0);h.frame('accel',20);h.advance(11100);
  assert.equal(h.output.length,0);assert.equal(h.provider.active,false);assert.match(h.provider.status.error,/stale/);
});
test('missing interface is rejected before native subscriptions', () => {
  const h=harness();delete h.sensor.subscribeGyroscope;h.start();
  assert.equal(h.provider.active,false);assert.equal(h.options.accel,undefined);assert.equal(h.timers.size,0);
});
test('no frames times out and synchronous native failure cannot leave a timer', () => {
  const h=harness();h.start();h.advance(13100);assert.equal(h.provider.status.error,'six_axis_first_frame_timeout');
  const bad=harness();bad.sensor.subscribeAccelerometer=(o)=>o.fail('denied',203);bad.start();
  assert.equal(bad.provider.active,false);assert.equal(bad.options.gyro,undefined);assert.equal(bad.timers.size,0);
});
test('stopped and previous-session callbacks cannot feed a new session', () => {
  const h=harness();h.start();const old=h.options.accel.callback;h.provider.stop();h.start();
  old({timestampMs:500,x:1,y:2,z:3});assert.equal(h.provider.frames.accel.length,0);h.provider.stop();
});
test('non-finite, missing-timestamp and duplicate frames are rejected', () => {
  const h=harness();h.start();h.options.accel.callback({x:1,y:2,z:3});h.frame('gyro',0,[Infinity,1,2]);
  h.frame('accel',0);h.frame('accel',0);assert.equal(h.provider.status.invalidFrames,2);assert.equal(h.provider.status.duplicateFrames,1);h.provider.stop();
});
test('does not interpolate across a lost-sample gap or device reboot', () => {
  const h=harness();h.start();h.frame('accel',0);h.frame('accel',201);assert.equal(h.provider.status.error,'accel_sample_gap');assert.equal(h.output.length,0);
  const r=harness();r.start();r.frame('gyro',2000);r.frame('gyro',0);assert.equal(r.provider.status.error,'sensor_clock_reset');
});
test('stale gyro terminates the whole stream, without filling missing axes', () => {
  const h=harness();h.start();h.frame('accel',0);h.frame('gyro',0);h.frame('accel',20);h.frame('gyro',20);h.advance(11100);
  assert.equal(h.provider.active,false);const length=h.output.length;h.advance(12000);assert.equal(h.output.length,length);
});
test('native-buffer queue is bounded', () => {
  const h=harness();h.start();for(let i=0;i<260;i++)h.frame('accel',i);
  assert.equal(h.provider.status.error,'sensor_queue_overflow');assert.equal(h.provider.active,false);
});
test('HTTP transport rejects a wrong source and ignores late responses after stop', () => {
  let request;const h=harness();const transport=new EmulatorUorbTransport({...h.deps,fetcher:{fetch(o){request=o;}}});const errors=[];let count=0;
  transport.start(()=>count++,e=>errors.push(e));request.success({code:200,data:JSON.stringify({protocol:1,source:'grpc_readback',frames:[]})});
  assert.deepEqual(errors,['emulator_bridge_protocol_invalid']);assert.equal(count,0);
  transport.start(()=>count++,e=>errors.push(e));transport.stop();request.success({code:200,data:'invalid'});assert.equal(errors.length,1);
});
test('HTTP request timeout tears down polling and is not converted to sample data', () => {
  const h=harness();const transport=new EmulatorUorbTransport({...h.deps,fetcher:{fetch(){}}});const errors=[];
  transport.start(()=>assert.fail('no samples expected'),e=>errors.push(e));h.advance(11600);
  assert.deepEqual(errors,['emulator_bridge_timeout']);assert.equal(h.timers.size,0);
});
test('native capability requires both cleanup methods', () => {
  const h=harness();delete h.sensor.unsubscribeAccelerometer;h.start();
  assert.equal(h.options.accel,undefined);assert.equal(h.provider.status.error,'six_axis_interface_unavailable');
});
test('HTTP sequence loss fails instead of skipping native samples', () => {
  let request;const h=harness();const transport=new EmulatorUorbTransport({...h.deps,fetcher:{fetch(o){request=o;}}});const errors=[];
  transport.start(()=>assert.fail('lost frames must not be emitted'),e=>errors.push(e));
  const packet={protocol:1,source:'emulator_uorb',units:'m/s2,rad/s',session:'one',cursor:10,frames:[]};
  request.success({code:200,data:packet});h.advance(10100);
  request.success({code:200,data:{...packet,cursor:12,frames:[{kind:'accel',sequence:12,timestampMs:20,x:1,y:2,z:3}]}});
  assert.deepEqual(errors,['emulator_bridge_sequence_gap']);assert.equal(h.timers.size,0);
});
test('HTTP session restart cannot mix two native clock epochs', () => {
  let request;const h=harness();const transport=new EmulatorUorbTransport({...h.deps,fetcher:{fetch(o){request=o;}}});const errors=[];
  transport.start(()=>{},e=>errors.push(e));
  const packet={protocol:1,source:'emulator_uorb',units:'m/s2,rad/s',session:'one',cursor:10,frames:[]};
  request.success({code:200,data:packet});h.advance(10100);
  request.success({code:200,data:{...packet,session:'two'}});
  assert.deepEqual(errors,['emulator_bridge_restarted']);
});
let failed=0;
for(const {name,fn} of tests) { try { await fn(); console.log('PASS '+name); } catch(e) { failed++;console.error('FAIL '+name,e); } }
console.log(JSON.stringify({passed:tests.length-failed,total:tests.length}));if(failed)process.exitCode=1;
