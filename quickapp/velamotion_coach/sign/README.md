# 本地发布签名

源码仓库不包含已签名 RPK 或私钥。完整黄山派开发验证固件从项目 Releases 获取，其中应用使用工具链公开的开发测试证书。

重建自己的 Release 时，在 AIoT-IDE 打开快应用工程，点击“发布”并填写本地签名信息；工具会在 `sign/release/` 生成 `private.pem` 与 `certificate.pem`，然后执行 `npm run release`。新签名与已有安装包不同，可能需要先卸载旧包，请先保存需要保留的训练数据。

签名文件由 Git 忽略，不应提交到公开仓库。
