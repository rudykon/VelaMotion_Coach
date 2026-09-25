# 最终演示脚本

## 演示目标

证明作品在四页信息架构内具备完整闭环：Mock 运动健康数据 → 端侧识别 → 教练建议 → 时间线复盘 → 本地历史/手机同步 → 真机诊断与隐私说明。

## 自动截图/视频链路

```bash
cd openvela_velamotion_coach
npm run release
npm run demo:capture
```

输出：

```text
artifacts/final_demo/auto_carousel/core_01_home.png
artifacts/final_demo/auto_carousel/core_02_coach.png
artifacts/final_demo/auto_carousel/core_03_timeline.png
artifacts/final_demo/auto_carousel/core_04_sync_review.png
```

如安装 `ffmpeg`，还会生成：

```text
artifacts/final_demo/auto_carousel/velamotion_core_demo.mp4
```

视频为四张实际模拟器截图串联，每页停留 10 秒，不是连续交互录屏。

## 启动方式

`demo:capture` 优先使用当前 Vela5 工具链实际支持的 `adb shell am start com.velamotion.coach`；如果该方式不可用，再兜底尝试串口 `vapp hap://app/com.velamotion.coach`。

## 人工讲解顺序

1. 首页：展示“运动伙伴”、当前运动、心率、步数、强度、风险与开始/停止；运行中处理状态为“腕上初筛”。
2. 教练：展示场景入口、前三候选（底层保留 6 类概率）、疲劳/异常提示以及 velaclaw 或本地模板建议。
3. 时间线：展示自动片段合并、运动占比、强度趋势与风险记录。
4. 同步复盘：集中展示本地历史、手机同步、真机诊断和隐私控制。有效停止后为“待同步”；发送成功仅显示“已发手机 / 等待精确结果”；只有收到规范的完整 3s/5s/8s 手机结果后才显示“手机精确复盘”。

## 口播要点

- 不要求用户手动选择运动类型，核心识别在手表端完成。
- ACC/GYRO 用于动作识别；HR/steps 用于强度解释、风险提醒和复盘。
- 官方 gRPC 注入/回读与应用内 Mock 分类分开验收；当前步数由应用内 Mock 生成。
- 真机能力未伪造：应用提供诊断页；缺少 GYRO 时完整真机识别会被阻断且不会保存，拿到六轴接口后再逐项验证。
- 原始波形不落库、不上传，历史和手机同步只处理摘要。

2026-08-09 生成的旧 11 页截图和 `velamotion_final_demo.mp4` 可保留作历史证据，但当前演示顺序、自动捕获和提交验收只使用上述四页制品。
