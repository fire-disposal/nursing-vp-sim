# 语音服务运维指南

> 适用版本: current | 最后更新: 2026-06-22

涵盖 LLM、TTS（文字转语音）、ASR（语音识别）三项 AI 服务的开通、配置、成本控制与故障排查。

---

## 1. 服务购买与开通

### 1.1 火山引擎账号注册

1. 访问 [火山引擎控制台](https://console.volcengine.com/) → 注册/登录账号
2. 完成实名认证（企业认证可享更高配额）
3. 进入控制台 → 顶部搜索"语音技术" → 进入语音技术产品页

### 1.2 开通语音技术（TTS + ASR）

1. 在语音技术产品页点击"立即开通"
2. 选择服务：
   - **大模型语音合成**（TTS）— 用于患者语音播报
   - **实时语音识别**（ASR）— 用于学生语音输入转文字
3. 开通后在"密钥管理"页面获取 **App ID** 和 **Access Token**
4. 两项服务共用同一套 App ID + Token，无需分别获取

> [截图: 火山引擎控制台 → 语音技术 → 密钥管理页面]

### 1.3 DeepSeek LLM API（已在用）

1. 访问 [DeepSeek Platform](https://platform.deepseek.com/) → 注册/登录
2. 进入 "API Keys" 页面 → 创建新 Key
3. API 地址：`https://api.deepseek.com/v1`（兼容 OpenAI 格式）
4. 将 API Key 配置到管理面板的 "LLM API" Tab

> [截图: DeepSeek Platform → API Keys 页面]

### 1.4 定价参考

| 服务 | 计费方式 | 参考单价 | 官方定价页 |
|------|---------|---------|-----------|
| DeepSeek (LLM) | 按 token 计费 | 输入 ¥1/百万 tokens，输出 ¥2/百万 tokens | https://platform.deepseek.com/api-docs/pricing |
| 大模型语音合成 (TTS) | 按字符数计费 | 约 ¥2/百万字符（折合 ¥0.000002/字符） | https://www.volcengine.com/docs/6561/109867 |
| 实时语音识别 (ASR) | 按音频时长计费 | 约 ¥3.5/小时（折合 ¥0.00005/识别字符） | https://www.volcengine.com/docs/6561/109868 |

> 注：火山引擎新注册用户通常赠送免费额度，实际计费以控制台显示为准。

---

## 2. API 密钥配置

### 2.1 配置 LLM API Key

**管理面板路径**：管理后台 → 成本管理 → LLM API Tab

系统已通过种子数据 (`backend/core/seed.py:238`) 自动从 `.env` 的 `DEEPSEEK_API_KEY` 创建一条初始密钥记录。

如需新增或更换密钥：

1. 在 LLM API Tab 点击 "新建 API 档案"
2. 填写：
   - **标签**：可读名称，如"主密钥"、"备用密钥"
   - **API Key**：DeepSeek 控制台获取的 `sk-xxx`
   - **Base URL**：`https://api.deepseek.com/v1`
   - **输入/输出 token 定价**：用于成本统计（默认 ¥1/¥2 每百万 tokens）
   - **月预算上限**：可选，如 `200`
3. 创建后在 "LLM 用途分配" 区域绑定用途（patient_chat / scoring / qa 等）

> [截图: 管理后台 → 成本管理 → LLM API Tab → 新建 API 档案弹窗]

### 2.2 配置 VoiceConfig（语音服务）

**管理面板路径**：管理后台 → 成本管理 → 语音服务 Tab

1. 在火山引擎控制台获取 App ID 和 Access Token（见 1.2）
2. 填入配置表单：
   - **App ID**：火山引擎分配的 App ID
   - **Token**：火山引擎 Access Token（留空不修改已有 Token）
   - **TTS 语音类型**：默认 `zh_female_vv`（女声），可选 6 种声线
   - **ASR 采样率**：默认 `16000`（推荐），可选 8000~48000
   - **月度预算**：默认 ¥200
3. 点击 "保存配置"
4. 点击 "测试 TTS" / "测试 ASR" 验证连通性

> [截图: 管理后台 → 成本管理 → 语音服务 Tab → 配置表单 + 测试按钮]

### 2.3 密钥加密存储

- **LLM API Key**：通过 Fernet 对称加密存入 `api_secrets` 表，`key_suffix` 字段存末 4 位用于完整性校验
- **语音服务 Token**：同上，存入 `voice_configs` 表，`key_suffix` 存末 8 位
- 密钥解密失败时系统自动回退到环境变量 `DEEPSEEK_API_KEY`

### 2.4 密钥轮换流程

**LLM Key 轮换**：
1. 在 DeepSeek 平台创建新 Key
2. 在管理面板 LLM API Tab 新建一条 API 档案（新 Key）
3. 将 LLM 用途从旧档案切换到新档案
4. 观察新档案 `call_count_today` 上升确认生效
5. 删除旧档案（或设为 `degraded`）

**语音 Token 轮换**：
1. 在火山引擎控制台重新生成 Access Token
2. 在管理面板语音服务 Tab 修改 Token 输入框并保存
3. 点击 "测试 TTS" + "测试 ASR" 确认新 Token 可用

### 2.5 连通性测试按钮

| 按钮 | 位置 | 测试内容 |
|------|------|---------|
| 测试 TTS | 语音服务 Tab | 调用火山引擎 TTS 合成 "测试" 二字 → 检查返回音频 |
| 测试 ASR | 语音服务 Tab | 调用火山引擎 ASR 健康检查 |
| 测试 LLM | LLM API Tab（API 档案设置） | 发送轻量对话请求验证 Key 可用 |

后台实现：`backend/routers/admin_voice.py:124-220`，返回 `{provider, tts_online, asr_online, last_error}`。

---

## 3. 成本控制

### 3.1 成本估算公式

系统在每次调用时自动记录费用到 `voice_call_logs` 和 `llm_call_logs` 表：

| 服务 | 代码位置 | 公式 | 示例 |
|------|---------|------|------|
| LLM | `admin_voice.py:227` 读取 `llm_call_logs.estimated_cost` | `input_tokens × 输入定价 + output_tokens × 输出定价` | 一次患者对话约 ¥0.002~0.005 |
| TTS | `backend/routers/tts.py:28` | `字符数 × 0.000002 CNY` | 200 字一句话 ≈ ¥0.0004 |
| ASR | `backend/routers/asr.py:47` | `字符数 × 0.00005 CNY` | 30 字识别文本 ≈ ¥0.0015 |

### 3.2 月度预算设置

- **LLM 月预算**：按每条 ApiSecret 的 `monthly_cost_limit` 字段累加（LLM API Tab）
- **语音月预算**：VoiceConfig 的 `monthly_budget` 字段（语音服务 Tab）
- **建议**：中小规模学校 ¥200/月可支撑约 450 次完整训练
- 预算为 0 时不限流

### 3.3 预算告警机制

| 阈值 | 效果 |
|------|------|
| < 80% | 正常使用，Dashboard 仪表盘显示绿色 |
| 80%~90% | Dashboard 仪表盘显示黄色提醒 |
| ≥ 100%（TTS） | TTS 自动绕过火山引擎，切换为**浏览器内置 TTS**（`SpeechSynthesis`），学生听不到火山音色但训练可继续 |
| ≥ 100%（LLM） | 不再发起新 LLM 请求，训练进入降级模式 |

前端 TTS 自动降级链：`frontend/src/engine/tts/TTSManager.ts:128-143`
- 先尝试火山 TTS（带情感参数）
- 火山失败或预算耗尽 → 自动回退浏览器 `SpeechSynthesis`
- Circuit Breaker（熔断器）连续失败 3 次后熔断 5 分钟

### 3.4 成本 Dashboard 使用说明

**路径**：管理后台 → 成本管理 → 总览仪表盘

4-Tab 页面结构：

| Tab | 功能 |
|-----|------|
| 总览仪表盘 | 环形预算仪表盘 + 30 天趋势折线图 + Top Users 排行榜 |
| LLM API | 今日/本月 LLM 费用卡片 + API 密钥管理 |
| 语音服务 | 火山配置表单 + TTS/ASR 按日/月统计表 |
| 导出与检查 | 按日期范围 + 服务类型 + 粒度导出 CSV/JSON |

> [截图: 成本管理 → 总览仪表盘 → 4 个 Tab 的页面截图]

---

## 4. 内置成本估测工具

### 4.1 预算仪表盘（圆形进度条）

位置：总览仪表盘 Tab → "月度预算" 卡片

- 环形进度条显示当月已用预算占比
- 绿色（< 70%）→ 黄色（70%~90%）→ 红色（> 90%）
- 中心文字显示百分比，下方显示 "已用 ¥xx / ¥xx"
- 前端实现：`frontend/src/pages/admin/cost/CostDashboard.tsx:32-86`

> [截图: 预算仪表盘圆形进度条]

### 4.2 30 天成本趋势图

位置：总览仪表盘 Tab → "30 天费用趋势" 折线图

- X 轴：日期（近 30 天）
- Y 轴：费用（元）
- 三条折线：蓝色 = LLM，青色 = TTS，橙色 = ASR
- Hover 显示当天各服务明细
- 后台实现：`backend/routers/admin_voice.py:334-387`

> [截图: 30 天成本趋势折线图]

### 4.3 Top 用户消耗排行榜

位置：总览仪表盘 Tab → "费用排行 Top Users"

- 表格显示：用户名、调用次数、总费用
- 按总费用从高到低排列，取前 10 名
- 合并 LLM + TTS + ASR 三项总费用
- 后台实现：`backend/routers/admin_voice.py:436-491`

> [截图: Top Users 费用排行表]

### 4.4 导出功能

位置：成本管理 → 导出与检查 Tab

**筛选选项**：
- **日期范围**：起始日期 ~ 结束日期（默认近 30 天）
- **服务类型**：LLM / TTS / ASR / 全部
- **粒度**：按日 / 按月
- **导出格式**：CSV / JSON

**API 端点**：`GET /api/admin/voice/costs/export?start_date=...&end_date=...&service=...&granularity=...&format=csv`

CSV 导出含 UTF-8 BOM，Excel 直接打开无乱码。

> [截图: 导出与检查 Tab → 筛选表单 + 下载按钮]

---

## 5. 故障排查

### 5.1 TTS 不出声 / 报错

```
排查路径：
VoiceConfig 是否配置？ → 管理面板 → 语音服务 Tab → 查看 App ID / Token
    ↓ 未配置
    按 1.2 开通火山引擎 → 按 2.2 填入配置

连通性测试通过？ → 点击"测试 TTS"按钮
    ↓ 失败
    检查火山控制台 → 余额是否耗尽 → Token 是否过期

TTS 开关是否开启？ → 训练页面右上角 TTS 切换按钮
    ↓ 关闭
    点击开启 TTS 自动播放

服务端熔断中？ → 查看后端日志
    ssh yecaoyun "docker logs nursing-backend-staging --tail 50 | grep 'TTS circuit'"
    熔断器 5 分钟后自动恢复，前端已切换浏览器 TTS 兜底
```

### 5.2 ASR 识别失败 / 不准确

```
排查路径：
VoiceConfig 是否配置？ → 同上
    ↓
连通性测试通过？ → 点击"测试 ASR"按钮
    ↓
浏览器麦克风权限？ → 检查浏览器地址栏左侧权限图标
    ↓
网络是否正常？ → 可 ping openspeech.bytedance.com
    ↓
环境噪音？ → 建议在安静环境下使用，或调低 ASR 采样率（8000）
```

### 5.3 LLM 调用失败

```
排查路径：
API Key 有效？ → LLM API Tab → 查看 secret 状态（active/degraded）
    ↓
调用次数过多？ → 检查 ApiSecret 的 call_count_today
    ↓
余额不足？ → 登录 DeepSeek Platform 查看余额
    ↓
健康检查？ → ssh yecaoyun "curl -sf 'http://127.0.0.1:9081/api/diagnose?token=...'"
    查看 LLM 成功率
```

### 5.4 成本异常增长

```
排查路径：
Top Users → Dashboard → Top Users 排行榜 → 是否有异常高消耗用户
    ↓
导出明细 → 导出与检查 Tab → 筛选日期范围和服务类型 → 导出 CSV
    ↓ 分析明细
    定位到具体训练记录 → 查看对话日志 → 是否异常长对话/死循环
```

### 5.5 浏览器 TTS 回退（正常降级行为）

现象：训练页面患者语音音色变为浏览器自带机械音

这不是错误。原因可能是：
- 月度预算 ≥ 100%，系统自动切换
- 火山 TTS 熔断器打开（连续 3 次调用失败）
- 火山 TTS 服务端暂时不可用

前端 TTS 管理器会自动在火山恢复后切回火山音色，无需人工干预。

> 训练页面顶部会显示黄色指示灯表示当前使用浏览器回退。

---

## 6. 常见问题

### Q: 为什么听不到患者语音？

A: 按顺序检查：① 训练页面右上角 TTS 开关是否开启 ② 管理面板语音服务 Tab 的 App ID/Token 是否已配置 ③ 点击"测试 TTS"确认连通性 ④ 火山引擎控制台查看余额/配额。

### Q: 语音识别总是不准确？

A: 检查 ① 浏览器麦克风权限是否开启 ② 网络连接是否稳定 ③ 环境是否有较大噪音 ④ 尝试降低 ASR 采样率（8000 对噪音更宽容）。

### Q: 成本超出预算了？

A: TTS 侧超预算后系统自动切换浏览器内置 TTS，不影响训练进行。如需恢复火山音色，请到管理面板调高 VoiceConfig 的月度预算。

### Q: 如何更换患者声线？

A: 两种方式：
- **全局默认**：管理面板 → 语音服务 Tab → TTS 语音类型下拉 → 选择声线 → 保存
- **按病例配置**：管理后台 → 病例管理 → 编辑病例 → 人格配置 → 声线选择（患者年龄+性别自动匹配音色）

可选声线：`zh_female_vv`（女声）、`zh_male_vv`（男声）、`zh_female_qingxin`（清新女声）、`zh_male_qingse`（青涩男声）、`zh_female_shuangkuai`（爽快女声）、`zh_male_yingjun`（英俊男声）。

**自动声线匹配**逻辑：`backend/infrastructure/tts/mapper.py:33-59` — 根据病例中的患者年龄和性别自动选择最合适的声线（如儿童选童声、老妇人选老年女声）。

### Q: LLM 响应速度慢？

A: 影响因素：① 训练高峰时段并发量大 ② DeepSeek API 服务端负载 ③ 请求 token 数过大。可在 LLM API Tab 查看平均延迟（Dashboard 的 `latency_ms_avg`）。

### Q: 如何临时禁用某个服务？

A: 
- **禁用 LLM**：LLM API Tab → 将对应 ApiSecret 状态改为 `degraded`
- **禁用 TTS/ASR**：语音服务 Tab → 将 `is_active` 取消勾选并保存；前端 TTS 会自动切换到浏览器兜底

### Q: 数据存储在哪里？

A: 
- 配置：`voice_configs` 表（VoiceConfig），Token Fernet 加密
- 调用日志：`voice_call_logs` 表（每次 TTS/ASR 调用一条记录）
- LLM 日志：`llm_call_logs` 表
- 所有费用统计从这两个日志表实时计算
