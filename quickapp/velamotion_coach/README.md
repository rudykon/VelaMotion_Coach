# VelaMotion Coach / 腕动教练

面向 openvela 智能手表的运动教练快应用，采用“小芽”伙伴界面组织开始、查看、停止与复盘。

[项目主页](https://github.com/rudykon/VelaMotion_Coach) · [浏览器 WASM 演示](https://rudykon.github.io/VelaMotion_Coach/) · [黄山派固件](https://github.com/rudykon/VelaMotion_Coach/releases) · [板端构建指南](../../board/huangshan_openvela/README.md)

## 当前实现

- 四页信息架构：`首页 → 教练 → 时间线 → 同步复盘`；大字、圆角安全区、横向翻页和纵向滚动，滑动时取消按钮点击。
- 活动初筛：16 Hz、3 秒窗口、1 秒步长，使用六轴统计和周期特征为无活动、羽毛球、跳绳、飞鸟、跑步、乒乓球计算候选评分。
- 时序分段：7 点均值、5 点中值平滑与 Viterbi 解码；固定长度回溯、短片段过滤和相邻片段合并。
- 教练与复盘：演示强度/风险提醒、片段时间线、摘要与会话历史；可选同步与 AI 总结接口在能力不足时降级。
- 黄山派工程：原生桌面、QuickApp 运行时、大字手势、协作停止和有界 EPIC 绘制。

当前板端训练演示采用明确标识的 Mock 数据。真实六轴到 JS、真实健康传感、振动和手机互联尚未完成该固件的实板验收；`/data` 为 RAM，复位或断电会丢失训练历史。特征规则评分不等于人体识别准确率，研究阶段深度模型没有部署到当前固件。

## 本地开发

建议 Node.js 22：

```bash
cd quickapp/velamotion_coach
npm ci
npm run test:core
npm run test:gesture
npm run test:motion
npm run test:ui-performance
npm run build
```

`src/common/algorithm` 为算法与模型接口，`src/common/sensor` 为采样和场景，`src/pages/index/index.ux` 为界面。板端桌面与构建脚本在 `../../board/huangshan_openvela`。

## 模拟器与发布包

在 AIoT-IDE 中打开本目录，或在已配置模拟器的环境运行 `npm start`。制作自己的 Release 时，先在 IDE 发布流程生成本地签名，再执行：

```bash
npm run release
```

生成位置为 `dist/com.velamotion.coach.release.1.0.0.rpk`。源码不包含 RPK 或签名私钥；完整黄山派开发验证镜像从项目 Releases 下载，其中应用使用工具链的公开开发测试证书。

示例安装命令（按实际模拟器标识修改）：

```bash
./node_modules/@miwt/adb/bin/linux/adb -s emulator-5554 push dist/com.velamotion.coach.release.1.0.0.rpk /data/tmp/com.velamotion.coach.release.1.0.0.rpk
./node_modules/@miwt/adb/bin/linux/adb -s emulator-5554 shell pm install /data/tmp/com.velamotion.coach.release.1.0.0.rpk
./node_modules/@miwt/adb/bin/linux/adb -s emulator-5554 shell am start com.velamotion.coach
```

更换签名时可能需要先卸载旧包，请先保存需要保留的本地训练数据。

## 本地验收与材料工具

```bash
npm run mock:official:dry
npm run model:inventory
```

连接相应模拟器后可运行 `npm run mock:official` 和 `npm run demo:capture`。模拟器 gRPC 注入/回读与应用内 Mock 分类是不同链路，不合并表述为真实传感器已完整接通。

`scripts/` 中保留演示采集、文档生成与材料检查工具。其 PDF、视频、ZIP、运行报告及开发日志是本地生成内容，不包含在源码发布中；提交检查需先自行准备相应本地材料。

## 更多说明

- [六轴接入](docs/six_axis_integration.md)
- [设备能力边界](docs/device_boundary.md)
- [模型迁移接口](docs/model_migration.md)
- [摘要导出](docs/sync_export.md)
- [隐私说明](docs/privacy_statement.md)

许可为 [Apache-2.0](LICENSE)，第三方依赖保留各自许可证。
