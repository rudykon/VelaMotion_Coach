// Core constants ported from the existing Android/Python pipeline.
// The source pipeline acquires ACC/GYRO at 100 Hz. The wearable runtime uses
// a 16 Hz inference stream. Its 8 Hz Nyquist limit still covers the modeled
// wrist-motion bands (up to about 4.7 Hz), while keeping QuickJS responsive on
// the watch emulator and reducing device-side compute/power.
export const SOURCE_SAMPLE_RATE_HZ = 100;
export const SAMPLE_RATE_HZ = 16;
export const SAMPLE_PERIOD_MS = 1000 / SAMPLE_RATE_HZ;
export const CHANNELS = 6;

export const WINDOW_SEC = 3;
export const WINDOW_SIZE = WINDOW_SEC * SAMPLE_RATE_HZ;
export const STEP_SEC = 1;
export const STEP_SIZE = STEP_SEC * SAMPLE_RATE_HZ;

// The paper version uses 180s minimum output segments for offline evaluation.
// The contest demo must show state transitions within one minute, so this value
// is intentionally shortened while keeping the same post-processing structure.
export const DEMO_MIN_SEGMENT_SEC = 5;
export const DEMO_SHORT_GAP_SEC = 2;
export const CONF_MIN = 0.30;

export const AVG_SMOOTH_SIZE = 7;
export const MEDIAN_SIZE = 5;

export const CLASS_NAMES = ['无活动', '羽毛球', '跳绳', '飞鸟', '跑步', '乒乓球'];
// The watch simulator's bundled font does not cover most color emoji.  Keep
// the existing API name for compatibility, but use compact CJK activity marks
// so every class remains legible on-device instead of rendering tofu boxes.
export const CLASS_EMOJIS = ['静', '羽', '绳', '飞', '跑', '乒'];
export const CLASS_COLORS = ['#94A3B8', '#EF4444', '#10B981', '#3B82F6', '#16755A', '#8B5CF6'];

export const CLASS_BG = 0;
export const CLASS_BADMINTON = 1;
export const CLASS_JUMP_ROPE = 2;
export const CLASS_FLYING = 3;
export const CLASS_RUNNING = 4;
export const CLASS_PINGPONG = 5;

// Existing 3s normalization parameters kept as traceability metadata.  The JS
// demo classifier below is feature/rule based rather than ONNX based, but the
// interface is shaped so it can later be replaced by a native/ONNX inference
// bridge without changing the page or TRL code.
export const NORM_PARAMS_3S = {
  mean: [1915.136445926244, -2222.7754116186634, -92.94102150871045, -69.23744962489933, -48.88914174075672, -0.9113457644647055],
  std: [3189.904663188159, 2601.0831826462727, 2464.1609405096888, 1879.8900739939795, 1536.0500336551013, 1561.1619017886628],
};

export function className(idx) {
  return CLASS_NAMES[idx] || '未知';
}

export function classEmoji(idx) {
  return CLASS_EMOJIS[idx] || '?';
}

export function classColor(idx) {
  return CLASS_COLORS[idx] || '#64748B';
}
