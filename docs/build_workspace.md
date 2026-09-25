# 独立源码仓与 openvela 工作区

本仓库维护腕动教练源码、黄山派适配和 WebAssembly 展示页，默认分支为 `main`。第三方 openvela 依赖继续使用清单中的 `dev-ai-contest-2026` 分支及 `board/huangshan_openvela/sources-lock.json` 记录的来源。

## 获取项目

```bash
git clone https://github.com/rudykon/VelaMotion_Coach.git
cd VelaMotion_Coach
```

只体验网站时，见 [website/README.md](../website/README.md)。下载和烧录当前固件，见 [黄山派指南](../board/huangshan_openvela/README.md) 与 [Releases](https://github.com/rudykon/VelaMotion_Coach/releases)。固件二进制通过 Release 分发，下载后按清单核对 SHA256。

## 使用 repo 清单

在独立空工作区执行（需要预先安装 `repo` 工具）：

```bash
repo init -u https://github.com/rudykon/VelaMotion_Coach \
  -b main -m velamotion.xml
repo sync
```

`velamotion.xml` 引入 `openvela.xml`，并将此项目的应用、快应用和板级样例链接到 openvela 工作区。清单中的第三方依赖仍属于各自官方仓库；独立项目分支 `main` 与第三方的开发分支是两个不同概念。

黄山派当前适配的实际构建入口位于 `board/huangshan_openvela/`；模板目录 `board/contest_board/` 仅为通用板级样例。重新构建需准备匹配的 Linux/WSL、工具链、源码归档与 GUI 库，并按该目录 README 配置路径。

## 路径与生成文件

- Windows 脚本使用 `python` 命令，可通过 `-Python` 指定本机解释器。
- 历史归档恢复工具 `prepare-linux-sources.py` 必须显式传入 `--cache /path/to/verified-archives`，不包含个人缓存路径。
- `D:\wsl_ubuntu`、`/opt/openvela` 是构建脚本的默认工作目录，需按本机环境配置。
- 报告、视频、交付 ZIP、签名 RPK 和开发日志在本地生成并由 Git 忽略。私钥不随源码分发。

本仓库是独立项目展示与源码入口；不据此声明官方赛事提交状态。
