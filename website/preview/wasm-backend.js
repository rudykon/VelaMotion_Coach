export const FEATURE_KEYS = ['accMean','accStd','accRange','accRms','gyroMean','gyroStd','gyroRange','gyroRms','accXStd','accYStd','accZStd','gyroXStd','gyroYStd','gyroZStd','gyroZcr','gyroXcr','accPeakRate','gyroPeakRate','fastPeriod','slowPeriod','gyroDominance','lateralEnergy','durationSec'];
const AXES = ['accX','accY','accZ','gyroX','gyroY','gyroZ'];
export function createWasmBackend(engine, onClassified = () => {}) {
  if (engine.abi_version() !== 1 || engine.window_size() !== 48) throw new Error('WASM 接口不匹配');
  return { classifyWindow({ samples, context }) {
    if (samples.length !== 48) throw new Error('WASM 窗口长度不匹配');
    const input = new Float64Array(engine.memory.buffer, engine.input_ptr(), 288);
    samples.forEach((frame, i) => AXES.forEach((axis, j) => { input[i * 6 + j] = Number(frame[axis]); }));
    const before = performance.now();
    const classIdx = engine.classify(context?.heartRate || 0);
    const ms = performance.now() - before;
    const values = new Float64Array(engine.memory.buffer, engine.features_ptr(), FEATURE_KEYS.length);
    const features = Object.fromEntries(FEATURE_KEYS.map((key, i) => [key, values[i]]));
    const probs = Array.from(new Float64Array(engine.memory.buffer, engine.output_ptr(), 6));
    onClassified(ms);
    return { classIdx, probs, features };
  } };
}
