#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const root = path.resolve(__dirname, '..')
const projectRoot = path.resolve(root, '..')
const sourceRoot = process.env.ORIGINAL_MODEL_ROOT || path.join(projectRoot, 'Wearable-IMU-Activity-Segmentation-Pipeline')
const outPath = path.join(root, 'artifacts/model_migration/model_asset_report.json')
const exts = new Set(['.pth', '.pkl', '.onnx', '.tflite', '.pt', '.h5'])

function walk(dir, out) {
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (exts.has(path.extname(name).toLowerCase())) out.push(p)
  }
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

const files = []
walk(path.join(sourceRoot, 'saved_models'), files)
const assets = files.sort().map((file) => ({
  file: path.relative(projectRoot, file),
  sizeBytes: fs.statSync(file).size,
  sha256: sha256(file),
}))
const recommended = assets.find((it) => /combined_model_3s_seed42\.pth$/.test(it.file)) || assets.find((it) => /3s.*\.pth$/.test(it.file)) || assets[0] || null
const norm3s = assets.find((it) => /norm_params_3s\.pkl$/.test(it.file)) || null
const report = {
  generatedAt: new Date().toISOString(),
  sourceRoot: path.relative(projectRoot, sourceRoot),
  assetCount: assets.length,
  recommended3sModel: recommended,
  normParams3s: norm3s,
  quickAppBackend: 'src/common/algorithm/model_backend.js',
  currentRuntime: 'tiny_classifier fallback; native_quantized_model optional bridge via setNativeModelBackend() or globalThis.velamotionModel',
  migrationBoundary: 'PyTorch .pth cannot be executed directly inside Quick App JS. Convert to ONNX/TFLite/MNN or expose a native adapter, then register classifyWindow via setNativeModelBackend() or globalThis.velamotionModel.',
  assets,
}
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(`[model] assets=${assets.length}`)
console.log(`[model] report=${outPath}`)
if (recommended) console.log(`[model] recommended=${recommended.file}`)
