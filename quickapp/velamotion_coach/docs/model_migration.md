# 原模型等价迁移说明

本项目已保留原论文模型迁移接口，但快应用 MVP 默认使用 `tiny_classifier`。

## 当前实现

- `src/common/algorithm/model_backend.js`：模型后端桥。
- `MotionEngine` 只调用 `classifyWindowWithBackend()`，不直接绑定 tiny 规则模型。
- 若目标设备提供 native/量化模型，可通过 `setNativeModelBackend()` 注册后端，或由原生适配层暴露 `globalThis.velamotionModel.classifyWindow()`；失败时自动回退 `tiny_classifier`。

## 原模型资产

运行：

```bash
npm run model:inventory
```

输出：

```text
artifacts/model_migration/model_asset_report.json
```

该报告会列出原项目 `saved_models` 下的 `.pth/.pkl/.onnx/.tflite` 等模型、大小和 SHA256。当前推荐 3s 模型为 `combined_model_3s_seed42.pth`，对应 `norm_params_3s.pkl`。

## 为什么不能直接在 Quick App JS 中加载 .pth

PyTorch `.pth` 是 Python/PyTorch 运行时权重，openvela 快应用 JS 不能直接执行。要达到“原模型等价推理”，需要走以下路线之一：

1. PyTorch → ONNX → MNN/TFLite/其他 openvela 可用 native runtime。
2. 在系统侧实现 native 推理能力，并通过快应用可调用的适配层注册到 `setNativeModelBackend()`，或暴露为 `globalThis.velamotionModel`。
3. 后端对外提供 `classifyWindow({ samples, context })`，返回 `{ classIdx, className, confidence, probs, features }`。
4. 快应用无需改 TRL/UI，只替换后端输出。

## 当前可声明范围

可声明：已完成原模型迁移接口、模型资产清单和降级框架；当前演示使用基于原类别和 IMU 特征逻辑的端侧 `tiny_classifier`。

不可声明：已经在 openvela 真机中运行 PyTorch 原模型，或已经完成论文模型等价精度验证。
