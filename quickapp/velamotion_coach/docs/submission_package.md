> 本文说明本地材料生成流程，列出的 PDF、视频、ZIP、RPK 和日志不随独立源码仓库分发。

# 参赛交付说明

作品：VelaMotion Coach / 腕动教练；方向：手表应用创新；队伍：DDLqudong（289）。
源码仓：https://github.com/rudykon/VelaMotion_Coach

## 官方仓库布局

- `quickapp/velamotion_coach/`：完整快应用源码、依赖锁定、签名 Release、文档、截图及视频。
- 历史 AI Coding 日志：按作者要求不上传，公开仓和 ZIP 均排除；该官方要求尚未完成。
- 仓库根 `skills/openvela-watch-acceptance/SKILL.md`：可复用验收 Skill。
- 专属仓清单增加快应用 linkfile，基线保持 `dev-ai-contest-2026`；官方 CLA workflow 不改动。

## 本地生成与验证

在快应用目录执行：

```bash
npm ci
npm run test:core
npm run test:motion
# 自行发布前，先在 AIoT-IDE 生成自己的签名
npm run release
# 模拟器在线后
npm run demo:capture
npm run submit:prepare
npm run submit:check
```

输出 ZIP：`artifacts/submission/velamotion_coach_submission.zip`。ZIP 是交付副本；正式参赛以专属仓 PR 和合入状态为准。本地检查通过不表示远程提交成功。

介绍材料：`docs/作品介绍.pdf`、`docs/作品介绍.docx`。视频：`artifacts/final_demo/auto_carousel/velamotion_core_demo.mp4`，为真实截图串联，非连续录屏。选择当前 core 四页，旧 11 页不进入包。

## 排除项与边界

不分发签名私钥、node_modules、构建缓存、原始训练数据和无关论文。可直接安装提供的签名 Release；重签应用可能需卸载旧版本。

当前使用 tiny_classifier 与模拟器场景。真机六轴能力、功耗与真实用户识别性能尚未验证。官方 Mock 注入/回读和应用内 Mock 运行分别提供证据；AI 协作与未提交日志说明见 `docs/ai_coding_disclosure.md`。
