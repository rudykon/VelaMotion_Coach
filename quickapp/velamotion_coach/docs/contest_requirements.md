# 官方要求与作品对应

此文保留原参赛材料要求的核对说明，表中的 PDF、视频、RPK 与运行记录为本地产物，不随当前独立源码仓库分发。

核对日期：2026-09-20。官方发布的作品提交截止日为 9 月 20 日；具体关闭时刻未在所查指南明确。

| 官方要求 | 本作品交付 / 验证 |
|---|---|
| 专属 GitHub 仓，fork → PR → 自行合入 | 本仓为独立源码展示仓；官方参赛提交状态以组委会平台为准 |
| 大赛分支 dev-ai-contest-2026 | 官方仓在该分支接入 quickapp；未追溯本机预编译 SDK 镜像的源码 commit |
| 快应用源码 + Release RPK | quickapp/velamotion_coach/src、package.json、package-lock.json、dist |
| 初赛模拟器验证及完整交互 | 本轮安装、动态识别、停止、四页截图严格检查通过 |
| 运动健康 Mock 验证 | 应用内场景回归；官方 gRPC 注入/回读单独通过，步数仍应用内 Mock |
| 介绍文档 .docx / .pdf / .pptx | docs/作品介绍.docx、docs/作品介绍.pdf |
| 不超过 5 分钟的演示视频 | core MP4，实际模拟器截图串联；非连续录屏 |
| 真实 AI Coding 日志 | **未提交**。按作者要求仅保留本地，公开仓和 ZIP 不含历史开发日志 |
| 至少一个有效 Skill | skills/openvela-watch-acceptance/SKILL.md，来自已复现的发布验收流程 |
| Apache-2.0 | LICENSE；第三方依赖保留各自许可证 |
| 基于 openvela 并落地图形/AI/多媒体之一 | .ux 图形界面、系统存储/振动/健康接口；图形能力已落地 |
| CLA 检查 | 独立展示仓不运行赛事 CLA workflow；向官方贡献时按官方仓库要求处理 |

## 一手依据

- [大赛总览](https://github.com/open-vela/docs/blob/dev-ai-contest-2026/zh-cn/contest_2026/contest_overview.md)：时间、交付文件、许可、Skill 与评分。
- [提交指南](https://github.com/open-vela/docs/blob/dev-ai-contest-2026/zh-cn/contest_2026/code_submission_guide.md)：专属仓、PR、权限、CLA。
- [手表应用指引](https://github.com/open-vela/docs/blob/dev-ai-contest-2026/zh-cn/contest_2026/quickapp/watch_app_track_guide.md)：快应用与模拟器要求。
- [快应用手动开发](https://github.com/open-vela/docs/blob/dev-ai-contest-2026/zh-cn/contest_2026/quickapp/quickapp_manual.md)：Release 与安装方式。
- [日志手册](https://github.com/open-vela/docs/blob/dev-ai-contest-2026/zh-cn/contest_2026/ai_coding_log_guide.md)：日志归集与验证。
