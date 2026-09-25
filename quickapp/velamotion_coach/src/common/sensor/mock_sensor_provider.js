import { SAMPLE_PERIOD_MS } from '../algorithm/config.js';
import { getScenario, sampleMotionFrame, stepRateForMode, locateSegment } from './mock_scenarios.js';

export class MockSensorProvider {
  constructor() {
    this.timer = null;
    this.active = false;
    this.sceneId = 'mixed_workout';
    this.startedAtMs = 0;
    this.syntheticElapsedSec = 0;
    this.startOffsetSec = 0;
    this.stepCount = 0;
    this.lastStepAtSec = -999;
    this.onBatch = null;
    // Schedule the next batch only after the current callback has returned.
    this.tickMs = 1000;
  }

  selectScene(sceneId) {
    this.sceneId = sceneId;
  }

  currentScenario() {
    return getScenario(this.sceneId);
  }

  start(sceneId, onBatch, options) {
    this.stop();
    this.sceneId = sceneId || this.sceneId;
    this.onBatch = onBatch;
    this.startedAtMs = Date.now();
    const requestedOffset = Number(options && options.startOffsetSec);
    this.startOffsetSec = Number.isFinite(requestedOffset) && requestedOffset > 0 ? requestedOffset : 0;
    this.syntheticElapsedSec = this.startOffsetSec;
    this.stepCount = 0;
    this.lastStepAtSec = this.syntheticElapsedSec - 999;
    this.active = true;
    this.emitTick();
  }

  stop() {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  emitTick() {
    if (!this.active) return;
    const tickStartedAtMs = Date.now();
    // Mock time advances at a fixed 16 Hz. Do not replay wall-clock lag: on a
    // slow QuickJS emulator that would permanently inflate the next batch and
    // starve input/rendering after one expensive inference.
    const samplesPerTick = Math.max(1, Math.round(this.tickMs / SAMPLE_PERIOD_MS));
    const batch = [];
    for (let i = 0; i < samplesPerTick; i++) {
      const elapsedSec = this.syntheticElapsedSec;
      const located = locateSegment(this.sceneId, elapsedSec);
      const rate = stepRateForMode(located.segment.mode);
      if (rate > 0 && elapsedSec - this.lastStepAtSec >= 1 / rate) {
        this.stepCount += 1;
        this.lastStepAtSec = elapsedSec;
      }
      const frame = sampleMotionFrame(this.sceneId, elapsedSec, this.stepCount);
      batch.push(Object.assign(frame, {
        timeStamp: this.startedAtMs + Math.round(elapsedSec * 1000),
      }));
      this.syntheticElapsedSec += SAMPLE_PERIOD_MS / 1000;
    }
    if (this.onBatch) this.onBatch(batch);
    if (this.active) {
      const measuredWorkMs = Date.now() - tickStartedAtMs;
      const workMs = Number.isFinite(measuredWorkMs) ? Math.max(0, measuredWorkMs) : 0;
      // Give input/rendering at least as much time as this synchronous round
      // consumed. Fast runtimes retain the 1 s cadence; slow emulators settle
      // near a 50% compute duty cycle without changing the 16-frame batch.
      const nextDelayMs = Math.max(this.tickMs, Math.ceil(workMs));
      this.timer = setTimeout(() => {
        this.timer = null;
        this.emitTick();
      }, nextDelayMs);
    }
  }
}
