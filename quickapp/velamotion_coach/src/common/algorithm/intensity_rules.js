import { CLASS_BG, CLASS_RUNNING, CLASS_JUMP_ROPE, CLASS_NAMES } from './config.js';

export function classifyHrZone(bpm) {
  if (!bpm) return { label: '--', color: '#94A3B8', level: 'unknown' };
  if (bpm < 95) return { label: '轻松', color: '#22C55E', level: 'easy' };
  if (bpm < 135) return { label: '有氧', color: '#38BDF8', level: 'aerobic' };
  if (bpm < 160) return { label: '高强度', color: '#F97316', level: 'hard' };
  return { label: '过高', color: '#EF4444', level: 'peak' };
}

export function buildCoachTip(result, sample) {
  if (!result || !result.smoothedProbs || result.smoothedProbs.length === 0) {
    return '正在收集 3 秒 IMU 窗口，保持自然运动。';
  }
  const bpm = sample && sample.heartRate;
  const zone = classifyHrZone(bpm);
  const cls = result.classIdx;

  if (zone.level === 'peak') {
    return '心率偏高，建议降速或进入恢复段。';
  }
  if (cls === CLASS_BG) {
    return zone.level === 'hard' ? '心率仍高但动作停止，注意主动恢复。' : '当前为恢复/静止状态。';
  }
  if (cls === CLASS_RUNNING && zone.level === 'easy') {
    return '跑步动作稳定，强度偏轻，可小幅提高节奏。';
  }
  if (cls === CLASS_RUNNING && zone.level === 'hard') {
    return '跑步进入高强度区，注意保持步频稳定。';
  }
  if (cls === CLASS_JUMP_ROPE && zone.level === 'hard') {
    return '跳绳冲击较强，注意手腕放松和落地节奏。';
  }
  return `${CLASS_NAMES[cls]}片段已稳定，继续保持当前节奏。`;
}

function avg(items, pick) {
  if (!items || items.length === 0) return 0;
  let sum = 0;
  let count = 0;
  items.forEach((it) => {
    const v = pick(it);
    if (v !== null && v !== undefined && !Number.isNaN(v)) {
      sum += v;
      count += 1;
    }
  });
  return count > 0 ? sum / count : 0;
}

function stepRate(points) {
  if (!points || points.length < 2) return 0;
  const first = points[0];
  const last = points[points.length - 1];
  const duration = Math.max(1, (last.elapsedSec || 0) - (first.elapsedSec || 0));
  return Math.max(0, ((last.stepCount || 0) - (first.stepCount || 0)) / duration);
}

function splitTrend(trendSamples) {
  const samples = (trendSamples || []).filter((it) => it && it.elapsedSec !== undefined);
  const recent = samples.slice(-8);
  const previous = samples.slice(-16, -8);
  return { recent, previous };
}

export function analyzeWorkoutRisk(result, sample, zone, trendSamples) {
  if (!result || result.warmupFraction < 1 || !sample) {
    return {
      key: 'collecting',
      level: 'info',
      title: '建立基线',
      message: '正在收集腕部动作与心率趋势。',
      color: '#64748B',
      bgColor: '#F1F5F9',
      shouldVibrate: false,
    };
  }

  const bpm = sample.heartRate || 0;
  const cls = result.classIdx;
  const { recent, previous } = splitTrend(trendSamples);
  const recentHr = avg(recent, (it) => it.bpm);
  const previousHr = avg(previous, (it) => it.bpm);
  const recentAcc = avg(recent, (it) => it.accStd);
  const previousAcc = avg(previous, (it) => it.accStd);
  const recentStepRate = stepRate(recent);
  const previousStepRate = stepRate(previous);
  const currentAcc = result.latestWindow && result.latestWindow.features
    ? Number(result.latestWindow.features.accStd)
    : recentAcc;
  const lowMotionEvidence = Number.isFinite(currentAcc)
    && currentAcc < 0.35
    && (recent.length < 4 || recentAcc < 0.45);
  const lowCadenceEvidence = recent.length < 2 || recentStepRate < 0.25;

  // The temporal smoother can briefly remain on background after a workout
  // starts. Require inertial and cadence evidence before calling it a true
  // static-high-HR event, otherwise running catch-up batches create a false
  // "静止高心率" alert.
  if (cls === CLASS_BG && bpm >= 135 && lowMotionEvidence && lowCadenceEvidence) {
    return {
      key: 'static_high_hr',
      level: 'danger',
      title: '静止高心率',
      message: '动作已停止但心率仍高，建议主动恢复并观察身体状态。',
      color: '#DC2626',
      bgColor: '#FEF2F2',
      shouldVibrate: true,
      mode: 'short',
    };
  }

  if (zone && zone.level === 'peak') {
    return {
      key: 'peak_hr',
      level: 'danger',
      title: '心率过高',
      message: '已进入过高心率区，建议立即降速或进入恢复段。',
      color: '#DC2626',
      bgColor: '#FEF2F2',
      shouldVibrate: true,
      mode: 'short',
    };
  }

  const enoughTrend = recent.length >= 6 && previous.length >= 6;
  const cadenceDrop = previousStepRate > 0.6 && recentStepRate < previousStepRate * 0.9;
  const amplitudeDrop = previousAcc > 0.4 && recentAcc < previousAcc * 0.82;
  const hrRising = recentHr >= 150 && (recentHr - previousHr >= 5 || recentHr >= 160);
  if (cls === CLASS_RUNNING && enoughTrend && hrRising && (cadenceDrop || amplitudeDrop)) {
    return {
      key: 'fatigue_running',
      level: 'warning',
      title: '疲劳风险',
      message: '心率升高但步频/动作幅度下降，建议降低配速或短暂恢复。',
      color: '#EA580C',
      bgColor: '#FFF7ED',
      shouldVibrate: true,
      mode: 'short',
    };
  }

  if (zone && zone.level === 'hard') {
    return {
      key: 'hard_hr',
      level: 'warning',
      title: '高强度',
      message: '当前处于高强度区，注意控制节奏和呼吸。',
      color: '#F97316',
      bgColor: '#FFF7ED',
      shouldVibrate: true,
      mode: 'short',
    };
  }

  if (cls === CLASS_BG) {
    return {
      key: 'recovery',
      level: 'ok',
      title: '恢复状态',
      message: '动作较低，适合观察心率回落。',
      color: '#16A34A',
      bgColor: '#F0FDF4',
      shouldVibrate: false,
    };
  }

  return {
    key: 'stable',
    level: 'ok',
    title: '节奏稳定',
    message: `${CLASS_NAMES[cls]}识别稳定，继续保持当前节奏。`,
    color: '#16A34A',
    bgColor: '#F0FDF4',
    shouldVibrate: false,
  };
}

export function buildSummary(result, elapsedSec, sample) {
  const stats = result && result.stats ? result.stats : { totalSec: elapsedSec || 0, byClass: {} };
  const byClass = stats.byClass || {};
  let activeSec = 0;
  Object.keys(byClass).forEach((k) => {
    if (String(k) !== '0') activeSec += byClass[k];
  });
  const bpm = sample && sample.heartRate ? Math.round(sample.heartRate) : '--';
  const zone = classifyHrZone(sample && sample.heartRate);
  return {
    totalSec: Math.max(elapsedSec || 0, stats.totalSec || 0),
    activeSec,
    segmentCount: result && result.segments ? result.segments.length : 0,
    byClass,
    bpm,
    zoneLabel: zone.label,
    zoneColor: zone.color,
  };
}
