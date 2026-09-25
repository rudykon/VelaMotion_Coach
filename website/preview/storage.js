// Separate, in-memory preview history. No device storage, cookies or uploads.
const values = new Map();
function complete(options, value) {
  queueMicrotask(() => { options.success?.(value); options.complete?.(); });
}
export default {
  get(options) { complete(options, values.get(options.key) ?? options.default ?? ''); },
  set(options) { values.set(options.key, options.value); complete(options); },
  delete(options) { values.delete(options.key); complete(options); },
};
