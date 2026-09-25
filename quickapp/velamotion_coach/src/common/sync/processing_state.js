export const PROCESSING_STATES = {
  WATCH_SCREENING: 'watch_screening',
  PENDING_SYNC: 'pending_sync',
  AWAITING_PRECISE: 'awaiting_precise',
  PHONE_PRECISE: 'phone_precise',
};

const STATE_VIEW = {
  watch_screening: {
    text: '腕上初筛',
    detail: '端侧轻量识别，不上传原始流',
    color: '#2563EB',
  },
  pending_sync: {
    text: '待同步',
    detail: '表端摘要已保存，可发送手机精算',
    color: '#62A9E8',
  },
  awaiting_precise: {
    text: '待同步',
    detail: '已发手机 / 等待精确结果',
    color: '#7C3AED',
  },
  phone_precise: {
    text: '手机精确复盘',
    detail: '已确认手机返回的精确结果',
    color: '#059669',
  },
};

export function processingStateView(key, detail) {
  const safeKey = STATE_VIEW[key] ? key : PROCESSING_STATES.WATCH_SCREENING;
  const base = STATE_VIEW[safeKey];
  return {
    key: safeKey,
    text: base.text,
    detail: detail || base.detail,
    color: base.color,
  };
}

export function preciseResultAcceptance(options) {
  const state = options || {};
  if (state.isRunning) return { allowed: false, reason: 'training_active' };
  if (state.processingStateKey !== PROCESSING_STATES.AWAITING_PRECISE) {
    return { allowed: false, reason: 'not_awaiting_precise' };
  }
  if (!state.hasPendingRecord) return { allowed: false, reason: 'no_pending_record' };
  return { allowed: true, reason: 'awaiting_precise' };
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizedScales(scales) {
  if (!Array.isArray(scales)) return [];
  return scales.map((value) => {
    const normalized = typeof value === 'string' ? value.replace(/s$/i, '') : value;
    return Number(normalized);
  }).filter((value) => Number.isFinite(value));
}

export function inspectPreciseResult(payload) {
  if (!payload || typeof payload !== 'object') return { status: 'invalid', result: null };
  if (payload.type !== 'velamotion.session.precise_result' || Number(payload.version) !== 1) {
    return { status: 'invalid', result: null };
  }
  const precise = payload.preciseResult;
  if (!precise || typeof precise !== 'object') return { status: 'invalid', result: null };
  const scalesUsed = normalizedScales(precise.scalesUsed);
  const completeScaleSet = precise.completeScaleSet === true
    && [3, 5, 8].every((scale) => scalesUsed.includes(scale));
  if (!completeScaleSet) return { status: 'degraded', result: null, scalesUsed };
  const summary = precise.summary && typeof precise.summary === 'object'
    ? precise.summary
    : precise;
  return { status: 'confirmed', result: {
    receivedAt: Date.now(),
    totalSec: finiteOrNull(summary.totalSec),
    activeSec: finiteOrNull(summary.activeSec),
    segmentCount: finiteOrNull(summary.segmentCount),
    riskCount: finiteOrNull(summary.riskCount),
    activityShares: Array.isArray(summary.activityShares) ? summary.activityShares : null,
    segments: Array.isArray(precise.segments) ? precise.segments : null,
    aiSummary: typeof precise.aiSummary === 'string' ? precise.aiSummary : '',
    scalesUsed,
    completeScaleSet: true,
  } };
}

export function confirmedPreciseResult(payload) {
  return inspectPreciseResult(payload).result;
}
