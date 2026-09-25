import { SAMPLE_PERIOD_MS } from '../algorithm/config.js';
import { DATA_TYPES } from './health_provider.js';

const MAX_ACC_FRAMES = 128;
const MAX_BATCH_SAMPLES = 60;
const DEFAULT_TICK_MS = 100;
const DEFAULT_FIRST_FRAME_TIMEOUT_MS = 3000;
const DEFAULT_STALE_TIMEOUT_MS = 1000;

function nowMs() {
  return Date.now();
}

function scheduleTimer(callback, delayMs) {
  return setTimeout(callback, delayMs);
}

function cancelTimer(timer) {
  clearTimeout(timer);
}

function finiteNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isFiniteFrame(ret) {
  return Boolean(
    ret &&
    typeof ret.x === 'number' && Number.isFinite(ret.x) &&
    typeof ret.y === 'number' && Number.isFinite(ret.y) &&
    typeof ret.z === 'number' && Number.isFinite(ret.z),
  );
}

function positiveFiniteNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function failureMessage(error, code) {
  if (error && typeof error.message === 'string' && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (typeof code === 'number' && Number.isFinite(code)) return String(code);
  return 'subscription_failed';
}

function loadSensor() {
  try {
    if (typeof require === 'function') {
      const mod = require('@system.sensor');
      return mod && mod.default ? mod.default : mod;
    }
  } catch (e) {
    console.log('sensor dynamic load failed: ' + (e && e.message ? e.message : e));
  }
  return null;
}

function baseStatus() {
  return {
    active: false,
    ready: false,
    accelerometer: 'idle',
    stepCounter: 'idle',
    gyroscope: 'not_available_in_js_api',
    fullActivityRecognition: false,
    mode: 'accelerometer_only',
    sampleMode: 'accelerometer_callbacks_resampled_to_16hz',
    emittedSamples: 0,
    droppedSamples: 0,
    invalidFrames: 0,
    firstFrameAtMs: 0,
  };
}

export class RealSensorProvider {
  constructor(dependencies) {
    const deps = dependencies || {};
    this.clock = typeof deps.now === 'function' ? deps.now : nowMs;
    this.sensorLoader = typeof deps.loadSensor === 'function' ? deps.loadSensor : loadSensor;
    this.setTimer = typeof deps.setTimeout === 'function' ? deps.setTimeout : scheduleTimer;
    this.clearTimer = typeof deps.clearTimeout === 'function' ? deps.clearTimeout : cancelTimer;

    this.timer = null;
    this.onBatch = null;
    this.onStatus = null;
    this.sensor = null;
    this.latestAcc = null;
    this.accFrames = [];
    this.latestSteps = 0;
    this.latestHealth = { heartRate: 0, spo2: 0, stress: 0 };
    this.nextSampleTimeMs = null;
    this.firstFrameDeadlineMs = 0;
    this.hasReceivedFirstFrame = false;
    this.active = false;
    this.tickMs = DEFAULT_TICK_MS;
    this.firstFrameTimeoutMs = DEFAULT_FIRST_FRAME_TIMEOUT_MS;
    this.staleTimeoutMs = DEFAULT_STALE_TIMEOUT_MS;
    this.lastNotifiedStatusKey = null;
    this.status = baseStatus();
  }

  getCapabilities() {
    let sensor = this.sensor;
    if (!sensor) {
      try {
        sensor = this.sensorLoader();
      } catch (e) {
        sensor = null;
      }
    }
    const hasAccelerometer = Boolean(sensor && typeof sensor.subscribeAccelerometer === 'function');
    return {
      accelerometer: hasAccelerometer,
      // openvela's public JS sensor API currently has no supported gyroscope
      // subscription. A native six-axis adapter must use a separate provider.
      gyroscope: false,
      fullActivityRecognition: false,
      mode: hasAccelerometer ? 'accelerometer_only' : 'unavailable',
      reason: hasAccelerometer ? 'gyroscope_not_available_in_js_api' : 'accelerometer_not_available',
    };
  }

  getStatus() {
    return Object.assign({}, this.status, {
      active: this.active,
      ready: Boolean(this.status.ready && this.active),
    });
  }

  notifyStatus() {
    if (typeof this.onStatus !== 'function') return;
    const snapshot = this.getStatus();
    // Counters are deliberately excluded: status callbacks describe lifecycle
    // transitions, not every frame or emitted batch.
    const statusKey = [
      snapshot.active,
      snapshot.ready,
      snapshot.accelerometer,
      snapshot.stepCounter,
    ].join('|');
    if (statusKey === this.lastNotifiedStatusKey) return;
    this.lastNotifiedStatusKey = statusKey;
    try {
      this.onStatus(snapshot);
    } catch (e) {
      console.log('real sensor status callback failed: ' + (e && e.message ? e.message : e));
    }
  }

  updateHealth(sample) {
    if (!sample || !sample.ok || !DATA_TYPES) return;
    const value = finiteNumber(sample.value, 0);
    if (sample.dataType === DATA_TYPES.HEART_RATE) this.latestHealth.heartRate = value;
    if (sample.dataType === DATA_TYPES.SPO2) this.latestHealth.spo2 = value;
    if (sample.dataType === DATA_TYPES.STRESS) this.latestHealth.stress = value;
  }

  start(onBatch, options) {
    this.stop();
    const opts = options || {};
    this.onBatch = typeof onBatch === 'function' ? onBatch : null;
    this.onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : null;
    this.tickMs = positiveFiniteNumber(opts.tickMs, DEFAULT_TICK_MS);
    this.firstFrameTimeoutMs = positiveFiniteNumber(
      opts.firstFrameTimeoutMs,
      DEFAULT_FIRST_FRAME_TIMEOUT_MS,
    );
    this.staleTimeoutMs = positiveFiniteNumber(opts.staleTimeoutMs, DEFAULT_STALE_TIMEOUT_MS);
    this.latestAcc = null;
    this.accFrames = [];
    this.nextSampleTimeMs = null;
    this.hasReceivedFirstFrame = false;
    const startedAtMs = this.clock();
    this.firstFrameDeadlineMs = (
      typeof startedAtMs === 'number' && Number.isFinite(startedAtMs) ? startedAtMs : nowMs()
    ) + this.firstFrameTimeoutMs;
    this.lastNotifiedStatusKey = null;
    this.status = baseStatus();

    try {
      this.sensor = this.sensorLoader();
    } catch (e) {
      this.sensor = null;
    }
    const hasAccelerometer = Boolean(
      this.sensor && typeof this.sensor.subscribeAccelerometer === 'function',
    );
    if (!this.onBatch) {
      this.status.accelerometer = 'error:missing_batch_callback';
      this.notifyStatus();
      return this.getStatus();
    }
    if (!hasAccelerometer) {
      this.status.accelerometer = 'not_available';
      this.status.stepCounter = 'not_available';
      this.notifyStatus();
      return this.getStatus();
    }

    this.active = true;
    this.status.active = true;
    this.status.accelerometer = 'subscribing';
    this.status.stepCounter = typeof this.sensor.subscribeStepCounter === 'function'
      ? 'subscribing'
      : 'not_available';

    try {
      this.sensor.subscribeAccelerometer({
        interval: opts.interval || 'game',
        callback: (ret) => this.receiveAccelerometerFrame(ret),
        fail: (error, code) => this.handleAccelerometerSubscriptionFailure(error, code),
      });
    } catch (e) {
      this.status.accelerometer = 'error:' + (e && e.message ? e.message : e);
      this.deactivateSubscriptions();
      this.notifyStatus();
      return this.getStatus();
    }

    // Some platform implementations invoke fail synchronously from subscribe.
    // Do not proceed to another subscription or create a timer after teardown.
    if (!this.active || !this.sensor) return this.getStatus();

    if (typeof this.sensor.subscribeStepCounter === 'function') {
      try {
        this.sensor.subscribeStepCounter({
          callback: (ret) => {
            if (!this.active) return;
            this.latestSteps = Math.max(0, finiteNumber(ret && ret.steps, 0));
            if (this.status.stepCounter !== 'ok') {
              this.status.stepCounter = 'ok';
              this.notifyStatus();
            }
          },
          fail: (error, code) => {
            if (!this.active) return;
            this.status.stepCounter = 'error:' + failureMessage(error, code);
            this.notifyStatus();
          },
        });
      } catch (e) {
        this.status.stepCounter = 'error:' + (e && e.message ? e.message : e);
      }
    }

    this.notifyStatus();
    this.scheduleNextTick();
    return this.getStatus();
  }

  receiveAccelerometerFrame(ret) {
    if (!this.active) return;
    if (!isFiniteFrame(ret)) {
      this.status.invalidFrames += 1;
      if (!this.hasReceivedFirstFrame && this.status.accelerometer !== 'waiting_for_valid_frame') {
        this.status.accelerometer = 'waiting_for_valid_frame';
        this.notifyStatus();
      }
      return;
    }

    const receivedAtMs = this.clock();
    if (typeof receivedAtMs !== 'number' || !Number.isFinite(receivedAtMs)) {
      this.status.invalidFrames += 1;
      return;
    }

    if (
      this.hasReceivedFirstFrame &&
      this.latestAcc &&
      receivedAtMs - this.latestAcc.timeStamp >= this.staleTimeoutMs
    ) {
      // Detect the gap even when the recovery callback wins the race against
      // the next tick. markStreamStale clears the old output grid first.
      this.markStreamStale();
    }

    const frame = {
      x: ret.x,
      y: ret.y,
      z: ret.z,
      timeStamp: receivedAtMs,
    };
    this.latestAcc = frame;
    this.accFrames.push(frame);
    if (this.accFrames.length > MAX_ACC_FRAMES) this.accFrames.shift();
    if (!this.status.ready) {
      // The first frame and every post-stale recovery get a fresh grid anchor.
      // This prevents a recovered stream from filling the disconnected gap.
      this.nextSampleTimeMs = frame.timeStamp;
      if (!this.hasReceivedFirstFrame) this.status.firstFrameAtMs = frame.timeStamp;
    }
    this.hasReceivedFirstFrame = true;
    this.status.ready = true;
    this.status.accelerometer = 'ok';
    this.notifyStatus();
  }

  handleAccelerometerSubscriptionFailure(error, code) {
    if (!this.active) return;
    this.status.accelerometer = 'error:' + failureMessage(error, code);
    this.deactivateSubscriptions();
    this.notifyStatus();
  }

  markStreamStale() {
    if (!this.active) return;
    this.accFrames = [];
    this.latestAcc = null;
    this.nextSampleTimeMs = null;
    this.status.ready = false;
    if (this.status.accelerometer !== 'stale') {
      this.status.accelerometer = 'stale';
      this.notifyStatus();
    }
  }

  deactivateSubscriptions() {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.active = false;
    this.status.active = false;
    this.status.ready = false;
    const sensor = this.sensor;
    try { sensor && sensor.unsubscribeAccelerometer && sensor.unsubscribeAccelerometer(); } catch (e) {}
    try { sensor && sensor.unsubscribeStepCounter && sensor.unsubscribeStepCounter(); } catch (e) {}
    this.sensor = null;
    this.accFrames = [];
    this.latestAcc = null;
    this.nextSampleTimeMs = null;
  }

  stop() {
    this.deactivateSubscriptions();
    this.notifyStatus();
    this.onBatch = null;
    this.onStatus = null;
    this.lastNotifiedStatusKey = null;
  }

  scheduleNextTick() {
    if (!this.active || this.timer) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.emitTick();
    }, this.tickMs);
  }

  accAt(timeStamp) {
    const frames = this.accFrames;
    if (!frames.length) return null;
    if (timeStamp < frames[0].timeStamp) return null;
    if (timeStamp === frames[0].timeStamp) return frames[0];
    const last = frames[frames.length - 1];
    if (timeStamp > last.timeStamp) return null;
    if (timeStamp === last.timeStamp) return last;

    for (let i = 1; i < frames.length; i += 1) {
      const right = frames[i];
      if (right.timeStamp < timeStamp) continue;
      const left = frames[i - 1];
      if (timeStamp < left.timeStamp || right.timeStamp <= left.timeStamp) return null;
      const span = right.timeStamp - left.timeStamp;
      const p = Math.max(0, Math.min(1, (timeStamp - left.timeStamp) / span));
      return {
        x: left.x + (right.x - left.x) * p,
        y: left.y + (right.y - left.y) * p,
        z: left.z + (right.z - left.z) * p,
        timeStamp,
      };
    }
    return null;
  }

  emitTick() {
    if (!this.active || !this.onBatch) return;
    const now = this.clock();
    if (typeof now !== 'number' || !Number.isFinite(now)) {
      this.scheduleNextTick();
      return;
    }

    if (
      this.hasReceivedFirstFrame &&
      this.latestAcc &&
      now - this.latestAcc.timeStamp >= this.staleTimeoutMs
    ) {
      this.markStreamStale();
    }

    if (!this.status.ready || this.nextSampleTimeMs === null || !this.accFrames.length) {
      if (!this.hasReceivedFirstFrame && now >= this.firstFrameDeadlineMs) {
        this.status.accelerometer = 'timeout_waiting_for_first_frame';
        this.deactivateSubscriptions();
        this.notifyStatus();
        return;
      }
      this.scheduleNextTick();
      return;
    }

    const lastFrameTimeMs = this.accFrames[this.accFrames.length - 1].timeStamp;
    const availableThroughMs = Math.min(now, lastFrameTimeMs);
    if (availableThroughMs < this.nextSampleTimeMs) {
      this.scheduleNextTick();
      return;
    }

    let dueSamples = Math.floor(
      (availableThroughMs - this.nextSampleTimeMs) / SAMPLE_PERIOD_MS,
    ) + 1;
    if (dueSamples > MAX_BATCH_SAMPLES) {
      const dropped = dueSamples - MAX_BATCH_SAMPLES;
      this.nextSampleTimeMs += dropped * SAMPLE_PERIOD_MS;
      this.status.droppedSamples += dropped;
      dueSamples = MAX_BATCH_SAMPLES;
    }

    const firstTime = this.nextSampleTimeMs;
    const batch = [];
    for (let i = 0; i < dueSamples; i += 1) {
      const timeStamp = firstTime + i * SAMPLE_PERIOD_MS;
      const acc = this.accAt(timeStamp);
      if (!acc) break;
      batch.push({
        accX: Number(acc.x),
        accY: Number(acc.y),
        accZ: Number(acc.z),
        // Transport placeholders only. Capability flags prevent these values
        // from being presented to the six-class engine as measured GYRO data.
        gyroX: 0,
        gyroY: 0,
        gyroZ: 0,
        heartRate: this.latestHealth.heartRate || 0,
        spo2: this.latestHealth.spo2 || 0,
        stress: this.latestHealth.stress || 0,
        stepCount: this.latestSteps,
        timeStamp,
        source: 'real_sensor_provider',
        gyroAvailable: false,
        fullActivityRecognition: false,
        recognitionMode: 'accelerometer_only',
        gyroStatus: this.status.gyroscope,
      });
    }

    this.nextSampleTimeMs += batch.length * SAMPLE_PERIOD_MS;
    this.status.emittedSamples += batch.length;
    while (this.accFrames.length > 2 && this.accFrames[1].timeStamp < firstTime - 2 * SAMPLE_PERIOD_MS) {
      this.accFrames.shift();
    }

    try {
      if (batch.length) this.onBatch(batch, this.getStatus());
    } finally {
      // Schedule only after synchronous inference/UI work returns. This avoids
      // a timer backlog when QuickJS takes longer than one tick to render.
      this.scheduleNextTick();
    }
  }
}
