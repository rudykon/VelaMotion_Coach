# 腕动教练 · GitHub Pages 展示页

[打开在线展示](https://rudykon.github.io/VelaMotion_Coach/)

项目介绍、快应用同源实时预览、真实 WebAssembly 计算演示、黄山派实物照片与固件入口。纯静态页面，无服务器推理、外部字体、统计脚本或第三方运行时 CDN。

## 本地运行

需要 Node.js 22 或更新版本：

```sh
cd website
npm ci
npm run build
npm test
npm run serve
```

浏览器打开 `http://127.0.0.1:4173`。请通过 HTTP 服务访问，直接打开 `file://` 不能正常加载模块和 Worker。

浏览器交互回归：

```sh
npx playwright install chromium
npm run test:browser
```

可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定已有 Chromium；通过 `BASE_URL` 指定带末尾 `/` 的已部署网站。测试覆盖完整混合会话、暂停/继续/重置、场景切换、后台暂停、计算跑分、导出、WASM 加载失败与重试、手机布局和运行时请求来源。

## 快应用同源实时预览

[独立打开预览](https://rudykon.github.io/VelaMotion_Coach/preview/)，或在主页点击“启动快应用预览”。入口按需加载，不自动开始训练。

- `scripts/build-preview.mjs` 在构建时从 `quickapp/velamotion_coach/src/pages/index/index.ux` 提取原始模板、完整样式、页面脚本，打包其依赖的 26 个业务模块。使用 htmlparser2、Acorn 与 esbuild；版本锁定在 package-lock.json。模板表达式提前编译，浏览器不使用 eval；遇到不支持的组件、属性或表达式会让构建失败。
- `preview/renderer.js` 在 Shadow DOM 内适配本项目用到的 div、text、input、list、list-item，支持 if/show/for、响应式状态、事件冒泡和生命周期。480 × 554 页面坐标按屏幕宽度缩放；鼠标、触控和键盘回送原始 `TouchGesture`，保留滑动取消点击的逻辑。外部页签是预览辅助导航。
- `preview/entry.js` 调用原来的 `setNativeModelBackend()` 接入 `preview/wasm-backend.js`：WASM 返回六类评分与完整 23 项特征，供原始初筛、风险判断和时序整理继续使用。原业务中的分步 JS 特征准备仍保留；计时只包含 WASM 调用，不是整条训练链路耗时。
- `@system.storage` 映射到当前页面的独立内存，刷新清空。其余 `@system.*`、`@service.*` 作为不可用能力交给原业务处理，不读取访客传感器，不发送手机消息或云端请求。本地训练建议仍来自项目原始规则。切到后台时经原停止流程结束训练，以避免浏览器后台定时器节流造成计时误解。
- `dist/preview/source-info.json` 记录 UX SHA256、业务源文件整体哈希和模块列表。预览样式没有手工另写一份业务界面；后续修改原 UX / common 源文件会触发 Pages 重建。

**范围：这是为本项目实现的源码兼容预览，不是通用 QuickApp 引擎，不支持上传或加载任意 RPK，也没有运行 openvela 内核、QuickJS/LVGL 原生 GUI 或黄山派外设。** 浏览器 CSS 的文本、换行与布局细节可能与板端不同。

当前官方 [QuickApp 容器说明](https://github.com/open-vela/frameworks_runtimes_quickapp) 将核心与 GUI 模块作为预编译库提供；本地模拟器为原生程序，不能直接当作浏览器 WASM 使用。本项目没有实现完整模拟器的 WebAssembly 移植，也不需要远程模拟器服务。

新增验证覆盖：原页面开始／停止、WASM 调用、非空时间线、本地建议、历史及刷新清空、滑动取消误触、键盘与返回入口、真机能力不足、WASM 加载失败／重试、移动布局及仅同源静态资源请求。数值测试还检查浏览器后端返回的特征与原分类器一致，避免风险分析丢失特征。

## 算法实验室的计算链路与边界

1. Worker 复用项目 `mock_scenarios.js`，按 16 Hz 虚拟时间生成六轴数据。种子固定为 289，每次重置可重放。`4×` 只加快演示时间推进，不改变算法采样率。
2. AssemblyScript 将项目 `imu_features.js` / `tiny_classifier.js` 的数值计算移植为 WASM：48 帧 × 6 通道，3 秒窗口、1 秒步长，23 个特征、六类候选评分。移植来源为本仓库同目录下的 JS 算法，构建信息记录其内容哈希。这是一套特征规则模型，未部署深度模型。
3. 项目原有 JS `TemporalRecordLayer` 负责平滑、时序解码与片段整理；浏览器负责控件和 Canvas。末尾片段为当前解码结果，未额外伪造最终识别。
4. 每段会话有固定长度（混合训练 62 秒），完成后停止；页面转入后台自动暂停。重置与场景切换通过会话编号排除过期消息。
5. 计时来自 `performance.now()`。单窗口计时不含数据复制、JS 时序解码和绘图；批量计时为预热后重复执行当前窗口 3,000 次。它反映当前浏览器的内核执行耗时，不代表黄山派性能或人体识别准确率。

WASM 接口：`input_ptr()` 指向 288 个 f64（逐帧 accX/Y/Z、gyroX/Y/Z）；`classify(heartRate)` 返回类别下标；`output_ptr()` 指向六类归一化评分；`features_ptr()` 指向 23 个特征。`heartRate` 使用合成场景值，传 0 表示使用项目默认值。线性内存固定为 64 KiB，计算时不分配新缓冲区。ABI 版本为 1，分类顺序与原项目 `CLASS_NAMES` 一致。

`test/wasm.test.mjs` 对照原 JS 的 192 个有种子窗口和边界输入，逐项验证特征、评分与类别，同时验证固定内存和重复计算。WASM 加载失败时显示错误并停止演示，不使用伪装成 WASM 的 JS 替代路径。

网站不连接开发板、不读取真实传感器。黄山派当前固件仍运行 JS 实现，真实六轴到 JS、断电持久化及真人效果验证仍待完成。候选评分不是识别准确率。算法实验室所有演示数据留在浏览器；导出通过本地 Blob 下载 JSON。

## 构建与部署

- `assembly/classifier.ts`：可审查的 WASM 数值实现。
- `public/`：页面、样式、Worker 与交互逻辑；`public/preview/` 为预览外壳。
- `preview/`：原 UX 页面的浏览器兼容层、存储适配与 WASM 计算后端。
- `scripts/build.mjs`：编译 WASM，仅复制上述页面、三个算法/场景 JS 模块、三张已移除定位元数据的公开照片和许可证到 `dist/`，再生成 `dist/preview/` 的原页面 JS/CSS 与来源校验信息。
- `dist/build-info.json`：WASM 文件大小与 SHA256，以及算法来源信息。
- `.github/workflows/pages.yml`：`main` 分支触发构建、数值对照、浏览器测试与 Pages 发布；只发布 `website/dist/`。

`dist/`、依赖、测试截图与临时下载不提交 Git。比赛报告、讲解视频、交付 ZIP 和开发日志不属于网站构建输入。源码遵循仓库 Apache-2.0 许可证；AssemblyScript 编译器为 Apache-2.0，构建/测试依赖版本锁定在 `package-lock.json`。
