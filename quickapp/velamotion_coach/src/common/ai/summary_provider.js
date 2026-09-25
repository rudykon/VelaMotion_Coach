function loadVelaclaw() {
  try {
    if (typeof require === 'function') {
      const mod = require('@system.velaclaw');
      return mod && mod.default ? mod.default : mod;
    }
  } catch (e) {
    console.log(`velaclaw dynamic load failed: ${e && e.message ? e.message : e}`);
  }
  return null;
}

function safeFormatSec(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

function listTopActivities(rows) {
  const src = (rows || []).filter((it) => it && it.name && it.percent && it.percent !== '--');
  if (src.length === 0) return '暂无稳定运动片段';
  return src.slice(0, 3).map((it) => `${it.name}${it.percent}`).join('，');
}

function latestRiskText(risks) {
  const src = risks || [];
  if (src.length === 0) return '未记录疲劳或异常风险';
  const last = src[src.length - 1];
  return `${last.title || '风险提醒'}：${last.message || '建议关注训练强度'}`;
}

export function buildLocalAiSummary(payload) {
  const summary = payload && payload.summary ? payload.summary : {};
  const rows = payload && payload.activityShareRows ? payload.activityShareRows : [];
  const risks = payload && payload.riskEvents ? payload.riskEvents : [];
  const total = safeFormatSec(summary.totalSec);
  const active = safeFormatSec(summary.activeSec);
  const segmentCount = summary.segmentCount || 0;
  const zone = summary.zoneLabel || '未知强度';
  const scene = payload && payload.sceneName ? payload.sceneName : '当前训练';
  const riskLine = latestRiskText(risks);
  const activityLine = listTopActivities(rows);

  if (risks.length > 0) {
    return `${scene}已完成 ${total}，活跃 ${active}，识别 ${segmentCount} 个片段。主要运动占比：${activityLine}。当前强度为${zone}，${riskLine}。建议下次训练先控制节奏，再逐步提高强度。`;
  }
  return `${scene}已完成 ${total}，活跃 ${active}，识别 ${segmentCount} 个片段。主要运动占比：${activityLine}。当前强度为${zone}，未发现明显疲劳或异常风险，可保持当前训练节奏。`;
}

function buildPrompt(payload) {
  const summary = payload && payload.summary ? payload.summary : {};
  const rows = payload && payload.activityShareRows ? payload.activityShareRows : [];
  const risks = payload && payload.riskEvents ? payload.riskEvents : [];
  return [
    '你是智能手表上的运动教练，请用中文给出 80 字以内训练总结。',
    '要求：具体、克制、面向普通用户，不给医疗诊断。',
    `训练场景：${payload && payload.sceneName ? payload.sceneName : '当前训练'}`,
    `总时长：${safeFormatSec(summary.totalSec)}`,
    `活跃时长：${safeFormatSec(summary.activeSec)}`,
    `片段数：${summary.segmentCount || 0}`,
    `强度：${summary.zoneLabel || '未知'}`,
    `运动占比：${listTopActivities(rows)}`,
    `风险：${latestRiskText(risks)}`,
  ].join('\n');
}

function normalizeResponse(res) {
  if (!res) return '';
  if (typeof res === 'string') return res;
  if (res.answer) return res.answer;
  if (res.result) return res.result;
  if (res.text) return res.text;
  if (res.data && typeof res.data === 'string') return res.data;
  if (res.data && res.data.answer) return res.data.answer;
  return '';
}

export function requestAiSummary(payload, callback) {
  const fallback = buildLocalAiSummary(payload);
  const callbackFn = callback || function noop() {};
  let completed = false;
  let timeoutId = null;
  const done = (result) => {
    if (completed) return;
    completed = true;
    if (timeoutId) clearTimeout(timeoutId);
    callbackFn(result);
  };
  const prompt = buildPrompt(payload);
  try {
    const velaclaw = loadVelaclaw();
    if (!velaclaw || !velaclaw.ask) {
      done({ ok: false, source: '本地总结', text: fallback, error: 'velaclaw unavailable' });
      return;
    }
    timeoutId = setTimeout(() => {
      done({ ok: false, source: '本地总结', text: fallback, error: 'velaclaw timeout' });
    }, 10000);
    const maybePromise = velaclaw.ask({
      query: prompt,
      success: (res) => {
        const text = normalizeResponse(res) || fallback;
        done({ ok: true, source: 'velaclaw', text });
      },
      fail: (data, code) => {
        done({ ok: false, source: '本地总结', text: fallback, error: code || data || 'velaclaw failed' });
      },
      complete: () => {},
    });
    if (maybePromise && maybePromise.then) {
      maybePromise
        .then((res) => done({ ok: true, source: 'velaclaw', text: normalizeResponse(res) || fallback }))
        .catch((err) => done({ ok: false, source: '本地总结', text: fallback, error: err && err.message ? err.message : err }));
    }
  } catch (e) {
    done({ ok: false, source: '本地总结', text: fallback, error: e && e.message ? e.message : e });
  }
}
