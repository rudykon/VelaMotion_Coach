export function getSessionStartPermission(isDiagnosing) {
  if (isDiagnosing) {
    return {
      allowed: false,
      message: '设备诊断中，请稍候再开始训练',
    };
  }
  return { allowed: true, message: '' };
}

export function getDiagnosticStartPermission(isRunning, isDiagnosing) {
  if (isRunning) {
    return {
      allowed: false,
      message: '训练中不可检测·请先停止',
    };
  }
  if (isDiagnosing) {
    return {
      allowed: false,
      message: '设备诊断正在进行',
    };
  }
  return { allowed: true, message: '' };
}

export function getRealTrainingPermission(capabilities) {
  const caps = capabilities || {};
  if (!caps.accelerometer) {
    return {
      allowed: false,
      message: '真机 ACC 不可用，运动识别未启动',
    };
  }
  if (!caps.gyroscope || !caps.fullActivityRecognition) {
    return {
      allowed: false,
      message: '仅 ACC 可用，缺少 GYRO，完整运动识别未启动',
    };
  }
  return { allowed: true, message: '' };
}
