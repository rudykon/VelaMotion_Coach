import { MockSensorProvider } from '../src/common/sensor/mock_sensor_provider.js';
import { MotionEngine } from '../src/common/algorithm/motion_engine.js';
import {
  CLASS_BG,
  CLASS_BADMINTON,
  CLASS_JUMP_ROPE,
  CLASS_FLYING,
  CLASS_RUNNING,
  CLASS_PINGPONG,
} from '../src/common/algorithm/config.js';
import { classifyHrZone, analyzeWorkoutRisk } from '../src/common/algorithm/intensity_rules.js';

function setSeed(nextSeed) {
  let seed = nextSeed;
  Math.random = function random() {
    seed = (1103515245 * seed + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

function runScene(sceneId, seconds, startOffsetSec = 0) {
  const engine = new MotionEngine();
  const provider = new MockSensorProvider();
  let result = null;
  provider.start(sceneId, (batch) => {
    result = engine.addSamples(batch);
  }, { startOffsetSec });
  if (provider.timer) clearTimeout(provider.timer);
  provider.timer = null;

  const ticks = Math.ceil((seconds * 1000) / provider.tickMs);
  for (let i = 0; i < ticks; i++) {
    provider.emitTick();
    if (provider.timer) clearTimeout(provider.timer);
    provider.timer = null;
  }
  provider.stop();
  return result;
}

function runSceneWithRisks(sceneId, seconds, startOffsetSec = 0) {
  const engine = new MotionEngine();
  const provider = new MockSensorProvider();
  let result = null;
  let sessionStartMs = 0;
  let lastTrendSec = -1;
  const trend = [];
  const risks = [];

  provider.start(sceneId, (batch) => {
    result = engine.addSamples(batch);
    const sample = batch[batch.length - 1];
    if (!sessionStartMs) sessionStartMs = batch[0].timeStamp;
    const elapsedSec = Math.floor((sample.timeStamp - sessionStartMs) / 1000);
    if (elapsedSec !== lastTrendSec) {
      lastTrendSec = elapsedSec;
      const zone = classifyHrZone(sample.heartRate);
      const features = result && result.latestWindow && result.latestWindow.features ? result.latestWindow.features : {};
      trend.push({
        elapsedSec,
        bpm: Math.round(sample.heartRate || 0),
        stepCount: sample.stepCount || 0,
        accStd: features.accStd || 0,
        color: zone.color,
      });
      const risk = analyzeWorkoutRisk(result, sample, zone, trend);
      if (risk && risk.key) risks.push(risk.key);
    }
  }, { startOffsetSec });
  if (provider.timer) clearTimeout(provider.timer);
  provider.timer = null;

  const ticks = Math.ceil((seconds * 1000) / provider.tickMs);
  for (let i = 0; i < ticks; i++) {
    provider.emitTick();
    if (provider.timer) clearTimeout(provider.timer);
    provider.timer = null;
  }
  provider.stop();
  return { result, risks, trend };
}

function hasSegment(result, classIdx, minDurationSec) {
  return (result.segments || []).some((seg) => seg.classIdx === classIdx && seg.durationSec >= minDurationSec);
}

function assertCase(name, ok, detail) {
  if (!ok) {
    console.error(`[motion-smoke] FAIL ${name}: ${detail}`);
    process.exitCode = 1;
  } else {
    console.log(`[motion-smoke] PASS ${name}: ${detail}`);
  }
}

const seeds = [7, 42, 99, 123456789, 20260728];

for (let i = 0; i < seeds.length; i++) {
  setSeed(seeds[i]);
  const staticResult = runScene('static', 24);
  assertCase(
    `static stays background seed=${seeds[i]}`,
    staticResult.classIdx === CLASS_BG && staticResult.segments.length === 0,
    `class=${staticResult.className}, confidence=${staticResult.confidence.toFixed(2)}, segments=${staticResult.segments.length}`,
  );
}

for (let i = 0; i < seeds.length; i++) {
  [5.2, 7.0, 9.5].forEach((offset) => {
    setSeed(seeds[i]);
    const runningResult = runScene('running', 20, offset);
    assertCase(
      `running active segment seed=${seeds[i]} offset=${offset}`,
      runningResult.classIdx === CLASS_RUNNING && runningResult.confidence >= 0.55 && hasSegment(runningResult, CLASS_RUNNING, 12),
      `class=${runningResult.className}, confidence=${runningResult.confidence.toFixed(2)}, segments=${JSON.stringify(runningResult.segments)}`,
    );
  });
}

for (let i = 0; i < seeds.length; i++) {
  [5.2, 7.0, 9.5].forEach((offset) => {
    setSeed(seeds[i]);
    const jumpResult = runScene('jump_rope', 20, offset);
    assertCase(
      `jump rope active segment seed=${seeds[i]} offset=${offset}`,
      jumpResult.classIdx === CLASS_JUMP_ROPE && jumpResult.confidence >= 0.55 && hasSegment(jumpResult, CLASS_JUMP_ROPE, 12),
      `class=${jumpResult.className}, confidence=${jumpResult.confidence.toFixed(2)}, segments=${JSON.stringify(jumpResult.segments)}`,
    );
  });
}

const isolatedCases = [
  { sceneId: 'badminton', classIdx: CLASS_BADMINTON, name: 'badminton', minConfidence: 0.45 },
  { sceneId: 'pingpong', classIdx: CLASS_PINGPONG, name: 'ping-pong', minConfidence: 0.45 },
  { sceneId: 'flying', classIdx: CLASS_FLYING, name: 'flying', minConfidence: 0.40 },
];

isolatedCases.forEach((testCase) => {
  seeds.forEach((seed) => {
    setSeed(seed);
    const result = runScene(testCase.sceneId, 22, 6.0);
    assertCase(
      `${testCase.name} active segment seed=${seed}`,
      result.classIdx === testCase.classIdx && result.confidence >= testCase.minConfidence && hasSegment(result, testCase.classIdx, 12),
      `class=${result.className}, confidence=${result.confidence.toFixed(2)}, segments=${JSON.stringify(result.segments)}`,
    );
  });
});

setSeed(123456789);
const mixedResult = runScene('mixed_workout', 42);
assertCase('mixed workout has running', hasSegment(mixedResult, CLASS_RUNNING, 10), `segments=${JSON.stringify(mixedResult.segments)}`);
assertCase('mixed workout has jump rope', hasSegment(mixedResult, CLASS_JUMP_ROPE, 8), `segments=${JSON.stringify(mixedResult.segments)}`);


setSeed(20260728);
const fatigueCheck = runSceneWithRisks('fatigue_running', 42);
assertCase(
  'fatigue running emits visible risk',
  fatigueCheck.risks.includes('fatigue_running') || fatigueCheck.risks.includes('peak_hr'),
  `risks=${JSON.stringify(fatigueCheck.risks.slice(-12))}, class=${fatigueCheck.result.className}`,
);

if (process.exitCode) process.exit(process.exitCode);
console.log('[motion-smoke] all checks passed');
