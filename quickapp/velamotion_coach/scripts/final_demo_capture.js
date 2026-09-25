#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync, spawnSync } = require('child_process')
const grpc = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')
const { PNG } = require('pngjs')

const root = path.resolve(__dirname, '..')
const protoPath = path.resolve(root, 'node_modules/@aiot-toolkit/emulator/lib/static/proto/emulator_controller.proto')
const outDir = path.resolve(root, 'artifacts/final_demo/auto_carousel')
const host = process.env.VELA_GRPC_HOST || '127.0.0.1'
const port = process.env.VELA_GRPC_PORT || '8554'
const grpcToken = process.env.VELA_GRPC_TOKEN || 'undefined'
const device = process.env.ADB_DEVICE || 'emulator-5554'
const packageName = process.env.APP_PACKAGE || 'com.velamotion.coach'
const adbPath = process.env.ADB || path.resolve(root, 'node_modules/@miwt/adb/bin/linux/adb')
const deviceBundlePath = `/data/app/${packageName}/pages/index/index.js`
const skipAdb = process.env.DEMO_SKIP_ADB === '1'
const waitScale = Number(process.env.DEMO_WAIT_SCALE || 1)
const skipLaunch = process.env.DEMO_SKIP_LAUNCH === '1'
const skipInstall = process.env.DEMO_SKIP_INSTALL === '1'
const cleanInstall = process.env.DEMO_PM_UNINSTALL !== '0'
const pageNavMode = process.env.DEMO_PAGE_NAV || 'tap'
const nextTapX = Number(process.env.DEMO_NEXT_X || 355)
const nextTapY = Number(process.env.DEMO_NEXT_Y || 20)
const startTapX = Number(process.env.DEMO_START_X || 216)
// The four-page layout places the full-width action at native y≈356 on the
// 432x514 watch display (the 480px-high gRPC capture renders it near y=333).
const startTapY = Number(process.env.DEMO_START_Y || 356)
const workoutMs = Number(process.env.DEMO_WORKOUT_MS || 65000)
const workoutKeepAliveMs = Number(process.env.DEMO_KEEPALIVE_MS || 2200)
const workoutKeepAliveInput = process.env.DEMO_KEEPALIVE_INPUT === '1'
const expectedWorkoutActivity = process.env.DEMO_EXPECT_ACTIVITY === undefined
  ? '跑步'
  : process.env.DEMO_EXPECT_ACTIVITY
const workoutVisualTimeoutMs = Number(process.env.DEMO_VISUAL_TIMEOUT_MS || 22000)
const strictQa = process.env.DEMO_STRICT_QA !== '0'
const adbTimeoutMs = Number(process.env.DEMO_ADB_TIMEOUT_MS || 30000)
const capturePollMs = Number(process.env.DEMO_CAPTURE_POLL_MS || 650)
const captureMaxMs = Number(process.env.DEMO_CAPTURE_MAX_MS || 42000)
// The current action renders around y=314..351 on the fitted 403x480 capture.
// Keep this crop isolated from dynamic metrics so label changes remain a safe
// fallback when the tiny run-state QA marker is mid-transition.
const homeActionRegion = { x0: 0.08, y0: 0.64, x1: 0.92, y1: 0.75 }
const homeDynamicRegion = { x0: 0.08, y0: 0.17, x1: 0.92, y1: 0.70 }
// Restrict visual recognition to the large activity-name glyphs.  The compact
// watch UI also contains an orange intensity bar lower in the card; including
// that bar would falsely accept a stale "无活动" frame as running.
const homeActivityRegion = { x0: 0.24, y0: 0.245, x1: 0.65, y1: 0.35 }
const runMarkerRegion = { x0: 0.41, y0: 0, x1: 0.49, y1: 0.04 }
const runningMarkerRgb = [34, 197, 94]
const stoppedMarkerRgb = [148, 163, 184]
const runningActivityRgb = [22, 117, 90]

const demoPlan = [
  { index: 0, file: "core_01_home.png", label: "首页 · 小芽运动伙伴与腕上初筛", color: "#3EBE9B" },
  { index: 1, file: "core_02_coach.png", label: "腕上教练 · 前三候选与提醒", color: "#62A9E8" },
  { index: 2, file: "core_03_timeline.png", label: "动作时间线 · 自动分段与本地复盘", color: "#6E7FEA" },
  { index: 3, file: "core_04_sync_review.png", label: "同步复盘 · 同步/历史/更多", color: "#D66B8C" },
].map((page) => ({
  ...page,
  rgb: [
    parseInt(page.color.slice(1, 3), 16),
    parseInt(page.color.slice(3, 5), 16),
    parseInt(page.color.slice(5, 7), 16),
  ],
}))

const packageDefinition = protoLoader.loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
})

const controller = grpc.loadPackageDefinition(packageDefinition).android.emulation.control
const client = new controller.EmulatorController(`${host}:${port}`, grpc.credentials.createInsecure())
const authMetadata = new grpc.Metadata()
authMetadata.set('Authorization', `Bearer ${grpcToken}`)

function unary(method, payload) {
  return new Promise((resolve, reject) => {
    client[method](payload, authMetadata, (err, res) => (err ? reject(err) : resolve(res)))
  })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(1, Math.round(ms * waitScale))))
}

function fixedSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(1, Math.round(ms))))
}

function readPng(buffer) {
  try {
    return PNG.sync.read(buffer)
  } catch (e) {
    return null
  }
}

function regionHash(buffer, region) {
  const png = readPng(buffer)
  if (!png || !region) return null
  const x0 = Math.max(0, Math.min(png.width - 1, Math.floor(png.width * region.x0)))
  const x1 = Math.max(x0 + 1, Math.min(png.width, Math.ceil(png.width * region.x1)))
  const y0 = Math.max(0, Math.min(png.height - 1, Math.floor(png.height * region.y0)))
  const y1 = Math.max(y0 + 1, Math.min(png.height, Math.ceil(png.height * region.y1)))
  const hash = crypto.createHash('md5')
  for (let y = y0; y < y1; y += 1) {
    const start = (y * png.width + x0) * 4
    const end = (y * png.width + x1) * 4
    hash.update(png.data.subarray(start, end))
  }
  return hash.digest('hex')
}

function countColorPixels(buffer, region, targetRgb, maxDistance = 85) {
  const png = readPng(buffer)
  if (!png || !region || !targetRgb) return 0
  const x0 = Math.max(0, Math.min(png.width - 1, Math.floor(png.width * region.x0)))
  const x1 = Math.max(x0 + 1, Math.min(png.width, Math.ceil(png.width * region.x1)))
  const y0 = Math.max(0, Math.min(png.height - 1, Math.floor(png.height * region.y0)))
  const y1 = Math.max(y0 + 1, Math.min(png.height, Math.ceil(png.height * region.y1)))
  let count = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const idx = (y * png.width + x) * 4
      const rgb = [png.data[idx], png.data[idx + 1], png.data[idx + 2]]
      if (colorDistance(rgb, targetRgb) < maxDistance) count += 1
    }
  }
  return count
}

function grayAt(png, x, y) {
  const idx = (y * png.width + x) * 4
  return Math.round(0.299 * png.data[idx] + 0.587 * png.data[idx + 1] + 0.114 * png.data[idx + 2])
}

function rgbAt(png, x, y) {
  const idx = (y * png.width + x) * 4
  const r = png.data[idx]
  const g = png.data[idx + 1]
  const b = png.data[idx + 2]
  return {
    gray: Math.round(0.299 * r + 0.587 * g + 0.114 * b),
    chroma: (Math.abs(r - g) + Math.abs(g - b) + Math.abs(r - b)) / 3,
  }
}

function structuralSignature(buffer) {
  const png = readPng(buffer)
  if (!png || !png.width || !png.height) return null
  const samples = []
  let chromaSum = 0
  const cols = 36
  const rows = 36
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const px = Math.min(png.width - 1, Math.max(0, Math.round((x + 0.5) * png.width / cols)))
      const py = Math.min(png.height - 1, Math.max(0, Math.round((y + 0.5) * png.height / rows)))
      const rgb = rgbAt(png, px, py)
      samples.push(rgb.gray)
      chromaSum += rgb.chroma
    }
  }
  const dhash = []
  const hashRows = 8
  const hashCols = 9
  for (let y = 0; y < hashRows; y += 1) {
    for (let x = 0; x < hashCols - 1; x += 1) {
      const x1 = Math.min(png.width - 1, Math.round((x + 0.5) * png.width / hashCols))
      const x2 = Math.min(png.width - 1, Math.round((x + 1.5) * png.width / hashCols))
      const yy = Math.min(png.height - 1, Math.round((y + 0.5) * png.height / hashRows))
      dhash.push(grayAt(png, x1, yy) > grayAt(png, x2, yy) ? 1 : 0)
    }
  }
  const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length
  const variance = samples.reduce((sum, v) => {
    const d = v - mean
    return sum + d * d
  }, 0) / samples.length
  return { samples, dhash, mean, std: Math.sqrt(variance), chroma: chromaSum / samples.length, width: png.width, height: png.height, bytes: buffer.length }
}

function structuralDistance(a, b) {
  if (!a || !b || !a.samples || !b.samples || a.samples.length !== b.samples.length) {
    return { rms: 999, changed: 1, dhash: 64 }
  }
  let sum2 = 0
  let changed = 0
  for (let i = 0; i < a.samples.length; i += 1) {
    const d = a.samples[i] - b.samples[i]
    sum2 += d * d
    if (Math.abs(d) > 8) changed += 1
  }
  let dhash = 0
  if (a.dhash && b.dhash && a.dhash.length === b.dhash.length) {
    for (let i = 0; i < a.dhash.length; i += 1) {
      if (a.dhash[i] !== b.dhash[i]) dhash += 1
    }
  }
  return {
    rms: Math.sqrt(sum2 / a.samples.length),
    changed: changed / a.samples.length,
    dhash,
  }
}

function isStructurallySimilar(a, b) {
  const dist = structuralDistance(a, b)
  return dist.rms < 8 && dist.changed < 0.10 && dist.dhash < 4
}

function isBlankFrame(sig) {
  return !sig || sig.std < 1.5 || sig.mean < 2 || sig.mean > 253
}

function isWatchfaceLayer(sig) {
  return Boolean(sig && sig.bytes > 80000 && sig.mean > 70 && sig.mean < 175 && sig.std > 45 && sig.chroma < 2)
}

function isBadForegroundFrame(sig) {
  return isBlankFrame(sig) || isWatchfaceLayer(sig)
}

function leftEdgeBlackRatio(buffer) {
  const png = readPng(buffer)
  if (!png || !png.width || !png.height) return 0
  const x1 = Math.max(4, Math.min(png.width, Math.round(png.width * 0.04)))
  const y0 = Math.max(0, Math.round(png.height * 0.08))
  const y1 = Math.max(y0 + 1, Math.min(png.height, Math.round(png.height * 0.82)))
  let black = 0
  let count = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < x1; x += 1) {
      if (grayAt(png, x, y) < 16) black += 1
      count += 1
    }
  }
  return count > 0 ? black / count : 0
}

function frameQualityText(sig) {
  if (!sig) return 'no-signature'
  return `mean=${sig.mean.toFixed(1)} std=${sig.std.toFixed(1)} chroma=${sig.chroma.toFixed(1)} bytes=${sig.bytes || 0} size=${sig.width}x${sig.height}`
}

function colorDistance(rgb, target) {
  const dr = rgb[0] - target[0]
  const dg = rgb[1] - target[1]
  const db = rgb[2] - target[2]
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function detectDemoPageMarker(buffer) {
  const png = readPng(buffer)
  if (!png || !png.width || !png.height) return null
  // The app exposes a tiny, non-intrusive QA marker at the top centre.
  // Restrict detection to that region so normal orange/black UI controls do
  // not get mistaken for page identity.
  const x0 = Math.max(0, Math.round(png.width * 0.44))
  const x1 = Math.min(png.width - 1, Math.round(png.width * 0.56))
  const y0 = 0
  const y1 = Math.min(png.height - 1, 16)
  const scores = demoPlan.map((page) => ({
    index: page.index,
    file: page.file,
    score: 0,
    count: 0,
  }))

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const idx = (y * png.width + x) * 4
      const rgb = [png.data[idx], png.data[idx + 1], png.data[idx + 2]]
      for (const score of scores) {
        const page = demoPlan[score.index]
        const threshold = page.index === 1 ? 55 : 70
        const dist = colorDistance(rgb, page.rgb)
        if (dist < threshold) {
          score.score += threshold - dist
          score.count += 1
        }
      }
    }
  }

  scores.sort((a, b) => b.score - a.score)
  const best = scores[0]
  const second = scores[1] || { score: 0 }
  const margin = best.score - second.score
  if (!best || best.count < 8 || best.score < 160 || margin < 80) return null
  const page = demoPlan[best.index]
  return {
    index: page.index,
    id: String(page.index + 1).padStart(2, '0'),
    file: page.file,
    label: page.label,
    score: best.score,
    margin,
    secondScore: second.score,
    count: best.count,
  }
}

function detectRunStateMarker(buffer) {
  const png = readPng(buffer)
  if (!png || !png.width || !png.height) return 'unknown'
  const x0 = Math.max(0, Math.floor(png.width * runMarkerRegion.x0))
  const x1 = Math.min(png.width - 1, Math.ceil(png.width * runMarkerRegion.x1))
  const y0 = Math.max(0, Math.floor(png.height * runMarkerRegion.y0))
  const y1 = Math.min(png.height - 1, Math.ceil(png.height * runMarkerRegion.y1))
  let running = 0
  let stopped = 0
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const idx = (y * png.width + x) * 4
      const rgb = [png.data[idx], png.data[idx + 1], png.data[idx + 2]]
      if (colorDistance(rgb, runningMarkerRgb) < 55) running += 1
      if (colorDistance(rgb, stoppedMarkerRgb) < 55) stopped += 1
    }
  }
  if (running >= 8 && running > stopped * 1.3) return 'running'
  if (stopped >= 8 && stopped > running * 1.3) return 'stopped'
  return 'unknown'
}

function detectedPageText(detected) {
  if (!detected) return 'page=unknown'
  return `page=${detected.id} score=${Math.round(detected.score)} margin=${Math.round(detected.margin)}`
}

function runAdbResult(args) {
  if (skipAdb) return { ok: false, stdout: '', stderr: 'adb-skipped' }
  if (!fs.existsSync(adbPath)) {
    console.log(`[demo] adb not found: ${adbPath}; skip adb command`)
    return { ok: false, stdout: '', stderr: 'adb-not-found' }
  }
  try {
    const stdout = execFileSync(adbPath, ['-s', device, ...args], {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: adbTimeoutMs,
    })
    return { ok: true, stdout: stdout || '', stderr: '' }
  } catch (e) {
    const stdout = e && e.stdout ? String(e.stdout) : ''
    const stderr = e && e.stderr ? String(e.stderr) : ''
    const detail = (stderr || stdout || (e && e.message) || 'unknown error').trim().split('\n').slice(-3).join(' | ')
    console.log(`[demo] adb command failed: ${args.join(' ')}${detail ? ` -> ${detail}` : ''}`)
    return { ok: false, stdout, stderr }
  }
}

function runAdb(args) {
  return runAdbResult(args).ok
}

function readAdb(args) {
  if (skipAdb) return null
  if (!fs.existsSync(adbPath)) return null
  try {
    return execFileSync(adbPath, ['-s', device, ...args], { encoding: 'utf-8', stdio: 'pipe', timeout: adbTimeoutMs })
  } catch (e) {
    return null
  }
}

function readLatestDynamicUiStatus() {
  const output = readAdb(['shell', 'dmesg']) || ''
  const lines = output.split(/\r?\n/).filter((line) => line.includes('VMC_DYNAMIC_UI'))
  if (lines.length === 0) return null
  const line = lines[lines.length - 1]
  const activity = line.match(/activity=([^\s]+)/)
  const confidence = line.match(/confidence=([^\s]+)/)
  const elapsed = line.match(/elapsed=([^\s]+)/)
  return {
    line,
    activity: activity ? activity[1] : '',
    confidence: confidence ? confidence[1] : '',
    elapsed: elapsed ? elapsed[1] : '',
  }
}

function runAdbShell(command) {
  return runAdb(['shell', command])
}

function isAppProcessRunning() {
  const ps = readAdb(['shell', 'ps']) || ''
  return ps.includes(packageName)
}

async function waitForAppProcess(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (isAppProcessRunning()) return true
    await sleep(350)
  }
  return isAppProcessRunning()
}

async function bringAppForeground() {
  if (skipLaunch) return
  launchApp()
  await waitForAppProcess(2500)
  await sleep(700)
}

function findVelaConsoleTty() {
  if (process.env.DEMO_SERIAL_TTY) return process.env.DEMO_SERIAL_TTY
  const res = spawnSync('ps', ['-eo', 'tty=,args='], { encoding: 'utf-8' })
  if (res.status !== 0 || !res.stdout) return null
  const lines = res.stdout.split('\n')
  for (const line of lines) {
    const match = line.match(/^\s*(\S+)\s+(.+)$/)
    if (!match) continue
    const tty = match[1]
    const args = match[2]
    if (tty === '?' || !args.includes('qemu-system') || !args.includes(' -vela ')) continue
    const ttyPath = tty.startsWith('/dev/') ? tty : path.join('/dev', tty)
    if (fs.existsSync(ttyPath)) return ttyPath
  }
  return null
}

function writeConsoleCommand(ttyPath, command) {
  const fd = fs.openSync(ttyPath, 'w')
  try {
    fs.writeSync(fd, `${command}\n`)
  } finally {
    fs.closeSync(fd)
  }
}

function findReleaseRpk() {
  if (process.env.DEMO_RPK) return path.resolve(root, process.env.DEMO_RPK)
  const distDir = path.resolve(root, 'dist')
  if (!fs.existsSync(distDir)) return null
  const files = fs.readdirSync(distDir)
    .filter((name) => name.startsWith(`${packageName}.release.`) && name.endsWith('.rpk'))
    .map((name) => path.join(distDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return files[0] || null
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function releaseBundleHash(rpk) {
  const result = spawnSync('unzip', ['-p', rpk, 'pages/index/index.js'], {
    encoding: null,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.status !== 0 || !result.stdout || result.stdout.length === 0) {
    const detail = result.stderr ? String(result.stderr).trim() : 'bundle entry unavailable'
    console.log(`[demo] QA_FAIL: cannot read release bundle: ${detail}`)
    return null
  }
  return sha256(result.stdout)
}

function installedBundleHash() {
  if (skipAdb || !fs.existsSync(adbPath)) return null
  try {
    const bundle = execFileSync(adbPath, ['-s', device, 'shell', 'cat', deviceBundlePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: adbTimeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    })
    if (!bundle || bundle.length === 0) return null
    // NuttX nsh may return exit status 0 even when cat fails, with the error
    // text written to stdout. Never hash that text as if it were a JS bundle.
    const prefix = bundle.subarray(0, Math.min(bundle.length, 160)).toString('utf8').trim()
    if (prefix.startsWith('nsh:') || prefix.includes('open failed:')) return null
    return sha256(bundle)
  } catch (e) {
    return null
  }
}

async function waitForInstalledBundle(expectedHash, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  let matches = 0
  let lastHash = null
  while (Date.now() < deadline) {
    lastHash = installedBundleHash()
    if (lastHash === expectedHash) {
      matches += 1
      // Two consecutive reads prevent launching while an asynchronous install
      // is still replacing files in /data/app.
      if (matches >= 2) {
        console.log(`[demo] installed bundle verified sha256=${expectedHash.slice(0, 16)}`)
        return true
      }
    } else {
      matches = 0
    }
    await fixedSleep(500)
  }
  console.log(`[demo] QA_FAIL: installed bundle mismatch expected=${expectedHash.slice(0, 16)} actual=${lastHash ? lastHash.slice(0, 16) : 'unreadable'}`)
  return false
}

async function redeployRelease() {
  if (skipInstall) {
    const rpk = findReleaseRpk()
    if (!rpk || !fs.existsSync(rpk)) {
      console.log('[demo] QA_FAIL: release rpk not found while DEMO_SKIP_INSTALL=1')
      return false
    }
    const expectedBundleHash = releaseBundleHash(rpk)
    if (!expectedBundleHash) return false
    console.log('[demo] skip release reinstall; verify installed bundle=' + expectedBundleHash.slice(0, 16))
    return waitForInstalledBundle(expectedBundleHash, 12000)
  }
  const rpk = findReleaseRpk()
  if (!rpk || !fs.existsSync(rpk)) {
    console.log('[demo] QA_FAIL: release rpk not found; refusing to capture an unknown installed build')
    return false
  }
  const expectedBundleHash = releaseBundleHash(rpk)
  if (!expectedBundleHash) return false
  const target = '/data/tmp/' + path.basename(rpk)
  console.log('[demo] redeploy release ' + path.relative(root, rpk) + ' -> ' + target + ' bundle=' + expectedBundleHash.slice(0, 16))
  let pushed = false
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt > 1) await fixedSleep(1200)
    pushed = runAdb(['push', rpk, target])
    if (pushed) break
    console.log('[demo] adb push retry ' + attempt + '/3')
  }
  if (!pushed) {
    console.log('[demo] QA_FAIL: unable to push release RPK to emulator')
    return false
  }
  if (cleanInstall) {
    // Stop first because pm uninstall is asynchronous on the watch emulator;
    // otherwise the old QuickJS process can survive long enough to be relaunched.
    let processStopped = false
    for (let attempt = 1; attempt <= 3 && !processStopped; attempt += 1) {
      runAdbResult(['shell', 'am', 'stop', packageName])
      const processStopDeadline = Date.now() + 10000
      while (Date.now() < processStopDeadline) {
        const ps = readAdb(['shell', 'ps'])
        if (ps !== null && !ps.includes(packageName)) {
          processStopped = true
          break
        }
        await new Promise(resolve => setTimeout(resolve, 250))
      }
      if (!processStopped) {
        console.log('[demo] am stop postcondition retry ' + attempt + '/3')
        await new Promise(resolve => setTimeout(resolve, 800))
      }
    }
    if (!processStopped) {
      console.log('[demo] QA_FAIL: old app process did not stop before uninstall')
      return false
    }

    let uninstallObserved = false
    let uninstallResult = { ok: false }
    for (let attempt = 1; attempt <= 3 && !uninstallObserved; attempt += 1) {
      uninstallResult = runAdbResult(['shell', 'pm', 'uninstall', packageName])
      const uninstallDeadline = Date.now() + 10000
      let absentReads = 0
      while (Date.now() < uninstallDeadline) {
        const ps = readAdb(['shell', 'ps'])
        const processGone = ps !== null && !ps.includes(packageName)
        const bundleGone = installedBundleHash() === null
        if (processGone && bundleGone) {
          absentReads += 1
          if (absentReads >= 2) {
            uninstallObserved = true
            break
          }
        } else {
          absentReads = 0
        }
        await new Promise(resolve => setTimeout(resolve, 250))
      }
      if (!uninstallObserved) {
        console.log('[demo] pm uninstall postcondition retry ' + attempt + '/3')
        await new Promise(resolve => setTimeout(resolve, 800))
      }
    }
    if (!uninstallObserved) {
      console.log('[demo] QA_FAIL: old app process or bundle survived uninstall')
      return false
    }
    if (!uninstallResult.ok) {
      console.log('[demo] pm uninstall response was interrupted; verified success from process and bundle absence')
    }
    await new Promise(resolve => setTimeout(resolve, 2500))
  }
  let installed = false
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt > 1) await new Promise(resolve => setTimeout(resolve, 1500))
    const installResult = runAdbResult(['shell', 'pm', 'install', target])
    installed = await waitForInstalledBundle(expectedBundleHash, 30000)
    if (installed) {
      if (!installResult.ok) {
        console.log('[demo] pm install response was interrupted; verified success from installed bundle hash')
      }
      break
    }
    console.log('[demo] pm install or bundle verification retry ' + attempt + '/3')
  }
  if (installed) await new Promise(resolve => setTimeout(resolve, 500))
  if (!installed) {
    console.log('[demo] QA_FAIL: pm install failed or timed out; refusing to use an existing app')
  }
  return installed
}

function launchApp() {
  if (skipLaunch) {
    console.log("[demo] skip app launch by DEMO_SKIP_LAUNCH=1")
    return
  }
  if (runAdb(["shell", "am", "start", packageName])) {
    console.log(`[demo] launch via adb shell am start ${packageName}`)
    return
  }
  const vappPath = `app/${packageName}`
  if (runAdbShell(`vapp ${vappPath} &`)) {
    console.log(`[demo] fallback launch via adb shell vapp ${vappPath}`)
    return
  }
  const appUri = `hap://app/${packageName}`
  if (runAdb(["shell", "vapp", appUri])) {
    console.log(`[demo] legacy fallback launch via adb shell vapp ${appUri}`)
    return
  }
  const ttyPath = findVelaConsoleTty()
  if (ttyPath) {
    writeConsoleCommand(ttyPath, `vapp ${vappPath}`)
    console.log(`[demo] fallback launch via emulator console ${ttyPath}: vapp ${vappPath}`)
    return
  }
  console.log("[demo] launch failed: adb shell am/vapp unavailable and emulator console tty not found")
}


function cleanOldArtifacts() {
  if (!fs.existsSync(outDir)) return
  const currentArtifacts = new Set([
    ...demoPlan.map((page) => page.file),
    'core_demo_storyboard.md',
    'core_demo.ffconcat',
    'velamotion_core_demo.mp4',
  ])
  for (const name of currentArtifacts) {
    const target = path.join(outDir, name)
    if (fs.existsSync(target)) fs.unlinkSync(target)
  }
}

async function captureFrame() {
  const res = await unary('getScreenshot', { format: 'PNG', width: 480, height: 480, display: 0 })
  const hash = crypto.createHash('md5').update(res.image).digest('hex')
  return {
    buffer: res.image,
    hash,
    sig: structuralSignature(res.image),
    detected: detectDemoPageMarker(res.image),
    runState: detectRunStateMarker(res.image),
    edgeBlackRatio: leftEdgeBlackRatio(res.image),
  }
}

function writeCapturedFrame(frame, page) {
  fs.mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, page.file)
  fs.writeFileSync(file, frame.buffer)
  console.log(`[demo] collected ${file} ${frame.hash} ${detectedPageText(frame.detected)} run=${frame.runState} edgeBlack=${frame.edgeBlackRatio.toFixed(3)} ${frameQualityText(frame.sig)}`)
  return {
    file,
    hash: frame.hash,
    sig: frame.sig,
    label: page.label,
    detected: frame.detected,
    edgeBlackRatio: frame.edgeBlackRatio,
  }
}

async function screenshot(name) {
  const frame = await captureFrame()
  fs.mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, name)
  fs.writeFileSync(file, frame.buffer)
  console.log(`[demo] screenshot ${file} ${frame.hash} ${detectedPageText(frame.detected)}`)
  return { file, hash: frame.hash, sig: frame.sig, detected: frame.detected }
}

async function sendMouseClick(x, y) {
  const targetX = Math.max(0, Math.min(479, Math.round(x)))
  const targetY = Math.max(0, Math.min(479, Math.round(y)))
  await unary('sendMouse', { x: targetX, y: targetY, buttons: 0, display: 0 })
  await fixedSleep(45)
  await unary('sendMouse', { x: targetX, y: targetY, buttons: 1, display: 0 })
  await fixedSleep(110)
  await unary('sendMouse', { x: targetX, y: targetY, buttons: 0, display: 0 })
  await fixedSleep(60)
}

async function sendTouchPoint(x, y, pressure, identifier = 7) {
  await unary('sendTouch', {
    touches: [{
      x: Math.round(x),
      y: Math.round(y),
      identifier,
      pressure,
      touch_major: 8,
      touch_minor: 8,
    }],
    display: 0,
  })
}

async function wakeDisplay() {
  try {
    await sendMouseClick(216, 257)
    await sleep(600)
    console.log('[demo] wake display via center mouse click')
  } catch (e) {
    await sendTouchPoint(216, 257, 450, 9)
    await sleep(80)
    await sendTouchPoint(216, 257, 0, 9)
    await sleep(600)
  }
}

async function swipeUp() {
  if (pageNavMode === 'none') return
  const x = 240
  const startY = 390
  const endY = 80
  const steps = 9
  try {
    for (let i = 0; i <= steps; i += 1) {
      const y = startY + ((endY - startY) * i / steps)
      await sendTouchPoint(x, y, 500)
      await sleep(28)
    }
    await sendTouchPoint(x, endY, 0)
    await sleep(900)
    console.log('[demo] swipe up via emulator gRPC touch')
  } catch (e) {
    console.log(`[demo] grpc swipe failed: ${e.message}`)
    runAdb(['shell', 'input', 'swipe', '240', '390', '240', '80', '420'])
    await sleep(900)
  }
}

async function tapNextPage() {
  if (pageNavMode === 'none') return
  if (pageNavMode === 'swipe') {
    await swipeUp()
    return
  }
  try {
    await sendMouseClick(nextTapX, nextTapY)
    await sleep(700)
    console.log('[demo] tap next page via emulator gRPC mouse')
  } catch (e) {
    console.log('[demo] grpc mouse tap failed: ' + e.message)
    await sendTouchPoint(nextTapX, nextTapY, 500, 8)
    await sleep(80)
    await sendTouchPoint(nextTapX, nextTapY, 0, 8)
    await sleep(700)
  }
}

async function tapPoint(x, y, label, identifier = 10) {
  try {
    await sendMouseClick(x, y)
    await sleep(650)
    console.log('[demo] tap ' + label + ' at ' + x + ',' + y + ' via emulator gRPC mouse')
  } catch (e) {
    console.log('[demo] grpc mouse tap ' + label + ' failed: ' + e.message)
    await sendTouchPoint(x, y, 500, identifier)
    await sleep(90)
    await sendTouchPoint(x, y, 0, identifier)
    await sleep(650)
  }
}

async function waitForWorkoutWindow(durationMs, baselineDynamicLine) {
  const deadline = Date.now() + Math.max(3000, durationMs);
  let cycles = 0;
  let latestValidHome = null;
  let sawNewDynamicStatus = false;
  let lastDynamicLine = baselineDynamicLine || '';
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    await fixedSleep(Math.min(Math.max(500, workoutKeepAliveMs), remaining));
    if (Date.now() >= deadline) break;
    // The app requests screen-on itself. Extra clicks are opt-in because the
    // emulator can queue them behind slow QuickJS inference; a later stop click
    // would then wait behind the keepalive backlog for tens of seconds.
    if (workoutKeepAliveInput) {
      try {
        await sendMouseClick(216, 72);
      } catch (e) {
        console.log('[demo] workout keepalive input failed: ' + e.message);
      }
    }
    cycles += 1;
    if (cycles % 2 === 0) {
      const frame = await captureFrame();
      const validHome = !isBadForegroundFrame(frame.sig) && frame.detected && frame.detected.index === 0;
      if (validHome) latestValidHome = frame;
      console.log('[demo] workout foreground probe ' + cycles + ' ' + detectedPageText(frame.detected) + ' ' + frameQualityText(frame.sig));
      if (!validHome) {
        console.log('[demo] QA_FAIL: application left the foreground during workout; timer/sensor data would be invalid');
        return null;
      }
      const dynamicStatus = readLatestDynamicUiStatus();
      if (dynamicStatus && dynamicStatus.line !== lastDynamicLine) {
        sawNewDynamicStatus = true;
        lastDynamicLine = dynamicStatus.line;
        console.log('[demo] workout dynamic status activity=' + dynamicStatus.activity + ' confidence=' + dynamicStatus.confidence + ' elapsed=' + dynamicStatus.elapsed);
      }
      if (expectedWorkoutActivity && dynamicStatus && dynamicStatus.activity === expectedWorkoutActivity) {
        console.log('[demo] workout recognition log confirmed expected=' + expectedWorkoutActivity);
        if (expectedWorkoutActivity !== '跑步') {
          await fixedSleep(1200);
          return await waitForExpectedPage(0, 5000) || frame;
        }
        const visualDeadline = Date.now() + workoutVisualTimeoutMs;
        let visualProbe = 0;
        while (Date.now() < visualDeadline) {
          await fixedSleep(900);
          const visualFrame = await captureFrame();
          const visualHome = !isBadForegroundFrame(visualFrame.sig)
            && visualFrame.detected
            && visualFrame.detected.index === 0;
          const runningPixels = visualHome
            ? countColorPixels(visualFrame.buffer, homeActivityRegion, runningActivityRgb)
            : 0;
          visualProbe += 1;
          if (visualProbe % 4 === 0) {
            console.log('[demo] workout visual probe=' + visualProbe + ' runningPixels=' + runningPixels);
          }
          if (visualHome && runningPixels >= 8) {
            console.log('[demo] workout recognition visual confirmed runningPixels=' + runningPixels);
            return visualFrame;
          }
        }
        console.log('[demo] QA_FAIL: running was present in logs but the home activity card stayed on an older visual frame');
        return null;
      }
    }
  }
  console.log('[demo] workout wait complete cycles=' + cycles + ' keepaliveInput=' + workoutKeepAliveInput);
  if (expectedWorkoutActivity) {
    const detail = sawNewDynamicStatus ? 'latest activity did not match' : 'no new VMC_DYNAMIC_UI status was readable';
    console.log('[demo] QA_FAIL: expected workout activity ' + expectedWorkoutActivity + ' was not confirmed; ' + detail);
    if (strictQa && !skipAdb) return null;
  }
  return latestValidHome || waitForExpectedPage(0, 5000);
}

async function waitForExpectedPage(index, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  let lastFrame = null
  let badFrameStreak = 0
  let foregroundRecoveryAttempted = false
  while (Date.now() < deadline) {
    const frame = await captureFrame()
    lastFrame = frame
    if (!isBadForegroundFrame(frame.sig) && frame.detected && frame.detected.index === index) return frame
    if (isBadForegroundFrame(frame.sig)) {
      badFrameStreak += 1
      if (badFrameStreak >= 6 && !foregroundRecoveryAttempted) {
        foregroundRecoveryAttempted = true
        await bringAppForeground()
      }
    } else {
      badFrameStreak = 0
    }
    await sleep(Math.min(capturePollMs, 500))
  }
  console.log(`[demo] expected page ${index + 1} not reached; last=${detectedPageText(lastFrame && lastFrame.detected)}`)
  return null
}


async function waitForPageVisualChange(referenceFrame, timeoutMs = 10000) {
  if (!referenceFrame) return null
  const deadline = Date.now() + timeoutMs
  const pageIndex = referenceFrame.detected ? referenceFrame.detected.index : null
  let changedFrames = 0
  let lastFrame = null
  while (Date.now() < deadline) {
    const frame = await captureFrame()
    lastFrame = frame
    const samePage = pageIndex === null || (frame.detected && frame.detected.index === pageIndex)
    const distance = structuralDistance(referenceFrame.sig, frame.sig)
    const visiblyChanged = frame.hash !== referenceFrame.hash &&
      (distance.rms > 0.35 || distance.changed > 0.002 || distance.dhash > 0)
    if (!isBadForegroundFrame(frame.sig) && samePage && visiblyChanged) {
      changedFrames += 1
      if (changedFrames >= 2) return frame
    } else {
      changedFrames = 0
    }
    await fixedSleep(300)
  }
  console.log(`[demo] visible state change not observed; last=${detectedPageText(lastFrame && lastFrame.detected)}`)
  return null
}

async function waitForRegionChange(referenceFrame, region, timeoutMs = 12000) {
  if (!referenceFrame) return null
  const referenceHash = regionHash(referenceFrame.buffer, region)
  if (!referenceHash) return null
  const deadline = Date.now() + timeoutMs
  const pageIndex = referenceFrame.detected ? referenceFrame.detected.index : null
  let changedSince = 0
  let lastFrame = null
  while (Date.now() < deadline) {
    const frame = await captureFrame()
    lastFrame = frame
    const samePage = pageIndex === null || (frame.detected && frame.detected.index === pageIndex)
    const changed = regionHash(frame.buffer, region) !== referenceHash
    if (!isBadForegroundFrame(frame.sig) && samePage && changed) {
      if (!changedSince) changedSince = Date.now()
      if (Date.now() - changedSince >= 1200) return frame
    } else {
      changedSince = 0
    }
    await fixedSleep(300)
  }
  console.log(`[demo] target region did not change; last=${detectedPageText(lastFrame && lastFrame.detected)}`)
  return null
}

async function waitForTrainingState(expectedState, referenceFrame, timeoutMs = 30000) {
  if (!referenceFrame) return null
  const referenceHash = regionHash(referenceFrame.buffer, homeActionRegion)
  const deadline = Date.now() + timeoutMs
  let matchedSince = 0
  let lastFrame = null
  while (Date.now() < deadline) {
    const frame = await captureFrame()
    lastFrame = frame
    const validHome = !isBadForegroundFrame(frame.sig) && frame.detected && frame.detected.index === 0
    const markerMatch = frame.runState === expectedState
    // Region change remains a compatibility fallback for an older package,
    // while the explicit marker makes current release validation deterministic.
    const actionChanged = referenceHash && regionHash(frame.buffer, homeActionRegion) !== referenceHash
    if (validHome && (markerMatch || actionChanged)) {
      if (!matchedSince) matchedSince = Date.now()
      if (Date.now() - matchedSince >= 900) {
        console.log(`[demo] workout state confirmed expected=${expectedState} marker=${frame.runState} actionChanged=${Boolean(actionChanged)}`)
        return frame
      }
    } else {
      matchedSince = 0
    }
    await fixedSleep(300)
  }
  console.log(`[demo] workout state not confirmed expected=${expectedState} lastMarker=${lastFrame ? lastFrame.runState : 'none'} last=${detectedPageText(lastFrame && lastFrame.detected)}`)
  return null
}
async function moveNextAndWait(index) {
  let frame = await captureFrame()
  if (frame.detected && frame.detected.index === index) return frame

  let clicks = 0
  let stalled = 0
  while (clicks < demoPlan.length + 2) {
    const before = frame.detected
    if (!before) {
      await bringAppForeground()
      await fixedSleep(1000)
      frame = await captureFrame()
      if (frame.detected && frame.detected.index === index) return frame
      if (!frame.detected) return null
    }

    const expectedNext = (frame.detected.index + 1) % demoPlan.length
    await tapNextPage()
    clicks += 1
    const reached = await waitForExpectedPage(expectedNext, 8000)
    if (reached) {
      frame = reached
      stalled = 0
      if (frame.detected.index === index) return frame
      continue
    }

    await fixedSleep(1200)
    const observed = await captureFrame()
    console.log(`[demo] navigation recovery target=${index + 1} click=${clicks} observed=${detectedPageText(observed.detected)}`)
    if (observed.detected && observed.detected.index === index) return observed
    if (observed.detected && before && observed.detected.index === before.index) {
      stalled += 1
      if (stalled >= 2) return null
    } else {
      stalled = 0
    }
    frame = observed
  }
  return null
}

async function ensureHomePage() {
  // A clean Release launch on the Vela5 image can expose the process several
  // seconds before QuickJS finishes building and showing the page. Wait for a
  // valid in-app marker instead of interpreting that cold-start gap as a
  // navigation failure.
  const readyDeadline = Date.now() + 30000
  let frame = null
  let foregroundRecoveryAttempted = false
  while (Date.now() < readyDeadline) {
    frame = await captureFrame()
    if (!isBadForegroundFrame(frame.sig) && frame.detected) break
    if (!foregroundRecoveryAttempted && Date.now() + 15000 < readyDeadline) {
      foregroundRecoveryAttempted = true
      await bringAppForeground()
    }
    await fixedSleep(500)
  }
  if (!frame) return null
  if (frame.detected && frame.detected.index === 0) return frame
  if (frame.detected) {
    const steps = (demoPlan.length - frame.detected.index) % demoPlan.length
    console.log('[demo] normalize page ' + (frame.detected.index + 1) + ' -> home with ' + steps + ' click(s)')
  }
  return moveNextAndWait(0)
}

function writeStoryboard(items, videoPath, uniqueCount) {
  const md = path.join(outDir, 'core_demo_storyboard.md')
  const lines = [
    '# VelaMotion Coach 最终演示截图链路',
    '',
    `生成时间：${new Date().toISOString()}`,
    `有效画面哈希数：${uniqueCount}`,
    '',
    '## 截图顺序',
    '',
  ]
  items.forEach((item, idx) => {
    lines.push(`${idx + 1}. ${path.basename(item.file)} — ${item.label}`)
  })
  lines.push('', '## 视频产物', '')
  if (videoPath) lines.push(`- ${path.basename(videoPath)}`)
  else lines.push('- 未生成 MP4：当前服务器未检测到 ffmpeg。可使用下方命令生成。')
  lines.push('', '```bash')
  lines.push('# 在快应用工程根目录执行')
  lines.push('ffmpeg -y -f concat -safe 0 -i artifacts/final_demo/auto_carousel/core_demo.ffconcat -vf "scale=480:480:force_original_aspect_ratio=decrease,pad=480:480:(ow-iw)/2:(oh-ih)/2,format=yuv420p" -r 30 artifacts/final_demo/auto_carousel/velamotion_core_demo.mp4')
  lines.push('```', '')
  fs.writeFileSync(md, lines.join('\n'), 'utf-8')
  console.log(`[demo] storyboard ${md}`)
}

function tryBuildVideo(items) {
  const which = spawnSync('which', ['ffmpeg'], { encoding: 'utf-8' })
  const concatPath = path.join(outDir, 'core_demo.ffconcat')
  const videoPath = path.join(outDir, 'velamotion_core_demo.mp4')
  const concat = ['ffconcat version 1.0']
  items.forEach((item) => {
    concat.push(`file '${path.basename(item.file).replace(/'/g, "'\\''")}'`)
    concat.push('duration 10')
  })
  if (items.length > 0) concat.push(`file '${path.basename(items[items.length - 1].file).replace(/'/g, "'\\''")}'`)
  fs.writeFileSync(concatPath, concat.join('\n') + '\n', 'utf-8')
  if (which.status !== 0) {
    console.log('[demo] ffmpeg not found; screenshots and concat file are ready')
    return null
  }
  const res = spawnSync('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', concatPath,
    '-vf', 'scale=480:480:force_original_aspect_ratio=decrease,pad=480:480:(ow-iw)/2:(oh-ih)/2,format=yuv420p',
    '-r', '30', videoPath
  ], { encoding: 'utf-8' })
  if (res.status !== 0) {
    console.log('[demo] ffmpeg failed; screenshots remain valid')
    if (res.stderr) console.log(res.stderr.split('\n').slice(-6).join('\n'))
    return null
  }
  console.log(`[demo] video ${videoPath}`)
  return videoPath
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  await new Promise((resolve, reject) => client.waitForReady(new Date(Date.now() + 10000), err => (err ? reject(err) : resolve())))

  const deployed = await redeployRelease()
  if (!deployed && strictQa) {
    client.close()
    process.exit(2)
  }
  launchApp()
  if (!skipLaunch && !skipAdb) {
    let running = await waitForAppProcess(12000)
    if (!running) {
      console.log('[demo] app process not visible after first launch; retry foreground launch')
      launchApp()
      running = await waitForAppProcess(12000)
    }
    console.log(`[demo] app process ${packageName}: ${running ? 'running' : 'not-found'}`)
    if (!running && strictQa) {
      console.log('[demo] QA_FAIL: app process did not start; screenshots would capture the launcher/watchface layer')
      client.close()
      process.exit(2)
    }
  }
  await fixedSleep(1500)

  const initialHome = await ensureHomePage()
  if (!initialHome) {
    console.log('[demo] QA_FAIL: unable to normalize application to home page')
    client.close()
    process.exit(2)
  }

  // Only remove previous evidence after the new app is confirmed in foreground.
  cleanOldArtifacts()
  const itemsByIndex = new Map()

  const startBefore = await captureFrame()
  const dynamicBaseline = readLatestDynamicUiStatus()
  await tapPoint(startTapX, startTapY, 'start workout', 12)
  const startConfirmed = await waitForTrainingState('running', startBefore, 30000)
  if (!startConfirmed) {
    console.log('[demo] QA_FAIL: workout start was not visibly acknowledged')
    if (strictQa) {
      client.close()
      process.exit(2)
    }
  }
  console.log(`[demo] workout start acknowledged; deterministic wait ${workoutMs}ms`)
  const workoutFrame = await waitForWorkoutWindow(workoutMs, dynamicBaseline && dynamicBaseline.line)
  if (!workoutFrame && strictQa) {
    client.close()
    process.exit(2)
  }

  const homeFrame = workoutFrame || await waitForExpectedPage(0, 5000)
  if (homeFrame) itemsByIndex.set(0, writeCapturedFrame(homeFrame, demoPlan[0]))
  else if (strictQa) process.exitCode = 2
  if (homeFrame && regionHash(homeFrame.buffer, homeDynamicRegion) === regionHash(startBefore.buffer, homeDynamicRegion)) {
    console.log('[demo] QA_FAIL: workout finished without persistent dynamic health/recognition changes')
    if (strictQa) {
      client.close()
      process.exit(2)
    }
  }

  // Stop on the already verified home page before navigating elsewhere. This
  // avoids queuing page-navigation input behind a busy training render loop.
  const stopHomeFrame = homeFrame || await waitForExpectedPage(0, 5000)
  if (!stopHomeFrame && strictQa) {
    client.close()
    process.exit(2)
  }

  await tapPoint(startTapX, startTapY, "stop workout", 13)
  // Confirm the bottom action label changed from "stop" to "start new".
  // Dynamic metrics are outside this crop, so they cannot create a false pass.
  const stopConfirmed = await waitForTrainingState('stopped', stopHomeFrame, 45000)
  if (!stopConfirmed) {
    console.log('[demo] QA_FAIL: workout stop button state was not acknowledged')
    if (strictQa) {
      client.close()
      process.exit(2)
    }
  }
  await fixedSleep(2200)

  // The coach probabilities, segmented timeline and sync summary persist after
  // stop. Capture the remaining three core pages in their actual navigation
  // order; history, diagnostics and privacy are folded into page four.
  for (let index = 1; index < demoPlan.length; index += 1) {
    const frame = await moveNextAndWait(index)
    if (!frame) {
      if (strictQa) process.exitCode = 2
      continue
    }
    itemsByIndex.set(index, writeCapturedFrame(frame, demoPlan[index]))
  }

  const missingPages = demoPlan.filter((page) => !itemsByIndex.has(page.index))
  if (missingPages.length > 0) {
    console.log(`[demo] QA_FAIL: missing representative pages: ${missingPages.map((page) => `${page.index + 1}:${page.label}`).join(', ')}`)
    process.exitCode = 2
  }
  console.log(`[demo] deterministic capture summary: collected=${itemsByIndex.size}/${demoPlan.length}`)

  const items = demoPlan.map((page) => itemsByIndex.get(page.index)).filter(Boolean)
  const uniqueCount = new Set(items.map((item) => item.hash)).size
  const blankFrames = items.filter((item) => isBlankFrame(item.sig)).length
  const watchfaceFrames = items.filter((item) => isWatchfaceLayer(item.sig)).length
  const lowChromaFrames = items.filter((item) => item.sig && item.sig.chroma < 2).length
  const edgeOverlayFrames = items.filter((item) => (item.edgeBlackRatio || 0) > 0.12).length
  // MIJIA intentionally uses large neutral surfaces. Keep low chroma as a
  // diagnostic metric, but do not fail otherwise valid, page-marked captures.
  const excessiveLowChroma = lowChromaFrames > Math.floor(items.length / 2)
  let structurallySimilarPairs = 0
  for (let i = 1; i < items.length; i += 1) {
    if (isStructurallySimilar(items[i].sig, items[i - 1].sig)) structurallySimilarPairs += 1
  }

  if (uniqueCount < items.length || blankFrames > 0 || watchfaceFrames > 0 || edgeOverlayFrames > 0 || excessiveLowChroma || structurallySimilarPairs > 0) {
    console.log(`[demo] warning: hashes unique=${uniqueCount}/${items.length}, blankFrames=${blankFrames}, watchfaceFrames=${watchfaceFrames}, edgeOverlayFrames=${edgeOverlayFrames}, lowChromaFrames=${lowChromaFrames}, structurallySimilarAdjacentPairs=${structurallySimilarPairs}`)
  }

  const video = tryBuildVideo(items)
  writeStoryboard(items, video, uniqueCount)
  if (strictQa && (uniqueCount < items.length || blankFrames > 0 || watchfaceFrames > 0 || edgeOverlayFrames > 0 || structurallySimilarPairs > Math.floor(items.length / 3))) {
    console.log('[demo] QA_FAIL: capture is not safe for paper/video evidence')
    process.exitCode = 2
  }
  client.close()
}

main().catch(err => {
  console.error('[demo] failed:', err && err.message ? err.message : err)
  client.close()
  process.exit(1)
})
