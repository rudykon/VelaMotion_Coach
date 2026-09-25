# F6 官方模拟器 Mock 验收说明

目标：用 openvela 手表模拟器 gRPC Mock 接口注入心率、加速度、陀螺仪曲线，并生成可提交的本地验收报告。

## 支持范围

- 已注入：`ACCELERATION`、`GYROSCOPE`、`HEART_RATE`、`PhysicalModel HEART_RATE`
- 未注入：`STEP_COUNT`
  - 原因：当前本地模拟器 proto 未发现 `STEP_COUNT` 传感器枚举。
  - 处理：快应用内 `MockSensorProvider` 会按同一运动曲线生成 `stepCount`，用于 F5/F7 展示和算法融合。

## 干跑验证

不连接模拟器，只验证曲线生成和报告写入：

```bash
cd quickapp/velamotion_coach
npm run mock:official:dry
```

默认报告：

```text
artifacts/mock_verification/official_mock_dry_report.json
```

## 连接模拟器注入

模拟器启动且 gRPC 端口为 `127.0.0.1:8554` 时执行：

```bash
cd quickapp/velamotion_coach
MOCK_SCENE=fatigue_running MOCK_DURATION_MS=45000 npm run mock:official
```

可选场景：

```text
mixed_workout
running
fatigue_running
jump_rope
static
```

常用验收组合：

```bash
MOCK_SCENE=running MOCK_DURATION_MS=30000 npm run mock:official
MOCK_SCENE=jump_rope MOCK_DURATION_MS=30000 npm run mock:official
MOCK_SCENE=fatigue_running MOCK_DURATION_MS=45000 npm run mock:official
```

## 验收解释

`official_mock_report.json` 记录连接模拟器时的 set/get 回读；dry-run 写入单独的 `official_mock_dry_report.json`，不能代替注入验收。本轮 ACC、GYRO、心率均回读通过，步数 enum 缺失。

应用分类与四页演示使用应用内 `MockSensorProvider`。官方 gRPC 与应用内 Mock 共享场景生成逻辑，但注入成功本身不能证明应用已消费全部官方六轴数据。请分别运行运动回归与四页演示脚本验证算法和 UI。心率订阅失败时的降级、缺失 GYRO 时的真机门禁，见设备边界文档。
