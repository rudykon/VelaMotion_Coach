# 2026-09-20 提交前验证

本轮验收以当前四页源码和新生成 Release 为准；历史报告保留用于追溯。

| 检查 | 本轮结果 |
|---|---|
| Node / 工具链 | v22.23.1 / aiot-toolkit 2.0.5 |
| 核心回归 | `npm run test:core`：53/53 通过 |
| 运动回归 | `npm run test:motion`：六类、多 seed、混合训练、疲劳提示均通过；仅为合成数据验证 |
| Release | 生产编译与签名成功 |
| 安装一致性 | 模拟器页面 bundle SHA-256 与新 Release 一致（日志前缀 c1ba4d653469af05） |
| 动态识别 | 日志确认跑步，活动卡区域确认 495 个对应颜色像素 |
| 四页采集 | collected=4/4，四页哈希不同，严格 QA 通过 |
| 官方 Mock | 本轮 7 秒注入，ACC、GYRO、Sensor/Physical 心率回读通过；无步数 enum |
| 视频 | 4 张真实截图串联，MP4，不超过 5 分钟；非连续录屏 |
| 介绍文件 | 4 页 PDF 与 DOCX，检查中英文数字字形和截图布局 |
| AI 日志 | 按作者要求不公开，官方日志提交项未完成 |
| Skill | quick_validate.py：Skill is valid |
| 最终包 | 以 artifacts/submission/submission_check_report.json 的最终结果和 SHA-256 为准 |

## 保留的证据

本目录 `validation/` 保留 Release 构建和四页采集输出；`artifacts/mock_verification/official_mock_report.json` 保留本轮传感器注入回读。截图和介绍文件均为本轮生成。

## 不外推的结论

模拟器通过不等于真机通过。界面置信度不等于真实人群准确率。当前模型为规则/特征模型；未部署原论文深度模型。本地预编译镜像未完成大赛分支源码版本溯源。手机配对与真实功耗待后续验证。
