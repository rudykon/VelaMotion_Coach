export const HISTORY_CLEAR_ACTIONS = {
  EMPTY: 'empty',
  BUSY: 'busy',
  ARM: 'arm',
  CONFIRM: 'confirm',
};

export function wrappedPageIndex(current, delta, count) {
  const total = Math.max(1, Math.floor(Number(count) || 0));
  const index = Math.floor(Number(current) || 0);
  const step = Math.floor(Number(delta) || 0);
  return ((index + step) % total + total) % total;
}

export function historyClearAction(options) {
  const state = options || {};
  if (!state.hasItems) return HISTORY_CLEAR_ACTIONS.EMPTY;
  if (state.busy) return HISTORY_CLEAR_ACTIONS.BUSY;
  return state.armed ? HISTORY_CLEAR_ACTIONS.CONFIRM : HISTORY_CLEAR_ACTIONS.ARM;
}

export function syncActionPermission(options) {
  const state = options || {};
  if (state.busy) return { allowed: false, feedback: '请稍候', reason: 'busy' };
  if (state.action === 'send' && state.isRunning) {
    return { allowed: false, feedback: '先停止', reason: 'training' };
  }
  if (state.action === 'send' && !state.hasRecord) {
    return { allowed: false, feedback: '无记录', reason: 'empty' };
  }
  return { allowed: true, feedback: '', reason: 'allowed' };
}
