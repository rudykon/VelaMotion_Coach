const DEFAULT_SYNC_FRAME_MS = 650;
const DEFAULT_BREATHE_HALF_MS = 1200;
const DEFAULT_BASELINE_STEP_MS = 140;
const MIN_TIMER_MS = 16;

function systemNow() {
  return Date.now();
}

function systemSetTimeout(callback, delayMs) {
  return setTimeout(callback, delayMs);
}

function systemClearTimeout(timer) {
  clearTimeout(timer);
}

export function motionNeutralFrame(preciseVisible) {
  return {
    pulseScale: 1,
    pulseOpacity: 0.56,
    buddyBreathScale: 1,
    startRingScale: 0.72,
    startRingOpacity: 0,
    startButtonScale: 1,
    startButtonOpacity: 1,
    baselineDot1Y: 0,
    baselineDot2Y: 0,
    baselineDot3Y: 0,
    baselineDot1Opacity: 0,
    baselineDot2Opacity: 0,
    baselineDot3Opacity: 0,
    activityScale: 1,
    activityOpacity: 1,
    heartScale: 1,
    riskTranslateX: 0,
    goalStarsScale: 0.72,
    goalStar1X: 0,
    goalStar1Y: 4,
    goalStar2X: 0,
    goalStar2Y: 4,
    goalStar3X: 0,
    goalStar3Y: 4,
    goalStar1Opacity: 0,
    goalStar2Opacity: 0,
    goalStar3Opacity: 0,
    goalMessageOpacity: 0,
    preciseStampScale: 1,
    preciseStampOpacity: preciseVisible ? 1 : 0,
    dot1Opacity: 1,
    dot2Opacity: 0.34,
    dot3Opacity: 0.34,
  };
}

function clamp(value, lower, upper) {
  return Math.max(lower, Math.min(upper, value));
}

export function heartRateIntervalMs(bpm) {
  const safeBpm = Number(bpm);
  if (!Number.isFinite(safeBpm) || safeBpm <= 0) return 0;
  return Math.max(500, Math.round(60000 / safeBpm));
}

export class MotionFxController {
  constructor(dependencies) {
    const deps = dependencies || {};
    this.now = typeof deps.now === 'function' ? deps.now : systemNow;
    this.setTimer = typeof deps.setTimeout === 'function' ? deps.setTimeout : systemSetTimeout;
    this.clearTimer = typeof deps.clearTimeout === 'function' ? deps.clearTimeout : systemClearTimeout;
    this.syncFrameMs = Math.max(100, Number(deps.frameMs) || DEFAULT_SYNC_FRAME_MS);
    this.breatheHalfMs = Math.max(600, Number(deps.breatheHalfMs) || DEFAULT_BREATHE_HALF_MS);
    this.baselineStepMs = clamp(Number(deps.baselineStepMs) || DEFAULT_BASELINE_STEP_MS, 120, 160);
    this.timer = null;
    this.generation = 0;
    this.running = false;
    this.onFrame = null;
    this.queue = [];
    this.effectTokens = {};
    this.frame = motionNeutralFrame(false);
    this.channels = { breathe: false, baseline: false, sync: false, heart: false };
    this.breatheExpanded = false;
    this.baselinePhase = 2;
    this.syncPhase = 0;
    this.breatheNextMs = 0;
    this.baselineNextMs = 0;
    this.syncNextMs = 0;
    this.heartPeriodMs = 0;
    this.heartNextMs = 0;
    this.heartResetMs = 0;
  }

  start(onFrame) {
    this.pause();
    this.running = true;
    this.onFrame = typeof onFrame === 'function' ? onFrame : null;
    const now = this.now();
    this.breatheNextMs = this.channels.breathe ? now + this.breatheHalfMs : 0;
    this.baselineNextMs = this.channels.baseline ? now + this.baselineStepMs : 0;
    this.syncNextMs = this.channels.sync ? now + this.syncFrameMs : 0;
    this.heartNextMs = this.channels.heart && this.heartPeriodMs > 0 ? now + this.heartPeriodMs : 0;
    this.schedule(this.generation);
  }

  nextDeadlineMs() {
    let deadline = Infinity;
    if (this.breatheNextMs > 0) deadline = Math.min(deadline, this.breatheNextMs);
    if (this.baselineNextMs > 0) deadline = Math.min(deadline, this.baselineNextMs);
    if (this.syncNextMs > 0) deadline = Math.min(deadline, this.syncNextMs);
    if (this.heartNextMs > 0) deadline = Math.min(deadline, this.heartNextMs);
    if (this.heartResetMs > 0) deadline = Math.min(deadline, this.heartResetMs);
    if (this.queue.length > 0) deadline = Math.min(deadline, this.queue[0].atMs);
    return deadline;
  }

  schedule(token) {
    if (!this.running || token !== this.generation || this.timer) return;
    const deadline = this.nextDeadlineMs();
    if (!Number.isFinite(deadline)) return;
    const delayMs = Math.max(MIN_TIMER_MS, deadline - this.now());
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (!this.running || token !== this.generation) return;
      this.flush(token);
    }, delayMs);
  }

  rearm() {
    if (!this.running) return;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.schedule(this.generation);
  }

  flush(token) {
    const now = this.now();
    let changed = false;

    if (this.breatheNextMs > 0 && this.breatheNextMs <= now) {
      this.breatheExpanded = !this.breatheExpanded;
      this.frame.pulseScale = this.breatheExpanded ? 1.06 : 1;
      this.frame.pulseOpacity = this.breatheExpanded ? 0.88 : 0.56;
      this.frame.buddyBreathScale = this.breatheExpanded ? 1.035 : 1;
      this.breatheNextMs += this.breatheHalfMs;
      if (this.breatheNextMs <= now) this.breatheNextMs = now + this.breatheHalfMs;
      changed = true;
    }

    if (this.baselineNextMs > 0 && this.baselineNextMs <= now) {
      this.baselinePhase = (this.baselinePhase + 1) % 3;
      this.frame.baselineDot1Y = this.baselinePhase === 0 ? -5 : 0;
      this.frame.baselineDot2Y = this.baselinePhase === 1 ? -5 : 0;
      this.frame.baselineDot3Y = this.baselinePhase === 2 ? -5 : 0;
      this.frame.baselineDot1Opacity = this.baselinePhase === 0 ? 1 : 0.36;
      this.frame.baselineDot2Opacity = this.baselinePhase === 1 ? 1 : 0.36;
      this.frame.baselineDot3Opacity = this.baselinePhase === 2 ? 1 : 0.36;
      this.baselineNextMs += this.baselineStepMs;
      if (this.baselineNextMs <= now) this.baselineNextMs = now + this.baselineStepMs;
      changed = true;
    }

    if (this.syncNextMs > 0 && this.syncNextMs <= now) {
      this.syncPhase = (this.syncPhase + 1) % 3;
      this.frame.dot1Opacity = this.syncPhase === 0 ? 1 : 0.34;
      this.frame.dot2Opacity = this.syncPhase === 1 ? 1 : 0.34;
      this.frame.dot3Opacity = this.syncPhase === 2 ? 1 : 0.34;
      this.syncNextMs += this.syncFrameMs;
      if (this.syncNextMs <= now) this.syncNextMs = now + this.syncFrameMs;
      changed = true;
    }

    if (this.heartResetMs > 0 && this.heartResetMs <= now) {
      this.frame.heartScale = 1;
      this.heartResetMs = 0;
      changed = true;
    }
    if (this.heartNextMs > 0 && this.heartNextMs <= now) {
      this.frame.heartScale = 1.04;
      this.heartResetMs = now + Math.min(140, Math.round(this.heartPeriodMs / 3));
      this.heartNextMs += this.heartPeriodMs;
      if (this.heartNextMs <= now) this.heartNextMs = now + this.heartPeriodMs;
      changed = true;
    }

    while (this.queue.length > 0 && this.queue[0].atMs <= now) {
      const event = this.queue.shift();
      if (this.effectTokens[event.channel] !== event.token) continue;
      Object.assign(this.frame, event.patch);
      changed = true;
    }

    if (changed && this.onFrame) this.onFrame(Object.assign({}, this.frame));
    this.schedule(token);
  }

  setChannels(nextChannels) {
    const next = nextChannels || {};
    const now = this.now();
    const breathe = Boolean(next.breathe);
    const baseline = Boolean(next.baseline);
    const sync = Boolean(next.sync);
    const heart = Boolean(next.heart);
    let changed = false;

    if (breathe !== this.channels.breathe) {
      this.channels.breathe = breathe;
      this.breatheNextMs = this.running && breathe ? now + this.breatheHalfMs : 0;
      if (!breathe) {
        this.breatheExpanded = false;
        this.frame.pulseScale = 1;
        this.frame.pulseOpacity = 0.56;
        this.frame.buddyBreathScale = 1;
      }
      changed = true;
    }
    if (baseline !== this.channels.baseline) {
      this.channels.baseline = baseline;
      this.baselineNextMs = this.running && baseline ? now + this.baselineStepMs : 0;
      if (baseline) this.baselinePhase = 2;
      if (!baseline) {
        this.baselinePhase = 2;
        this.frame.baselineDot1Y = 0;
        this.frame.baselineDot2Y = 0;
        this.frame.baselineDot3Y = 0;
        this.frame.baselineDot1Opacity = 0;
        this.frame.baselineDot2Opacity = 0;
        this.frame.baselineDot3Opacity = 0;
      }
      changed = true;
    }
    if (sync !== this.channels.sync) {
      this.channels.sync = sync;
      this.syncNextMs = this.running && sync ? now + this.syncFrameMs : 0;
      if (!sync) {
        this.syncPhase = 0;
        this.frame.dot1Opacity = 1;
        this.frame.dot2Opacity = 0.34;
        this.frame.dot3Opacity = 0.34;
      }
      changed = true;
    }
    if (heart !== this.channels.heart) {
      this.channels.heart = heart;
      this.heartNextMs = this.running && heart && this.heartPeriodMs > 0 ? now + this.heartPeriodMs : 0;
      if (!heart) {
        this.heartResetMs = 0;
        this.frame.heartScale = 1;
      }
      changed = true;
    }
    if (changed && this.running && this.onFrame) this.onFrame(Object.assign({}, this.frame));
    if (changed) this.rearm();
  }

  queueEffect(channel, durationMs, keyframes) {
    if (!this.running || !Array.isArray(keyframes) || keyframes.length === 0) return false;
    const token = (this.effectTokens[channel] || 0) + 1;
    this.effectTokens[channel] = token;
    this.queue = this.queue.filter((event) => event.channel !== channel);
    const startMs = this.now();
    keyframes.forEach((keyframe) => {
      this.queue.push({
        atMs: startMs + clamp(Number(keyframe.atMs) || 0, 0, durationMs),
        channel,
        token,
        patch: keyframe.patch || {},
      });
    });
    this.queue.sort((a, b) => a.atMs - b.atMs);
    this.rearm();
    return true;
  }

  triggerStartRing() {
    return this.queueEffect('startRing', 220, [
      { atMs: 0, patch: { startRingScale: 0.72, startRingOpacity: 0, startButtonScale: 1, startButtonOpacity: 1 } },
      { atMs: 80, patch: { startRingScale: 0.82, startRingOpacity: 0.96, startButtonScale: 0.72, startButtonOpacity: 0.45 } },
      { atMs: 150, patch: { startRingScale: 1.06, startRingOpacity: 0.70, startButtonScale: 0.80, startButtonOpacity: 0.68 } },
      { atMs: 220, patch: { startRingScale: 1.28, startRingOpacity: 0, startButtonScale: 1, startButtonOpacity: 1 } },
    ]);
  }

  triggerActivityPop(durationMs) {
    const duration = clamp(Number(durationMs) || 220, 180, 240);
    return this.queueEffect('activity', duration, [
      { atMs: 0, patch: { activityScale: 0.82, activityOpacity: 0.68 } },
      { atMs: Math.round(duration * 0.55), patch: { activityScale: 1.12, activityOpacity: 1 } },
      { atMs: duration, patch: { activityScale: 1, activityOpacity: 1 } },
    ]);
  }

  setHeartRate(bpm) {
    const period = heartRateIntervalMs(bpm);
    if (period === this.heartPeriodMs) return period;
    const now = this.now();
    this.heartPeriodMs = period;
    if (period <= 0) {
      this.heartNextMs = 0;
      this.heartResetMs = 0;
      this.frame.heartScale = 1;
    } else if (this.running && this.channels.heart) {
      if (this.heartNextMs <= 0 || this.heartNextMs - now > period) this.heartNextMs = now + period;
    }
    this.rearm();
    return period;
  }

  triggerRiskShake() {
    return this.queueEffect('risk', 300, [
      { atMs: 0, patch: { riskTranslateX: 0 } },
      { atMs: 60, patch: { riskTranslateX: -6 } },
      { atMs: 120, patch: { riskTranslateX: 6 } },
      { atMs: 180, patch: { riskTranslateX: -6 } },
      { atMs: 240, patch: { riskTranslateX: 6 } },
      { atMs: 300, patch: { riskTranslateX: 0 } },
    ]);
  }

  triggerGoalStars() {
    return this.queueEffect('goalStars', 700, [
      { atMs: 0, patch: { goalStarsScale: 0.72, goalStar1X: 0, goalStar1Y: 4, goalStar2X: 0, goalStar2Y: 4, goalStar3X: 0, goalStar3Y: 4, goalStar1Opacity: 0, goalStar2Opacity: 0, goalStar3Opacity: 0, goalMessageOpacity: 0 } },
      { atMs: 100, patch: { goalStarsScale: 1.04, goalStar1X: -5, goalStar1Y: -2, goalStar2X: 0, goalStar2Y: -4, goalStar3X: 5, goalStar3Y: -2, goalStar1Opacity: 1, goalStar2Opacity: 1, goalStar3Opacity: 1, goalMessageOpacity: 1 } },
      { atMs: 500, patch: { goalStarsScale: 1.10, goalStar1X: -22, goalStar1Y: -16, goalStar2X: 0, goalStar2Y: -24, goalStar3X: 22, goalStar3Y: -16, goalStar1Opacity: 0.68, goalStar2Opacity: 0.82, goalStar3Opacity: 0.68, goalMessageOpacity: 0.88 } },
      { atMs: 700, patch: { goalStarsScale: 1.14, goalStar1X: -30, goalStar1Y: -24, goalStar2X: 0, goalStar2Y: -32, goalStar3X: 30, goalStar3Y: -24, goalStar1Opacity: 0, goalStar2Opacity: 0, goalStar3Opacity: 0, goalMessageOpacity: 0 } },
    ]);
  }

  triggerPreciseStamp() {
    return this.queueEffect('preciseStamp', 320, [
      { atMs: 0, patch: { preciseStampScale: 0.72, preciseStampOpacity: 0 } },
      { atMs: 160, patch: { preciseStampScale: 1.08, preciseStampOpacity: 1 } },
      { atMs: 320, patch: { preciseStampScale: 1, preciseStampOpacity: 1 } },
    ]);
  }

  setPreciseVisible(visible) {
    this.frame.preciseStampScale = 1;
    this.frame.preciseStampOpacity = visible ? 1 : 0;
    if (this.running && this.onFrame) this.onFrame(Object.assign({}, this.frame));
  }

  clearTransientEffects(preciseVisible) {
    this.queue = [];
    this.effectTokens = {};
    const neutral = motionNeutralFrame(preciseVisible);
    Object.assign(this.frame, {
      startRingScale: neutral.startRingScale,
      startRingOpacity: neutral.startRingOpacity,
      startButtonScale: neutral.startButtonScale,
      startButtonOpacity: neutral.startButtonOpacity,
      baselineDot1Y: neutral.baselineDot1Y,
      baselineDot2Y: neutral.baselineDot2Y,
      baselineDot3Y: neutral.baselineDot3Y,
      baselineDot1Opacity: neutral.baselineDot1Opacity,
      baselineDot2Opacity: neutral.baselineDot2Opacity,
      baselineDot3Opacity: neutral.baselineDot3Opacity,
      activityScale: neutral.activityScale,
      activityOpacity: neutral.activityOpacity,
      riskTranslateX: neutral.riskTranslateX,
      goalStarsScale: neutral.goalStarsScale,
      goalStar1X: neutral.goalStar1X,
      goalStar1Y: neutral.goalStar1Y,
      goalStar2X: neutral.goalStar2X,
      goalStar2Y: neutral.goalStar2Y,
      goalStar3X: neutral.goalStar3X,
      goalStar3Y: neutral.goalStar3Y,
      goalStar1Opacity: neutral.goalStar1Opacity,
      goalStar2Opacity: neutral.goalStar2Opacity,
      goalStar3Opacity: neutral.goalStar3Opacity,
      goalMessageOpacity: neutral.goalMessageOpacity,
      preciseStampScale: neutral.preciseStampScale,
      preciseStampOpacity: neutral.preciseStampOpacity,
    });
    if (this.running && this.onFrame) this.onFrame(Object.assign({}, this.frame));
    this.rearm();
  }

  pause() {
    this.generation += 1;
    this.running = false;
    this.onFrame = null;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.breatheNextMs = 0;
    this.baselineNextMs = 0;
    this.syncNextMs = 0;
    this.heartNextMs = 0;
    this.heartResetMs = 0;
    this.breatheExpanded = false;
    this.baselinePhase = 2;
    this.syncPhase = 0;
    this.queue = [];
    this.effectTokens = {};
    this.frame = motionNeutralFrame(false);
  }

  isRunning() {
    return this.running;
  }
}
