# 语音服务开通与运行约束

## 商业服务口径

语音链路采用商业 ASR、现有 LLM 患者管线和商业 TTS，不在 `yecaoyun` 部署推理模型。
豆包流式语音识别 2.0 使用小时版资源 `volc.seedasr.sauc.duration`。当前官方后付费为
1 元/小时，SeedTTS 2.0 为 3 元/万字符。试用阶段按量付费，不预购资源包。

2026-11-17 已在火山控制台创建 `vp-sim-asr` API Key 并确认启用。创建 Key 不等于完成
ASR 商品开通或账户充值；生产启用前仍需在控制台确认语音识别 2.0 已开通且余额可用。

后端从当前启用的 `VoiceConfig.api_key` 同时读取 TTS 与 ASR 凭证，因此录入的 Key 必须
同时具备两项服务权限。不要把 Key 写进仓库、前端环境变量或日志。ASR 调用以
`voice_call_logs.direction="asr"` 记录，成本按实际上行 PCM 秒数估算，最终以火山账单为准。

官方资料：

- [语音服务计费](https://docs.volcengine.com/docs/doubao-voice/billing-instructions?lang=zh)
- [流式 ASR WebSocket](https://docs.volcengine.com/docs/doubao-voice/bidirectional-streaming-automatic-speech-recognition-websocket?lang=zh)
- [双向流式 TTS](https://docs.volcengine.com/docs/doubao-voice/bidirectional-streaming-text-to-speech-websocket?lang=zh)

## 设备与服务器边界

浏览器 VAD 使用自托管 Silero ONNX 和 WASM，首次需要下载约 17MB，静态文件由前端
Nginx 缓存。启动时进行实时性校准，运行中继续监测；设备无法实时处理时关闭 VAD，
保留云端 ASR 的基础语音模式。低性能设备不应因开启语音持续卡死。

2026-11-17 对 `yecaoyun` 的只读检查：2 核、3.8GiB 内存、约 1.9GiB 可用内存、36GiB
可用磁盘。`nursing-vp-sim-backend-1` 当时使用约 495MiB，容器限额 640MiB。新增链路只做
异步 PCM 转发，不保留整段音频，不增加模型进程。正式开放班级规模并发前仍需实测连接数、
容器内存和火山并发额度，不能把供应商默认 50 路 ASR 并发当作本机已验证容量。

## 启用后的人工验收

自动化测试不调用付费语音服务。完成充值和 Key 配置后，需要人工验证：

1. 外放患者语音时，学生转写中不得出现患者原话。
2. 学生持续说话约 250ms 后才停播；短促应声和噪声不应触发停播。
3. ASR `definite` 到达后只提交一次，断开旧会话后迟到结果不得进入新回合。
4. 同一音色、同一文本对比无情绪指令与有情绪指令的听感，重点检查焦虑、戒备和不耐烦。
5. 对照火山账单与本地 ASR/TTS 日志，确认成本口径和余额告警可用。
