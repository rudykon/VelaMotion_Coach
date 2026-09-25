function loadInterconnect() {
  try {
    if (typeof require === 'function') {
      const mod = require('@system.interconnect');
      const api = mod && mod.default ? mod.default : mod;
      // Official openvela usage obtains the singleton connection first, then
      // calls diagnosis/send on that connection object.
      return api && api.instance ? api.instance() : api;
    }
  } catch (e) {
    console.log(`interconnect dynamic load failed: ${e && e.message ? e.message : e}`);
  }
  return null;
}

function onceCallback(callback) {
  let completed = false;
  return (result) => {
    if (completed) return;
    completed = true;
    if (callback) callback(result);
  };
}

function sessionToPayload(session) {
  const summary = session && session.summary ? session.summary : {};
  return {
    type: 'velamotion.session.summary',
    version: 1,
    generatedAt: Date.now(),
    sceneId: session && session.sceneId,
    savedAt: session && session.savedAt,
    totalSec: summary.totalSec || 0,
    activeSec: summary.activeSec || 0,
    segmentCount: summary.segmentCount || 0,
    riskCount: summary.riskCount || 0,
    riskLabel: summary.riskLabel || '无风险',
    bpm: summary.bpm || '--',
    zoneLabel: summary.zoneLabel || '--',
    activityShares: summary.activityShares || [],
    risks: session && session.risks ? session.risks : [],
  };
}

export function buildExportText(session) {
  const payload = sessionToPayload(session || {});
  return JSON.stringify(payload);
}

export function buildExportPreview(session) {
  const text = buildExportText(session || {});
  return text.length > 150 ? `${text.slice(0, 150)}...` : text;
}

export function diagnosePhoneLink(callback) {
  const done = onceCallback(callback);
  try {
    const interconnect = loadInterconnect();
    if (!interconnect || !interconnect.diagnosis) {
      done({ ok: false, statusText: '互联不可用', detail: 'system.interconnect unavailable' });
      return;
    }
    interconnect.diagnosis({
      timeout: 3000,
      success: (data) => {
        const status = data && data.status;
        done({ ok: status === 0, statusText: status === 0 ? '手机已连接' : `未连接 ${status}`, detail: `diagnosis=${status}` });
      },
      fail: (data, code) => done({ ok: false, statusText: '手机未连接', detail: `code=${code}` }),
    });
  } catch (e) {
    done({ ok: false, statusText: '互联异常', detail: e && e.message ? e.message : String(e) });
  }
}

export function sendSessionToPhone(session, callback) {
  const payload = sessionToPayload(session || {});
  const done = onceCallback(callback);
  try {
    const interconnect = loadInterconnect();
    if (!interconnect || !interconnect.send) {
      done({ ok: false, statusText: '互联不可用', detail: 'system.interconnect unavailable', payload });
      return;
    }
    interconnect.send({
      data: payload,
      success: () => done({ ok: true, statusText: '已发送到手机', detail: 'interconnect.send success', payload }),
      fail: (data, code) => done({ ok: false, statusText: '发送失败', detail: `code=${code}`, payload }),
    });
  } catch (e) {
    done({ ok: false, statusText: '发送异常', detail: e && e.message ? e.message : String(e), payload });
  }
}

function parseInboundMessage(event) {
  const raw = event && Object.prototype.hasOwnProperty.call(event, 'data')
    ? event.data
    : event;
  if (typeof raw !== 'string') return raw && typeof raw === 'object' ? raw : null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

export function subscribePhoneMessages(callback) {
  if (typeof callback !== 'function') return () => {};
  let interconnect = null;
  try {
    interconnect = loadInterconnect();
  } catch (e) {
    interconnect = null;
  }
  if (!interconnect) return () => {};

  const previous = interconnect.onmessage;
  const handler = (event) => {
    const payload = parseInboundMessage(event);
    if (payload) callback(payload);
  };
  try {
    // The Vela connection singleton exposes onmessage as an assignable event
    // callback. Sending success is not a result acknowledgement; only an
    // inbound payload can advance the watch to a precise-review state.
    interconnect.onmessage = handler;
  } catch (e) {
    return () => {};
  }

  return () => {
    try {
      if (interconnect && interconnect.onmessage === handler) {
        interconnect.onmessage = previous || null;
      }
    } catch (e) {}
    interconnect = null;
  };
}
