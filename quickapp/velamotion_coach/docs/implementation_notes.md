# VelaMotion Coach 实现说明

## 1. 迁移策略

现有项目的完整模型链路是：

```text
100Hz ACC/GYRO 采集 → 3s/5s/8s 窗口 → CNN-BiLSTM/ensemble → 概率融合 → 平滑 → Viterbi → 片段输出
```

openvela Quick App 当前主要是 JS UI/交互开发形态，不适合在第一版中直接加载 Android 资产里的 ONNX 模型。因此本实现采用两层设计：

```text
页面 / Mock / TRL 不依赖具体模型
classifyWindow(samples, health) 是唯一模型替换点
```

当前 `tiny_classifier.js` 是轻量特征规则分类器，用于比赛模拟器 MVP。后续如果有原生推理桥、WASM 或官方 NN SDK，只需替换该文件，保持返回结构不变。

## 2. 已移植的原项目核心

| 原项目能力 | Quick App 当前实现 |
|---|---|
| 6 通道 ACC/GYRO 输入 | `MockSensorProvider` 输出 `accX/accY/accZ/gyroX/gyroY/gyroZ` |
| 采样与推理频率 | 源模型/数据语义保留 100Hz；QuickJS 运行时使用固定 `SAMPLE_RATE_HZ = 16`，真实 ACC 只在两帧有效回调之间插值，不续用过期末帧伪造数据 |
| 3 秒滑窗 | 16Hz 运行时 `WINDOW_SIZE = 48`；原模型资产仍按 100Hz 记录 |
| 1 秒步长 | 16Hz 运行时 `STEP_SIZE = 16` |
| 6 类标签 | `无活动/羽毛球/跳绳/飞鸟/跑步/乒乓球` |
| 概率平滑 | 与 Git 基线一致的 7 点居中均值 + 5 点居中中值；只重算受新窗口影响的尾部 |
| Viterbi 时序稳定 | 保留基线转移矩阵和当前端点解码；固定回溯最近 32 个窗口，冻结更早的稳定前缀，避免每帧扫描完整历史 |
| 片段级输出 | `extractRawSegments → mergeSameClassSegments → resolveOverlaps → filterSegments` |
| 训练复盘 | 页面时间线和摘要卡片 |

## 3. 与官方 service.health 的边界

按官方 `service.health` v1.0.0 手册，当前只支持：

- `HEART_RATE = 0`
- `SPO2 = 6`
- `STRESS = 9`

因此：

- 心率/血氧/压力走 `src/common/sensor/health_provider.js`。
- 步数、ACC、GYRO 不写成 `service.health` 能力，当前由 `MockSensorProvider` 生成。
- 算法分类主输入仍是 ACC/GYRO；心率只做强度解释和提醒。

## 4. Mock 场景

| 场景 | 片段 |
|---|---|
| mixed_workout | 静止 → 跑步 → 跳绳 → 羽毛球 → 乒乓球 → 恢复 |
| running | 静止 → 稳定跑步 → 放松 |
| fatigue_running | 静止 → 正常跑 → 疲劳跑 → 恢复 |
| jump_rope | 静止 → 跳绳 → 恢复 |
| static | 长时间静坐 |

## 5. 历史验证状态（2026-08-09，旧 11 页架构）

以下结果用于追溯旧版验收，不作为当前四页提交证据。服务器当时使用 AIoT-IDE 1.99.3 和 toolkit 2.0.5 完成构建、签名与 openVela 手表模拟器验收：

- `npm run test:core`：31/31 项核心回归通过，覆盖居中平滑/Viterbi 基线等价、长历史增量更新、真实传感器首帧/失效/恢复、六轴门禁、训练与诊断互斥、协作式推理取消及全局停止。
- `npm run test:motion`：静止、跑步、跳绳、羽毛球、乒乓球、飞鸟、混合训练及疲劳提醒场景通过。
- `npm run build`：Debug RPK 构建成功。
- `npm run release`：Release RPK 签名打包成功。
- `npm run demo:capture`：11/11 个代表页面采集成功且哈希全部唯一；空白帧、表盘误截、边缘黑层和相邻结构重复均为 0。
- 动态首页采用日志与像素双重验收：先确认 `VMC_DYNAMIC_UI activity=跑步`，再确认活动区域出现跑步橙色，避免截取尚未刷新的“无活动”旧帧。
- 官方模拟器 Mock 已成功注入 ACC、GYRO 和 HEART_RATE，并回读验证；当前镜像未提供官方步数传感器目标，步数仍由应用场景 Mock 生成。
- `npm run submit:check`：旧提交包完整性检查通过，源码、Release RPK、11 张旧截图、旧演示视频、Mock 报告及说明材料齐全，禁入文件为 0。

真机入口采用“先验能力门禁”：ACC 或 GYRO 任一缺失都不会启动引擎、健康订阅或真实传感器流，也不会落库。当前公开 JS API 缺少 GYRO，因此该入口会明确提示能力不足，不能把 ACC-only 数据描述为完整运动识别。

完整测试证据和已知边界见 `docs/test_report.md`。

## 5.1 当前四页验证状态（2026-08-10）

当前顶层导航固定为“首页 → 教练 → 时间线 → 同步复盘”。场景/AI 建议折叠进教练页，本地复盘折叠进时间线，同步/历史/诊断/隐私折叠进同步复盘页。

- `npm run test:core`：47/47 通过，含四组优先缺陷、四页结构、处理状态、动画相位/门控、精确结果接收窗口与生命周期。
- `npm run test:motion`：全部动作、混合训练和疲劳风险场景通过；Debug build 与 Release 签名打包成功。
- openVela strict QA 模拟器验收为 4/4 且哈希唯一 4/4：`core_01_home.png`、`core_02_coach.png`、`core_03_timeline.png`、`core_04_sync_review.png`。
- 当前视频 `velamotion_core_demo.mp4` 和 core 故事板已生成；提交脚本只复制当前 core 制品。
- `npm run submit:check`：`ok=true`，missing=0，截图映射、Release 鲜度、ZIP 内容和禁入文件检查全部通过。
- 旧 11 页截图和 `velamotion_final_demo.mp4` 仍可保留作历史证据，但不参与当前提交检查。

## 6. AIoT-IDE 验证重点

导入工程后重点检查：

1. 页面是否正常加载，中文字体是否显示。
2. `onclick` 事件是否触发开始/停止和场景切换。
3. `for="{{ classRows }}"` / `for="{{ timelineRows }}"` 是否正常渲染列表。
4. `if="{{ timelineEmpty }}"` 条件渲染是否生效。
5. `service.health` 是否订阅成功；如果失败，看错误码是否为 203 或权限/镜像问题。
6. release RPK 是否能安装到模拟器，并通过 `adb shell am start com.velamotion.coach` 启动；旧版串口环境可用 `vapp hap://app/com.velamotion.coach` 兜底。

## 7. 后续替换真模型的接口约束

替换 `tiny_classifier.js` 时保持：

```javascript
export function classifyWindow(samples, health) {
  return {
    classIdx: 0,
    className: '无活动',
    confidence: 0.9,
    probs: [0.9, 0.02, 0.02, 0.02, 0.02, 0.02],
    features: {}
  }
}
```

其中 `probs.length` 必须等于 6，类别顺序必须与 `config.js` 一致。
