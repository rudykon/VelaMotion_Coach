import { SAMPLE_PERIOD_MS } from '../algorithm/config.js';

// Native callbacks use the same uORB monotonic clock, in milliseconds.
// ACC is m/s²; GYRO is rad/s. Missing axes are never synthesized.
export function loadNativeSensor() {
  try {
    const mod = require('@system.sensor');
    return mod && mod.default ? mod.default : mod;
  } catch (e) { return null; }
}

export class NativeSensorTransport {
  constructor(sensor) { this.sensor = sensor || loadNativeSensor(); this.generation = 0; }
  getCapabilities() {
    const s = this.sensor;
    const accelerometer = Boolean(s && typeof s.subscribeAccelerometer === 'function' && typeof s.unsubscribeAccelerometer === 'function');
    const gyroscope = Boolean(s && typeof s.subscribeGyroscope === 'function' && typeof s.unsubscribeGyroscope === 'function');
    return { accelerometer, gyroscope, fullActivityRecognition: accelerometer && gyroscope,
      mode: 'native_six_axis', source: 'native_uorb',
      reason: !accelerometer ? 'accelerometer_not_available' : !gyroscope ? 'native_gyroscope_feature_required' : '' };
  }
  start(onFrame, onError) {
    this.stop();
    const generation = ++this.generation;
    const active = () => generation === this.generation;
    const fail = (data, code) => { if (active()) onError(String(data || code || 'native_subscription_failed')); };
    ['accel', 'gyro'].forEach((kind) => {
      if (!active()) return;
      const method = kind === 'accel' ? 'subscribeAccelerometer' : 'subscribeGyroscope';
      try {
        this.sensor[method]({ interval: 'game',
          callback: (ret) => { if (active()) onFrame(kind, ret); }, fail });
      } catch (e) { fail(e.message); }
    });
  }
  stop() {
    this.generation += 1;
    const s = this.sensor;
    if (!s) return;
    ['unsubscribeAccelerometer', 'unsubscribeGyroscope'].forEach((name) => {
      try { if (typeof s[name] === 'function') s[name](); } catch (e) {}
    });
  }
}

export class SixAxisSensorProvider {
  constructor(deps) {
    const d = deps || {};
    this.transport = d.transport || new NativeSensorTransport(d.sensor);
    this.now = d.now || (() => Date.now());
    this.setTimer = d.setTimeout || setTimeout;
    this.clearTimer = d.clearTimeout || clearTimeout;
    this.timer = null;
    this.active = false;
    this.generation = 0;
    this.status = { active: false, ready: false, accelerometer: 'idle', gyroscope: 'idle', fullActivityRecognition: false };
    this.health = { heartRate: 0, spo2: 0, stress: 0 };
  }
  getCapabilities() { return this.transport.getCapabilities(); }
  getStatus() { return Object.assign({}, this.status); }
  updateHealth(sample) {
    if (!sample || !sample.ok || !Number.isFinite(sample.value)) return;
    const key = { 0: 'heartRate', 6: 'spo2', 9: 'stress' }[sample.dataType];
    if (key) this.health[key] = sample.value;
  }
  start(onBatch, options) {
    this.stop();
    const opts = options || {};
    this.onBatch = onBatch;
    this.onStatus = opts.onStatus;
    this.firstTimeout = opts.firstFrameTimeoutMs || 3000;
    this.staleTimeout = opts.staleTimeoutMs || 1000;
    this.maxGap = opts.maxInterpolationGapMs || 200;
    this.frames = { accel: [], gyro: [] };
    this.received = { accel: null, gyro: null };
    this.nextSample = null;
    this.clockOffset = null;
    this.started = this.now();
    this.health = { heartRate: 0, spo2: 0, stress: 0 };
    this.active = true;
    const generation = ++this.generation;
    this.status = { active: true, ready: false, accelerometer: 'waiting', gyroscope: 'waiting',
      fullActivityRecognition: false, emittedSamples: 0, invalidFrames: 0, duplicateFrames: 0,
      source: this.getCapabilities().source, error: '' };
    if (!this.getCapabilities().fullActivityRecognition || typeof onBatch !== 'function') {
      this.fail('six_axis_interface_unavailable');
      return this.getStatus();
    }
    this.notify();
    try {
      this.transport.start((kind, frame) => {
        if (this.active && generation === this.generation) this.receive(kind, frame);
      }, (error) => { if (this.active && generation === this.generation) this.fail(error); });
    } catch (e) { this.fail(e.message || 'transport_start_failed'); }
    this.schedule();
    return this.getStatus();
  }
  notify() { if (this.onStatus) this.onStatus(this.getStatus()); }
  fail(reason) {
    if (!this.active) return;
    this.status.error = reason;
    this.status.ready = false;
    this.status.fullActivityRecognition = false;
    this.stop(false);
    this.notify();
  }
  stop(clearCallbacks = true) {
    this.active = false;
    this.generation += 1;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.transport.stop();
    this.status.active = false;
    this.status.ready = false;
    this.status.fullActivityRecognition = false;
    if (clearCallbacks) { this.onBatch = null; this.onStatus = null; }
  }
  receive(kind, frame) {
    if (!this.active || !this.frames[kind]) return;
    if (!frame || !['x', 'y', 'z', 'timestampMs'].every((key) => Number.isFinite(frame[key])) || frame.timestampMs < 0) {
      this.status.invalidFrames += 1;
      return;
    }
    const queue = this.frames[kind];
    const last = queue[queue.length - 1];
    if (last && frame.timestampMs <= last.timestampMs) {
      this.status.duplicateFrames += 1;
      if (frame.timestampMs < last.timestampMs - 1000) this.fail('sensor_clock_reset');
      return;
    }
    if (last && frame.timestampMs - last.timestampMs > this.maxGap) {
      this.fail(kind + '_sample_gap'); return;
    }
    if (queue.length >= 256) { this.fail('sensor_queue_overflow'); return; }
    const receivedAt = this.now();
    if (this.clockOffset === null) this.clockOffset = receivedAt - frame.timestampMs;
    queue.push({ x: frame.x, y: frame.y, z: frame.z, timestampMs: frame.timestampMs });
    this.received[kind] = receivedAt;
    this.status[kind === 'accel' ? 'accelerometer' : 'gyroscope'] = 'ok';
    if (!this.status.ready && this.frames.accel.length >= 2 && this.frames.gyro.length >= 2) {
      this.status.ready = true;
      this.status.fullActivityRecognition = true;
      this.nextSample = Math.max(this.frames.accel[0].timestampMs, this.frames.gyro[0].timestampMs);
      this.notify();
    }
  }
  interpolate(queue, timestampMs) {
    while (queue.length > 2 && queue[1].timestampMs <= timestampMs) queue.shift();
    const left = queue[0]; const right = queue[1];
    if (!left || !right || timestampMs < left.timestampMs || timestampMs > right.timestampMs) return null;
    const fraction = (timestampMs - left.timestampMs) / (right.timestampMs - left.timestampMs);
    return ['x', 'y', 'z'].map((key) => left[key] + fraction * (right[key] - left[key]));
  }
  tick() {
    if (!this.active) return;
    const now = this.now();
    if (!this.status.ready && now - this.started >= this.firstTimeout) { this.fail('six_axis_first_frame_timeout'); return; }
    for (const kind of ['accel', 'gyro']) {
      if (this.received[kind] !== null && now - this.received[kind] >= this.staleTimeout) {
        this.fail(kind + '_stream_stale'); return;
      }
    }
    if (this.status.ready) {
      const a = this.frames.accel; const g = this.frames.gyro;
      const through = Math.min(a[a.length - 1].timestampMs, g[g.length - 1].timestampMs);
      const batch = [];
      while (this.nextSample <= through && batch.length < 64) {
        const acc = this.interpolate(a, this.nextSample);
        const gyro = this.interpolate(g, this.nextSample);
        if (!acc || !gyro) break;
        batch.push(Object.assign({}, this.health, { accX: acc[0], accY: acc[1], accZ: acc[2],
          gyroX: gyro[0], gyroY: gyro[1], gyroZ: gyro[2], stepCount: 0, stepAvailable: false,
          timeStamp: this.nextSample + this.clockOffset, sensorTimestampMs: this.nextSample,
          source: this.status.source, gyroAvailable: true, fullActivityRecognition: true,
          recognitionMode: 'six_axis', units: 'm/s2,rad/s' }));
        this.nextSample += SAMPLE_PERIOD_MS;
      }
      this.status.emittedSamples += batch.length;
      if (batch.length && this.onBatch) this.onBatch(batch, this.getStatus());
    }
    this.schedule();
  }
  schedule() {
    if (!this.active || this.timer !== null) return;
    this.timer = this.setTimer(() => { this.timer = null; this.tick(); }, 100);
  }
}
