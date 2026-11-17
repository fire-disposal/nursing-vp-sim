# 语音服务开通与运行约束

## 商业服务口径

语音链路采用商业 ASR、现有 LLM 患者管线和商业 TTS，不在 `yecaoyun` 部署推理模型。
豆包流式语音识别 2.0 使用小时版资源 `volc.seedasr.sauc.duration`。当前官方后付费为
1 元/小时，SeedTTS 2.0 为 3 元/万字符。初期按量付费或购买小规格资源包，不做大额预付。

2026-11-17 已在火山控制台创建 `vp-sim-asr` API Key 并确认启用，随后购入 30 小时
流式 ASR 2.0 资源包。TTS 与 ASR 分别使用 `VoiceConfig.api_key` 和
`VoiceConfig.asr_api_key`，在成本管理的 TTS/ASR 页签独立配置，避免互相覆盖。
不要把 Key 写进仓库、前端环境变量或日志。ASR 调用以
`voice_call_logs.direction="asr"` 记录，成本按实际上行 PCM 秒数估算，最终以火山账单为准。
管理页的 ASR 连接测试只发送配置帧，不发送音频。

学生侧“电话”页是独立的全双工实验室，不写训练记录。四位虚构角色使用真实 LLM，
独立用途 `voice_demo` 复用 Provider 路由、密钥与成本统计；本地四维情绪状态机驱动
长回复打断、VAD/ASR 状态和 TTS 情绪表现。对话历史只留在当前页面，另设
`voice_demo_logs` 仅用于实验采集，不提供日志查看 UI，也不作为正式训练档案。
`/api/voice-demo/asr` 与 `/api/voice-demo/tts/stream` 只要求系统内已登录账号，不读取或
写入训练业务数据；persona/院校不参与这条链路。语音调用日志的 `record_id` 为 NULL，
费用仍按真实 ASR/TTS 用量产生。

首次部署可在后端 `.env` 设置 `VOLC_TTS_API_KEY` 与 `VOLC_ASR_API_KEY`。每个通道只在
数据库对应 Key 为空且从未完成 ENV 初始化时写入一次，并分别记录初始化状态。管理页之后
修改或清空 Key 不会被后续重启回写；另一通道以后仍可通过 ENV 独立补配。生产 `.env` 由
`env_file` 注入后端容器，不需要把密钥写进镜像或 GitHub Actions 日志。

官方资料：

- [语音服务计费](https://docs.volcengine.com/docs/doubao-voice/billing-instructions?lang=zh)
- [流式 ASR WebSocket](https://docs.volcengine.com/docs/doubao-voice/bidirectional-streaming-automatic-speech-recognition-websocket?lang=zh)
- [双向流式 TTS](https://docs.volcengine.com/docs/doubao-voice/bidirectional-streaming-text-to-speech-websocket?lang=zh)

## 设备与服务器边界

浏览器 VAD 使用自托管 Silero ONNX 和 WASM，首次需要下载约 17MB，静态文件由前端
Caddy 缓存。启动时进行实时性校准，运行中继续监测；设备无法实时处理时关闭 VAD，
保留云端 ASR 的基础语音模式。低性能设备不应因开启语音持续卡死。

2026-11-17 对 `yecaoyun` 的只读检查：2 核、3.8GiB 内存、约 1.9GiB 可用内存、36GiB
可用磁盘。`nursing-vp-sim-backend-1` 当时使用约 495MiB，容器限额 640MiB。新增链路只做
异步 PCM 转发，不保留整段音频，不增加模型进程。正式开放班级规模并发前仍需实测连接数、
容器内存和火山并发额度，不能把供应商默认 50 路 ASR 并发当作本机已验证容量。

## 启用后的人工验收

自动化测试不调用付费语音服务。完成充值和 Key 配置后，需要人工验证：

1. 外放患者语音时，学生转写中不得出现患者原话。
2. 学生持续说话约 450ms 且 ASR 识别出非空文本后才停播；短促应声、环境噪声和回录不应触发停播。
3. ASR `definite` 到达后只提交一次，断开旧会话后迟到结果不得进入新回合。
4. 同一音色、同一文本对比无情绪指令与有情绪指令的听感，重点检查焦虑、戒备和不耐烦。
5. 对照火山账单与本地 ASR/TTS 日志，确认成本口径和余额告警可用。

## 参考实现

- [LiveKit adaptive interruption handling](https://docs.livekit.io/agents/logic/turns/adaptive-interruption-handling/)：
  区分真实打断与 backchannel，打断有最短时长/词数，不靠单一 VAD。
- [Pipecat Speech Input & Turn Detection](https://docs.pipecat.ai/pipecat/learn/speech-input)：VAD、STT 与 turn classifier 组合判定用户回合。
- [Microsoft Voice Live Reference AEC](https://github.com/microsoft-foundry/voicelive-samples/tree/main/javascript/live-reference-aec)：
  把实际播放的 TTS 与麦克风同步作为回声参考，解决服务端 TTS 副本与实际扬声器输出不一致。
- [Silero VAD](https://github.com/snakers4/silero-vad)：本地 VAD 模型；电话页只用它提示开口，不直接赋予打断权。
