function segment(mode, duration, hr0, hr1, label) {
  return { mode, duration, hr0, hr1, label: label || mode };
}

export const SCENARIOS = [
  {
    id: 'mixed_workout',
    name: '混合训练',
    description: '静止 → 跑步 → 跳绳 → 羽毛球 → 乒乓球 → 恢复，适合完整演示 TRL 时间线。',
    segments: [
      segment('rest', 6, 72, 78, '准备'),
      segment('running', 14, 95, 148, '跑步'),
      segment('jump_rope', 12, 132, 158, '跳绳'),
      segment('badminton', 12, 128, 152, '羽毛球'),
      segment('pingpong', 10, 118, 140, '乒乓球'),
      segment('rest', 8, 132, 105, '恢复'),
    ],
  },
  {
    id: 'running',
    name: '跑步节奏',
    description: '稳定跑步 + 心率上升，用于展示配速/强度提醒。',
    segments: [segment('rest', 5, 72, 78, '准备'), segment('running', 32, 98, 155, '跑步'), segment('rest', 8, 130, 105, '放松')],
  },
  {
    id: 'fatigue_running',
    name: '疲劳跑步',
    description: '后半程动作幅度下降但心率偏高，用于展示疲劳提醒。',
    segments: [segment('rest', 5, 72, 78, '准备'), segment('running', 16, 100, 145, '正常跑'), segment('fatigue_run', 18, 148, 168, '疲劳跑'), segment('rest', 8, 150, 118, '恢复')],
  },
  {
    id: 'jump_rope',
    name: '跳绳',
    description: '高冲击、较规则的上下振动。',
    segments: [segment('rest', 5, 70, 78, '准备'), segment('jump_rope', 28, 105, 160, '跳绳'), segment('rest', 8, 140, 110, '恢复')],
  },
  {
    id: 'static',
    name: '静坐/睡眠',
    description: '低 IMU 能量，验证无活动识别和低误报。',
    segments: [segment('rest', 45, 58, 72, '静坐')],
  },
  {
    id: 'badminton',
    name: '羽毛球',
    description: '侧向爆发与快速挥拍，用于单类别算法回归测试。',
    segments: [segment('rest', 5, 72, 80, '准备'), segment('badminton', 30, 105, 152, '羽毛球'), segment('rest', 8, 128, 105, '恢复')],
  },
  {
    id: 'pingpong',
    name: '乒乓球',
    description: '高频腕部旋转与较小平移，用于单类别算法回归测试。',
    segments: [segment('rest', 5, 72, 80, '准备'), segment('pingpong', 30, 100, 142, '乒乓球'), segment('rest', 8, 122, 102, '恢复')],
  },
  {
    id: 'flying',
    name: '飞鸟',
    description: '低频周期性抬臂，用于单类别算法回归测试。',
    segments: [segment('rest', 5, 72, 78, '准备'), segment('flying', 30, 88, 128, '飞鸟'), segment('rest', 8, 112, 96, '恢复')],
  },
];

export function getScenario(id) {
  return SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
}

export function scenarioDuration(scene) {
  return scene.segments.reduce((sum, s) => sum + s.duration, 0);
}

export function locateSegment(sceneId, elapsedSec) {
  const scene = getScenario(sceneId);
  const duration = scenarioDuration(scene);
  const t = duration > 0 ? elapsedSec % duration : elapsedSec;
  let acc = 0;
  for (let i = 0; i < scene.segments.length; i++) {
    const seg = scene.segments[i];
    if (t < acc + seg.duration) {
      const localSec = t - acc;
      const progress = seg.duration > 0 ? localSec / seg.duration : 0;
      return { scene, segment: seg, localSec, progress, elapsedInLoop: t };
    }
    acc += seg.duration;
  }
  const last = scene.segments[scene.segments.length - 1];
  return { scene, segment: last, localSec: last.duration, progress: 1, elapsedInLoop: t };
}

function wave(t, hz, phase) {
  return Math.sin(2 * Math.PI * hz * t + (phase || 0));
}

function pulse(t, hz) {
  return Math.pow(Math.max(0, wave(t, hz, 0)), 4);
}

function noise(scale) {
  return (Math.random() * 2 - 1) * scale;
}

function interp(a, b, p) {
  return a + (b - a) * Math.max(0, Math.min(1, p));
}

export function stepRateForMode(mode) {
  if (mode === 'running') return 2.55;
  if (mode === 'fatigue_run') return 2.05;
  if (mode === 'jump_rope') return 2.15;
  return 0;
}

export function sampleMotionFrame(sceneId, elapsedSec, stepCount) {
  const located = locateSegment(sceneId, elapsedSec);
  const seg = located.segment;
  const t = located.localSec;
  const mode = seg.mode;
  let accX = noise(0.03);
  let accY = noise(0.03);
  let accZ = 9.81 + noise(0.04);
  let gyroX = noise(0.015);
  let gyroY = noise(0.015);
  let gyroZ = noise(0.015);

  if (mode === 'running') {
    accX += 1.3 * wave(t, 1.28, 0.6);
    accY += 0.9 * wave(t, 2.55, 1.2);
    accZ += 3.7 * wave(t, 2.55, 0) + 0.9 * wave(t, 5.1, 0.4);
    gyroX += 0.55 * wave(t, 2.55, 1.1);
    gyroY += 1.25 * wave(t, 2.55, 0.3);
    gyroZ += 0.35 * wave(t, 1.28, 0.2);
  } else if (mode === 'fatigue_run') {
    accX += 0.9 * wave(t, 1.03, 0.6);
    accY += 0.6 * wave(t, 2.05, 1.2);
    accZ += 2.4 * wave(t, 2.05, 0) + 0.5 * wave(t, 4.1, 0.4);
    gyroX += 0.38 * wave(t, 2.05, 1.1);
    gyroY += 0.75 * wave(t, 2.05, 0.3);
    gyroZ += 0.25 * wave(t, 1.03, 0.2);
  } else if (mode === 'jump_rope') {
    const p = pulse(t, 2.15);
    accX += 0.45 * wave(t, 2.15, 0.2);
    accY += 0.35 * wave(t, 2.15, 1.1);
    accZ += 7.5 * p - 1.0 * wave(t, 2.15, 0.7);
    gyroX += 0.28 * wave(t, 2.15, 0.5);
    gyroY += 0.45 * wave(t, 2.15, 0.9);
    gyroZ += 0.18 * wave(t, 4.3, 0.2);
  } else if (mode === 'badminton') {
    const b = pulse(t + 0.12, 1.25);
    accX += 1.5 * wave(t, 1.25, 0.3) + 4.2 * b * wave(t, 7.0, 0.1);
    accY += 1.1 * wave(t, 1.25, 1.7) + 2.8 * b * wave(t, 5.0, 1.2);
    accZ += 1.1 * wave(t, 1.25, 0.8) + 1.3 * b;
    gyroX += 2.0 * b * wave(t, 6.5, 0.2);
    gyroY += 5.6 * b * wave(t, 5.5, 0.4);
    gyroZ += 3.8 * b * wave(t, 4.5, 1.1);
  } else if (mode === 'pingpong') {
    const wrist = wave(t, 4.7, 0.3);
    const gate = Math.max(0.18, Math.pow(Math.max(0, wave(t, 2.35, 0)), 2));
    accX += 0.55 * wave(t, 4.7, 0.1);
    accY += 0.45 * wave(t, 4.7, 1.4);
    accZ += 0.35 * wave(t, 2.35, 0.8);
    gyroX += 0.8 * gate * wave(t, 4.7, 1.2);
    gyroY += 0.9 * gate * wave(t, 4.7, 0.4);
    gyroZ += 3.0 * gate * wrist;
  } else if (mode === 'flying') {
    accX += 1.8 * wave(t, 0.68, 0.1);
    accY += 1.2 * wave(t, 0.68, 1.4);
    accZ += 0.85 * wave(t, 1.36, 0.4);
    gyroX += 1.25 * wave(t, 0.68, 1.1);
    gyroY += 0.8 * wave(t, 0.68, 0.5);
    gyroZ += 0.35 * wave(t, 1.36, 0.2);
  }

  const heartRate = interp(seg.hr0, seg.hr1, located.progress) + noise(1.5);
  const spo2 = mode === 'rest' ? 97 + noise(0.8) : 96 + noise(1.0);
  const stress = mode === 'rest' ? 18 + noise(4) : 35 + Math.max(0, heartRate - 100) * 0.28 + noise(5);

  return {
    accX,
    accY,
    accZ,
    gyroX,
    gyroY,
    gyroZ,
    heartRate,
    spo2,
    stress: Math.max(1, Math.min(99, stress)),
    stepCount,
    mockLabel: seg.label,
    mockMode: mode,
    sceneName: located.scene.name,
  };
}
