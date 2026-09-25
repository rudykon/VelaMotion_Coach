# 六轴接入（1.1.0）

## 新增实现

原生路径为 `uORB sensor_accel / sensor_gyro → system.sensor Feature → SixAxisSensorProvider → MotionEngine`，全程在设备内运行。补丁保留浮点精度，并为两轴组添加同一单调时钟的 `timestampMs`；单位分别为 m/s²、rad/s。

JS 模块按 62.5 ms 网格对齐两路数据（16 Hz），只在相邻原生样本之间插值，不外推。最大插值间隔 200 ms；首帧超时 3 秒，单轴停止更新 1 秒、时钟重置或队列溢出都会终止会话。缺失陀螺仪不填零，缺失健康值显示未知；当前六轴路径未接计步器，步数显示“--”。停止和重新开始后，旧订阅回调失效。

历史记录新增 `sensorSource` 与 `stepAvailable`，分别区分原生硬件、模拟器 uORB 和应用内场景数据。诊断面板只有实际收到两路有效数据后才判六轴通过。

## 真机部署

参见 [原生补丁安装说明](../native/README.md)。补丁固定上游 commit，并校验文件 SHA-256；不匹配时拒绝覆盖。重编固件会重新生成 JIDL 绑定。仅安装 RPK 不能添加 C++ 原生 Feature。

黄山派 SF32LB52 需有屏幕、运行快应用的固件、ACC/GYRO 驱动以及实际发布的 `sensor_accel0` / `sensor_gyro0`。确认底层样本后，安装 `dist/com.velamotion.coach.release.1.1.0.rpk`，在教练页“场景”选择“真机”。仍缺少接口时会阻断启动。

## 官方预编译模拟器

已有镜像没有陀螺仪 JS Feature，因此提供开发验证桥：

```sh
npm run bridge:emulator
# 另开终端；先在应用教练页“场景”选择“模拟器六轴”，再开始训练
node scripts/verify_six_axis_emulator.js inject 20000
```

桥仅读取 `adb shell uorb_listener -r 50 -t 3600 sensor_accel0,sensor_gyro0` 的原生输出。宿主端仅监听 `127.0.0.1:8765`，模拟器通过其主机别名 `10.0.2.2` 读取；此路径不使用 gRPC 回读生成样本。`inject` 仅向模拟器注入已知输入，验证输出是否确实进入应用。训练数据不发送到外部服务器。退出桥后训练必须中止。

“模拟器六轴”需主动选择；真机模式不自动回退到 HTTP 或内部 Mock。官方模拟器输出仍是仿真数据，不是人体实测。

![最终签名版本的场景入口，包含真机与模拟器六轴](../artifacts/six_axis/source_selector.png)

## 2026-09-20 验证结果

| 检查 | 结果 |
|---|---|
| 六轴 JS 回归 | 14/14，通过时间对齐、缺轴、断序、重启、超时、晚回调与有界缓存测试 |
| 原生桥解析/缓存 | 6/6，通过浮点解析、无效数据、溢出与单轴断流测试 |
| 原有核心/运动回归 | 核心 53/53，运动场景检查通过 |
| 原生补丁 | 基线校验、应用及重复执行通过；不等于完整 C++ 固件编译 |
| 签名 RPK | 1.1.0 构建成功，设备页面 bundle SHA-256 与最终 RPK 一致；哈希见报告 |
| 原生帧进入快应用 | 已观察到 `emulator_uorb` 的非零浮点 GYRO；与注入的 y=-0.75、z=1.25 一致，ACC z=9.75 |
| 缺帧保护 | 实测出现底层间隔 217.7～512.6 ms，应用报 `gyro_sample_gap`，中止且不保存本次记录 |
| 持续六轴训练/正常停止保存 | 当前预编译模拟器未通过；不能用内部 Mock 或 gRPC 回读代替此项 |
| 原生固件编译、黄山派物理运动与功耗 | 尚未执行；当前未连接物理板 |

机器可读结果：[validation.json](../artifacts/six_axis/validation.json)。原生补丁、桥和 JS 层均已交付源码；下一步需要可重编的目标固件与硬件实测。当前模拟器的传感器线程与快应用线程均观察到优先级 100/FIFO；调度竞争是待进一步确认的原因，不通过放宽缺帧阈值掩盖缺失。

测试命令：`npm run test:six-axis`、`npm run test:bridge`、`npm run test:core`、`npm run test:motion`。历史开发日志与原始控制台输出不纳入公开材料。
