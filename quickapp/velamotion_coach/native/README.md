# 原生六轴 Feature 扩展

此补丁将 openvela uORB 的 `sensor_accel` / `sensor_gyro` 直接接入快应用 `@system.sensor`。原生路径全程在设备内运行，不依赖电脑、HTTP 或模拟器验证桥。

当前尚未完成完整固件编译和物理板验证；模拟器持续训练仍有采样缺口，详见 [验证状态](../docs/six_axis_integration.md)。

## 新接口与数据契约

- `sensor.subscribeGyroscope({ interval: "game", callback, fail })` / `unsubscribeGyroscope()`。
- ACC 和 GYRO 均返回浮点 `x/y/z` 与 `timestampMs`；时间为设备单调时钟毫秒，来自 uORB 微秒时间戳。
- ACC 单位 m/s²；GYRO 单位 rad/s。原有 ACC JIDL 的整数坐标改为 double，避免丢失小数精度。
- 通用接口新增本扩展的 `DATA_TYPES.GYROSCOPE`（32）；调用方应读取常量，不硬编码数字。`subscribe` / `getRecentData` 同时提供对应角速度数据。
- 既有 Feature 生命周期负责退出页面时取消订阅。应用侧负责首帧超时、缺轴、采样中断与停止后回调失效。

## 应用到固件

在由官方 `dev-ai-contest-2026` 分支同步完成的 openvela 工作区外执行：

```sh
python3 native/apply_sensor_patch.py /path/to/openvela --check
python3 native/apply_sensor_patch.py /path/to/openvela
```

脚本检查两份上游文件的 SHA-256，支持重复执行；遇到上游改动会拒绝覆盖。检查基线见 `upstream.json`。补丁更新 `sensor.jidl` 和 `sensor_impl.cpp`，不能仅复制 RPK 代替固件更新。

确保目标配置启用 `CONFIG_FEATURE_SYSTEM_SENSOR`、`CONFIG_QUICKAPP` 以及 ACC/GYRO 的 uORB 驱动，然后重新编译原来的目标配置（让 `nuttx_add_jidl` 重新生成绑定）。例如官方黄山派配置为：

```sh
cmake -B cmake_out/lckfb_huangshan_pi -S nuttx -GNinja \
  -DBOARD_CONFIG=../vendor/sifli/boards/sf32lb52/lckfb_huangshan_pi/configs/nsh
cmake --build cmake_out/lckfb_huangshan_pi
```

板级还需实际注册并发布 `sensor_accel0` 和 `sensor_gyro0`；仅开启 LSM6DSL 编译选项不证明传感器已接入 uORB。先用 `uorb_listener -r 50 -n 20 -t 3 sensor_accel0,sensor_gyro0` 检查，再部署 RPK，选择“真机”。没有驱动或没有样本时应用会中止本次采集，不填零继续识别。

## 现成模拟器镜像

现成 Vela5 镜像不能热替换 C++ Feature。它可通过 `../scripts/emulator_uorb_bridge.py` 验证相同 JS 采样与运动识别路径；该桥用于开发，数据源确实是模拟器内部原生 uORB。选择“模拟器六轴”才会连接本机桥；真机模式不会自动退回 HTTP 或内部 Mock。

## 验证边界

运行时补丁的完整固件编译、刷入黄山派及物理运动验证需分别记录。模拟器验证桥通过不等同于该固件补丁已经在黄山派运行，也不证明分类器具备真人识别准确率。
