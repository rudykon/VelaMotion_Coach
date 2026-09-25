import { WINDOW_SIZE, STEP_SIZE } from './config.js';

const DEFAULT_YIELD_MS = 16;
const DEFAULT_MAX_PENDING_SAMPLES = WINDOW_SIZE + STEP_SIZE;

function defaultSchedule(callback) {
  return setTimeout(callback, DEFAULT_YIELD_MS);
}

export class CooperativeMotionRunner {
  constructor(engine, deps) {
    const options = deps || {};
    this.engine = engine;
    this.schedule = typeof options.schedule === 'function'
      ? options.schedule
      : defaultSchedule;
    this.maxPendingSamples = Math.max(
      WINDOW_SIZE,
      Number(options.maxPendingSamples) || DEFAULT_MAX_PENDING_SAMPLES,
    );
    this.generation = 0;
    this.busy = false;
    this.pumpScheduled = false;
    this.pendingBatch = [];
    this.pendingContext = null;
    this.pendingCallback = null;
    this.activeWork = null;
  }

  submit(batch, context, onResult) {
    if (!batch || batch.length === 0) return false;
    const merged = this.pendingBatch.concat(batch);
    this.pendingBatch = merged.length > this.maxPendingSamples
      ? merged.slice(merged.length - this.maxPendingSamples)
      : merged;
    this.pendingContext = context || null;
    this.pendingCallback = typeof onResult === 'function' ? onResult : null;
    this.schedulePump();
    return true;
  }

  schedulePump() {
    if (this.busy || this.pumpScheduled || this.pendingBatch.length === 0) return;
    this.pumpScheduled = true;
    const token = this.generation;
    this.schedule(() => {
      if (token !== this.generation) return;
      this.pumpScheduled = false;
      this.pump(token);
    });
  }

  pump(token) {
    if (token !== this.generation || this.busy || this.pendingBatch.length === 0) return;
    const batch = this.pendingBatch;
    const context = this.pendingContext;
    const callback = this.pendingCallback;
    this.pendingBatch = [];
    this.pendingContext = null;
    this.pendingCallback = null;
    this.busy = true;
    const startedAtMs = Date.now();

    const work = this.engine.addSamplesCooperatively(batch, {
      latestOnly: true,
      schedule: this.schedule,
      isCancelled: () => token !== this.generation,
    }, (result) => {
      if (token !== this.generation) return;
      this.activeWork = null;
      this.busy = false;
      if (callback) callback(result, batch, {
        context,
        startedAtMs,
        completedAtMs: Date.now(),
      });
      this.schedulePump();
    });
    if (this.busy && token === this.generation) this.activeWork = work;
  }

  cancel() {
    this.generation += 1;
    if (this.activeWork && this.activeWork.cancel) this.activeWork.cancel();
    else if (this.engine && this.engine.cancelCooperativeWork) this.engine.cancelCooperativeWork();
    this.activeWork = null;
    this.busy = false;
    this.pumpScheduled = false;
    this.pendingBatch = [];
    this.pendingContext = null;
    this.pendingCallback = null;
  }

  pendingSampleCount() {
    return this.pendingBatch.length;
  }
}
