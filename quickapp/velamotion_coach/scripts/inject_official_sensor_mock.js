#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const grpc = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')

const protoPath = path.resolve(__dirname, '../node_modules/@aiot-toolkit/emulator/lib/static/proto/emulator_controller.proto')
const port = process.env.VELA_GRPC_PORT || '8554'
const host = process.env.VELA_GRPC_HOST || '127.0.0.1'
const sceneId = process.env.MOCK_SCENE || 'mixed_workout'
const durationMs = Number(process.env.MOCK_DURATION_MS || 30000)
const intervalMs = Number(process.env.MOCK_INTERVAL_MS || 200)
const dryRun = process.env.MOCK_DRY_RUN === '1'
const defaultReportName = dryRun ? 'official_mock_dry_report.json' : 'official_mock_report.json'
const reportPath = process.env.MOCK_REPORT_PATH || path.resolve(__dirname, `../artifacts/mock_verification/${defaultReportName}`)

const packageDefinition = protoLoader.loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
})

const controller = grpc.loadPackageDefinition(packageDefinition).android.emulation.control
const client = dryRun ? null : new controller.EmulatorController(`${host}:${port}`, grpc.credentials.createInsecure())

function callUnary(method, payload) {
  return new Promise((resolve, reject) => {
    client[method](payload, (err, res) => {
      if (err) reject(err)
      else resolve(res)
    })
  })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function protoEnumNames(enumName) {
  try {
    const text = fs.readFileSync(protoPath, 'utf-8')
    const re = new RegExp(`enum\\s+${enumName}\\s*{([\\s\\S]*?)\\n\\s*}`, 'm')
    const match = text.match(re)
    if (!match) return []
    return match[1]
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .map((line) => {
        const m = line.match(/^([A-Z0-9_]+)\s*=/)
        return m ? m[1] : null
      })
      .filter(Boolean)
  } catch (e) {
    return []
  }
}

function detectStepTargets() {
  const sensorTypes = protoEnumNames('SensorType')
  const physicalTypes = protoEnumNames('PhysicalType')
  const preferred = ['STEP_COUNT', 'STEP_COUNTER', 'PEDOMETER', 'STEPS', 'STEP_DETECTOR', 'WALKING_STEPS']
  const sensorTarget = preferred.find((name) => sensorTypes.includes(name)) || sensorTypes.find((name) => /STEP|PEDOMETER/.test(name)) || null
  const physicalTarget = preferred.find((name) => physicalTypes.includes(name)) || physicalTypes.find((name) => /STEP|PEDOMETER/.test(name)) || null
  return { sensorTypes, physicalTypes, sensorTarget, physicalTarget }
}

const stepProbe = detectStepTargets()

async function loadMockTools() {
  const url = pathToFileURL(path.resolve(__dirname, '../src/common/sensor/mock_scenarios.js')).href
  return import(url)
}

function createFrameGenerator(tools) {
  let stepCount = 0
  let lastStepAtSec = -999
  return function nextFrame(elapsedSec) {
    const located = tools.locateSegment(sceneId, elapsedSec)
    const rate = tools.stepRateForMode(located.segment.mode)
    if (rate > 0 && elapsedSec - lastStepAtSec >= 1 / rate) {
      stepCount += 1
      lastStepAtSec = elapsedSec
    }
    return tools.sampleMotionFrame(sceneId, elapsedSec, stepCount)
  }
}

async function injectFrame(frame) {
  await callUnary('setSensor', {
    target: 'ACCELERATION',
    value: { data: [frame.accX, frame.accY, frame.accZ] }
  })

  await callUnary('setSensor', {
    target: 'GYROSCOPE',
    value: { data: [frame.gyroX, frame.gyroY, frame.gyroZ] }
  })

  await callUnary('setSensor', {
    target: 'HEART_RATE',
    value: { data: [frame.heartRate] }
  })

  await callUnary('setPhysicalModel', {
    target: 'HEART_RATE',
    value: { data: [frame.heartRate] }
  })

  if (stepProbe.sensorTarget) {
    await callUnary('setSensor', {
      target: stepProbe.sensorTarget,
      value: { data: [frame.stepCount] }
    })
  }

  if (stepProbe.physicalTarget) {
    await callUnary('setPhysicalModel', {
      target: stepProbe.physicalTarget,
      value: { data: [frame.stepCount] }
    })
  }
}

async function readback() {
  const acc = await callUnary('getSensor', { target: 'ACCELERATION' })
  const gyro = await callUnary('getSensor', { target: 'GYROSCOPE' })
  const sensorHr = await callUnary('getSensor', { target: 'HEART_RATE' })
  const physicalHr = await callUnary('getPhysicalModel', { target: 'HEART_RATE' })
  const step = stepProbe.sensorTarget ? await callUnary('getSensor', { target: stepProbe.sensorTarget }) : null
  const physicalStep = stepProbe.physicalTarget ? await callUnary('getPhysicalModel', { target: stepProbe.physicalTarget }) : null
  return { acc, gyro, sensorHr, physicalHr, step, physicalStep }
}


async function setAndRead(setMethod, getMethod, target, data) {
  await callUnary(setMethod, { target, value: { data } })
  return callUnary(getMethod, { target })
}

async function injectAndReadback(frame) {
  const acc = await setAndRead('setSensor', 'getSensor', 'ACCELERATION', [frame.accX, frame.accY, frame.accZ])
  const gyro = await setAndRead('setSensor', 'getSensor', 'GYROSCOPE', [frame.gyroX, frame.gyroY, frame.gyroZ])
  const sensorHr = await setAndRead('setSensor', 'getSensor', 'HEART_RATE', [frame.heartRate])
  const physicalHr = await setAndRead('setPhysicalModel', 'getPhysicalModel', 'HEART_RATE', [frame.heartRate])
  const step = stepProbe.sensorTarget ? await setAndRead('setSensor', 'getSensor', stepProbe.sensorTarget, [frame.stepCount]) : null
  const physicalStep = stepProbe.physicalTarget ? await setAndRead('setPhysicalModel', 'getPhysicalModel', stepProbe.physicalTarget, [frame.stepCount]) : null
  return { acc, gyro, sensorHr, physicalHr, step, physicalStep }
}
function responseVector(response) {
  const data = response && response.value && response.value.data
  return Array.isArray(data) ? data.map(Number) : []
}

function compareVector(actualResponse, expected, tolerance) {
  const actual = responseVector(actualResponse)
  const expectedValues = expected.map(Number)
  if (actual.length < expectedValues.length) {
    return { ok: false, actual, expected: expectedValues, maxAbsError: null }
  }
  let maxAbsError = 0
  for (let i = 0; i < expectedValues.length; i += 1) {
    const error = Math.abs(actual[i] - expectedValues[i])
    if (!Number.isFinite(error)) return { ok: false, actual, expected: expectedValues, maxAbsError: null }
    if (error > maxAbsError) maxAbsError = error
  }
  return { ok: maxAbsError <= tolerance, actual, expected: expectedValues, maxAbsError }
}

function verifyReadback(readbackValue, frame) {
  const checks = {
    acceleration: compareVector(readbackValue.acc, [frame.accX, frame.accY, frame.accZ], 0.05),
    gyroscope: compareVector(readbackValue.gyro, [frame.gyroX, frame.gyroY, frame.gyroZ], 0.05),
    sensorHeartRate: compareVector(readbackValue.sensorHr, [frame.heartRate], 0.5),
    physicalHeartRate: compareVector(readbackValue.physicalHr, [frame.heartRate], 0.5),
  }
  if (stepProbe.sensorTarget) checks.sensorStep = compareVector(readbackValue.step, [frame.stepCount], 0.5)
  if (stepProbe.physicalTarget) checks.physicalStep = compareVector(readbackValue.physicalStep, [frame.stepCount], 0.5)
  return {
    passed: Object.keys(checks).every((key) => checks[key].ok),
    checks,
  }
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`[mock] report: ${reportPath}`)
}

async function waitForReady() {
  const deadline = new Date(Date.now() + 10000)
  await new Promise((resolve, reject) => {
    client.waitForReady(deadline, err => {
      if (err) reject(err)
      else resolve()
    })
  })
}

async function main() {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('MOCK_DURATION_MS must be positive')
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('MOCK_INTERVAL_MS must be positive')
  const tools = await loadMockTools()
  if (!tools.SCENARIOS.some((item) => item.id === sceneId)) throw new Error(`unknown MOCK_SCENE: ${sceneId}`)
  const scene = tools.getScenario(sceneId)
  const nextFrame = createFrameGenerator(tools)
  const injectedTargets = ['ACCELERATION', 'GYROSCOPE', 'HEART_RATE', 'PHYSICAL_HEART_RATE']
  if (stepProbe.sensorTarget) injectedTargets.push(stepProbe.sensorTarget)
  if (stepProbe.physicalTarget) injectedTargets.push(`PHYSICAL_${stepProbe.physicalTarget}`)
  const unsupportedTargets = []
  if (!stepProbe.sensorTarget && !stepProbe.physicalTarget) unsupportedTargets.push('STEP_COUNT_OFFICIAL_ENUM_NOT_FOUND_IN_EMULATOR_PROTO')
  const frames = []

  if (dryRun) {
    const sampleCount = Math.min(24, Math.max(2, Math.ceil(durationMs / Math.max(1, intervalMs))))
    for (let i = 0; i < sampleCount; i += 1) {
      const elapsedMs = sampleCount === 1 ? 0 : Math.round((durationMs * i) / (sampleCount - 1))
      frames.push(nextFrame(elapsedMs / 1000))
    }
    const last = frames[frames.length - 1]
    const report = {
      dryRun: true,
      sceneId,
      sceneName: scene.name,
      durationMs,
      intervalMs,
      injectedTargets,
      unsupportedTargets,
      stepMock: { sensorTarget: stepProbe.sensorTarget, physicalTarget: stepProbe.physicalTarget, sensorTypes: stepProbe.sensorTypes, physicalTypes: stepProbe.physicalTypes },
      lastFrame: last,
      generatedAt: new Date().toISOString(),
      verification: { passed: false, reason: 'dry_run_does_not_prove_emulator_injection' },
      note: 'Dry run only validates curve generation. Set MOCK_DRY_RUN=0 or omit it to inject into emulator gRPC.'
    }
    console.log(`[mock] dry-run scene=${sceneId} frames=${frames.length} lastHr=${Math.round(last.heartRate)} lastSteps=${last.stepCount}`)
    writeReport(report)
    return
  }

  await waitForReady()
  console.log(`[mock] connected to emulator gRPC ${host}:${port}`)
  console.log(`[mock] scene=${sceneId} (${scene.name}), duration=${durationMs}ms, interval=${intervalMs}ms`)
  console.log(`[mock] step target sensor=${stepProbe.sensorTarget || 'none'} physical=${stepProbe.physicalTarget || 'none'}`)
  const start = Date.now()
  let last = null
  let count = 0
  while (Date.now() - start < durationMs) {
    const elapsed = Date.now() - start
    last = nextFrame(elapsed / 1000)
    await injectFrame(last)
    count += 1
    process.stdout.write(`[mock] #${count} t=${(elapsed / 1000).toFixed(1)}s mode=${last.mockMode} hr=${Math.round(last.heartRate)} steps=${last.stepCount} acc=(${last.accX.toFixed(2)},${last.accY.toFixed(2)},${last.accZ.toFixed(2)}) gyro=(${last.gyroX.toFixed(2)},${last.gyroY.toFixed(2)},${last.gyroZ.toFixed(2)})\r`)
    await sleep(intervalMs)
  }
  process.stdout.write('\n')

  // Read each target immediately after setting it because the emulator
  // physical-model loop may restore ACC/GYRO within the following RPCs.
  const finalReadback = await injectAndReadback(last)
  const verification = verifyReadback(finalReadback, last)
  const report = {
    dryRun: false,
    sceneId,
    sceneName: scene.name,
    durationMs,
    intervalMs,
    frameCount: count,
    injectedTargets,
    unsupportedTargets,
    stepMock: { sensorTarget: stepProbe.sensorTarget, physicalTarget: stepProbe.physicalTarget, sensorTypes: stepProbe.sensorTypes, physicalTypes: stepProbe.physicalTypes },
    lastFrame: last,
    finalVerificationMethod: 'interleaved_set_get',
    readback: finalReadback,
    verification,
    generatedAt: new Date().toISOString()
  }
  console.log('[mock] final getSensor ACCELERATION:', JSON.stringify(finalReadback.acc))
  console.log('[mock] final getSensor GYROSCOPE:', JSON.stringify(finalReadback.gyro))
  console.log('[mock] final getSensor HEART_RATE:', JSON.stringify(finalReadback.sensorHr))
  console.log('[mock] final getPhysicalModel HEART_RATE:', JSON.stringify(finalReadback.physicalHr))
  if (finalReadback.step) console.log(`[mock] final getSensor ${stepProbe.sensorTarget}:`, JSON.stringify(finalReadback.step))
  if (finalReadback.physicalStep) console.log(`[mock] final getPhysicalModel ${stepProbe.physicalTarget}:`, JSON.stringify(finalReadback.physicalStep))
  console.log(`[mock] verification passed=${verification.passed}`)
  writeReport(report)
  client.close()
  if (!verification.passed) process.exitCode = 2
}

main().catch(err => {
  console.error('[mock] failed:', err && err.message ? err.message : err)
  if (client) client.close()
  process.exit(1)
})
