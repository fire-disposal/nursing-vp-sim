> 派生文件：由 `backend/scripts/render_cases.py` 从 `backend/modules/scenario_training/packs/*.json` 生成。
> `packs/*.json` 是唯一真源；改了病例请重新生成，不要手改这一份。

# 两床同铃：会叫的能等，不叫的危重（`two-beds-priority`）

> 夜班，两床同时按铃：一个喊得整条走廊都听见，一个只说了句「有点闷」。
> 你是：**夜班护士** ｜ 地点：呼吸内科病房（夜班） ｜ 时间：凌晨 03:40
> 手边：监护仪、氧气装置、无创呼吸机、镇痛泵、呼叫铃

**在场者**
- `bed_a`（A 床患者（术后第 1 天））在场方式=on_site，索取注意力=loud
  - 风格：嗓门大、情绪外露，会反复按铃、在走廊里喊，但一被认真对待就明显缓和
  - 目的：被看见；把疼处理好
  - 他知道：{"主诉": "疼！疼得睡不着，你们是不是不管我了", "既往": "术后第 1 天，生命体征平稳", "自述": "我就想有人来看看我"}
- `bed_b`（B 床患者（慢阻肺））在场方式=on_site，索取注意力=quiet
  - 风格：忍耐、话少；越难受越不出声，血氧下降后开始答非所问
  - 目的：不麻烦别人
  - 他知道：{"主诉": "有点闷，喘不太上来", "既往": "慢阻肺，长期吸烟", "自述": "不麻烦你们，我缓缓就好"}
- `family_a`（A 床家属）在场方式=on_site，索取注意力=loud
  - 风格：语气冲、爱插话、会跟着质问
  - 目的：让病人舒服点
  - 他知道：{"立场": "看到病人喊，觉得护士不管"}
- `doctor`（值班医生）在场方式=callable，索取注意力=neutral
  - 风格：干脆，先问最要紧的那一床
  - 目的：先保住真正危重的那位
  - 他知道：{"现场": "需要护士给出两床的客观情况与处置先后"}

**状态键**（模型的唯一可写通道，越界即拒）
- `scene.bed_b_sat` = 88　边界 {"lo": 0, "hi": 100}
- `scene.bed_b_consciousness` = 3　边界 {"lo": 0, "hi": 5}
- `scene.a_pain` = 5　边界 {"lo": 0, "hi": 10}
- `scene.doctor_present` = False
- `bed_a.comfort` = 2　边界 {"lo": 0, "hi": 5}
- `bed_b.comfort` = 2　边界 {"lo": 0, "hi": 5}

**线索**（未被揭示前，学生看不到、模型也不许提前说）
- `c_a_ringing`　（开场即见）：A 床的呼叫铃一直在响，隔着走廊都能听见他在喊。
- `c_b_dark`　（开场即见）：B 床那侧只亮着床头监护仪的冷光，人没出声。
- `c_family_outside`　（开场即见）：A 床家属攥着水杯站在走廊里来回踱步。
- `c_a_stable`：A 床伤口敷料干燥，生命体征平稳——疼是真疼，但不像要出事。
- `c_b_barely_answers`：B 床老人应了一声，声音又轻又慢，像是费了很大力气。
- `c_b_low_sat`：B 床的血氧上不来，呼吸浅快、鼻翼翕动。
- `c_b_confused`：B 床答话开始不对劲：说自己在老家，还问什么时候能回去。

**动作**（学生的结构化入口；效果与揭示由平台确定性执行）
- `visit_a`（act）先去 A 床看看　目标 bed_a　耗时 +1
  - 效果：[{"target": "bed_a", "key": "comfort", "op": "incr", "value": 1}]
- `visit_b`（act）到 B 床看看　目标 bed_b　耗时 +1
  - 揭示：c_b_barely_answers、c_b_confused
  - 效果：[{"target": "bed_b", "key": "comfort", "op": "incr", "value": 1}]
- `measure_a`（measure）测 A 床生命体征　目标 bed_a
  - 揭示：c_a_stable
- `measure_b`（measure）测 B 床血氧与呼吸　目标 bed_b
  - 揭示：c_b_low_sat
  - 效果：[{"target": "scene", "key": "bed_b_sat", "op": "set", "value": 88}]
- `reassure_a`（act）向 A 床和家属解释、回应他　目标 bed_a/family_a　耗时 +1
  - 效果：[{"target": "bed_a", "key": "comfort", "op": "incr", "value": 2}]
- `analgesia_a`（act）按医嘱给 A 床镇痛　目标 bed_a　耗时 +2
  - 效果：[{"target": "scene", "key": "a_pain", "op": "decr", "value": 3}, {"target": "bed_a", "key": "comfort", "op": "incr", "value": 2}]
- `oxygen_b`（act）给 B 床吸氧 / 接无创通气　目标 bed_b　耗时 +2
  - 效果：[{"target": "scene", "key": "bed_b_sat", "op": "incr", "value": 5}]
- `call_doctor`（summon）呼叫值班医生　耗时 +2
  - 效果：[{"target": "scene", "key": "doctor_present", "op": "set", "value": true}]
  - 门控：{"all": [{"kind": "state_cmp", "key": "scene.doctor_present", "op": "==", "value": false}]}
- `document`（document）记录两床情况与处置顺序

**判读要观察的事实**
- `f_b_low_sat`，关键：B 床在吸氧下血氧仍低、呼吸浅快
- `f_b_mental_change`，关键：B 床出现意识改变（答非所问、定向力下降）
- `f_a_stable`：A 床生命体征平稳、疼痛可处理但可等待

**判据**（作者自写；权重合计 100）
- **两床同时按铃时，先处理谁**　`dp_priority`　权重 30　规则 `action_order`
  - strong：先快速确认 A 床能让得开，随即直奔 B 床（或直接先 B）
  - adequate：先应了 A 床，但在很短时间里转向 B 床
  - missed：在 A 床连续处理情绪/疼痛，把 B 床留在黑暗里
- **是否识别 B 床的静默危重（低氧 + 意识改变）**　`dp_recognize_b`　权重 25　规则 `action_set_covers`
  - strong：到床边看并测了血氧/呼吸，指出问题在安静的这床
  - adequate：做了其中之一，意识到 B 床不对劲
  - missed：完全按呼声音量分配注意力
- **是否及时对 B 床处置（吸氧/无创通气、呼叫医生）**　`dp_stabilize_b`　权重 25　规则 `require_within`
  - strong：四轮内既给了氧又喊了医生
  - adequate：四轮内做到其中之一
  - missed：始终没有对 B 床做处置升级
- **可等待的那一床是否也被正确管理（而不是被忽略或被过度占用）**　`dp_manage_a`　权重 10　规则 `action_set_covers`
  - strong：既回应了 A 床，也在其后处理了 B 床的危重
  - adequate：回应过 A 床
  - missed：完全没管 A 床的诉求
- **是否记录两床情况与处置先后**　`dp_document`　权重 10　规则 `action_set_covers`
  - strong：记录了两床观察、处置顺序与理由
  - adequate：有记录但缺顺序/理由
  - missed：未记录

**设备面**（读数只有被测过才有值；未测一律「未测量」）
- `monitor_b`（B 床监护仪）
  - `scene.bed_b_sat` 血氧 %　正常 [95, 100]　危急 [0, 90]

**学生看不到的真相**（只进模型的解析上下文，学生永远看不到；也是防泄漏词表）
- B 床正在静默低氧并出现意识改变，比 A 床危险得多
- A 床的疼是真的，但可以等待；他要的是被看见，不是优先抢救
- 呼声音量与危险程度无关

**结局**：irreversible
- 不可逆失败条件：{"all": [{"kind": "state_cmp", "key": "scene.bed_b_consciousness", "op": "<=", "value": 1}]}
