> 派生文件：由 `backend/scripts/render_cases.py` 从 `backend/modules/scenario_training/packs/*.json` 生成。
> `packs/*.json` 是唯一真源；改了病例请重新生成，不要手改这一份。

# 夜班电话：用几项数据决定下一步（`night-call-decision`）

> 凌晨 02:10，值班室电话把你叫醒——病区护士在电话那头等你下决定。
> 你是：**值班医生** ｜ 地点：值班室 ｜ 时间：凌晨 02:10
> 手边：值班手机、院内系统、床旁超声（需呼叫）

**在场者**
- `nurse`（病区护士）在场方式=remote，索取注意力=neutral
  - 风格：报数干脆、随时准备执行；你反复问同一件事她会直接说「我刚报过了」
  - 目的：尽快拿到明确医嘱
  - 他知道：{"已测": "体温 37.8、脉搏 118、血压 92/58、尿量少", "主诉": "右下腹痛、腹胀", "观察": "神志清、皮肤湿冷"}
- `patient`（患者）在场方式=inaccessible，索取注意力=quiet
  - 风格：在病床上；他的声音只能从听筒背景里偶尔传来
  - 他知道：{"自述": "肚子疼，怕是要紧"}
- `consultant`（二线/外科医生）在场方式=callable，索取注意力=neutral
  - 风格：要求结论明确
  - 目的：接住这个病人
  - 他知道：{"现场": "要你把数据和判断讲清楚、给出明确请求"}

**状态键**（模型的唯一可写通道，越界即拒）
- `scene.bp_sys` = 92　边界 {"lo": 40, "hi": 300}
- `scene.lactate` = 0　边界 {"lo": 0, "hi": 30}
- `scene.plan_set` = False
- `scene.consultant_in` = False
- `nurse.patience` = 3　边界 {"lo": 0, "hi": 5}

**线索**（未被揭示前，学生看不到、模型也不许提前说）
- `c_phone`　（开场即见）：护士语速很快：「体温 37.8，心率 118，血压 92/58，一晚上尿很少。」
- `c_waiting`　（开场即见）：她等着你下决定；电话那头有监护仪的报警声。
- `c_history`：追问既往：糖尿病、高血压；最近一周没怎么吃东西。
- `c_abdomen`：护士说：「肚子胀，右下腹按下去更疼，松手也疼。」
- `c_urine`：尿量：一整夜 100 ml，颜色很深。
- `c_results`：化验和床旁超声都回来了：白细胞 16.8，超声见右下腹游离液体。

**动作**（学生的结构化入口；效果与揭示由平台确定性执行）
- `ask_vitals`（ask）让护士复述并补测生命体征　目标 nurse
  - 效果：[{"target": "nurse", "key": "patience", "op": "decr", "value": 1}]
- `ask_abdomen`（ask）问腹部体征与疼痛部位　目标 nurse
  - 揭示：c_abdomen
- `ask_urine`（ask）问尿量与出入量　目标 nurse
  - 揭示：c_urine
- `ask_history`（ask）问既往史与近期进食　目标 nurse
  - 揭示：c_history
- `order_tests`（act）下医嘱：查什么　目标 nurse　耗时 +3　multi lactate|ultrasound|ecg|catheter
  - 揭示：c_results
  - 效果：[{"target": "scene", "key": "plan_set", "op": "set", "value": true}, {"target": "scene", "key": "lactate", "op": "set", "value": 4.2}]
- `hold_observation`（act）先留观复测，明早交班再说　目标 nurse　耗时 +3
  - 效果：[{"target": "nurse", "key": "patience", "op": "decr", "value": 1}]
- `order_support`（act）先补液并交代观察要点（血压/尿量/意识）　目标 nurse　耗时 +2
  - 效果：[{"target": "scene", "key": "bp_sys", "op": "incr", "value": 2}]
- `order_escalate`（summon）叫二线/外科起床接手　目标 nurse　耗时 +2
  - 效果：[{"target": "scene", "key": "consultant_in", "op": "set", "value": true}]
  - 门控：{"all": [{"kind": "state_cmp", "key": "scene.consultant_in", "op": "==", "value": false}]}
- `document`（document）记病程：数据、判断、已下医嘱

**判读要观察的事实**
- `f_vitals`，关键：心率快、血压偏低、尿少——已经有循环不稳的迹象
- `f_peritonitis`，关键：右下腹压痛伴反跳痛，提示腹膜炎
- `f_lactate`，关键：乳酸升高与影像见游离液体，提示需要外科介入
- `f_urine`：尿量显著减少

**判据**（作者自写；权重合计 100）
- **在电话里问到了哪些关键信息（而不是只重复已有数据）**　`dp_gather`　权重 25　规则 `action_set_covers`
  - strong：问了腹部体征并至少核到另一项
  - adequate：问到了其中一项
  - missed：只复述护士已经报过的数字
- **下一步检查与处置选了什么**　`dp_next_test`　权重 30　规则 `option_choice`
  - strong：要了乳酸/血常规或床旁超声；或自输入点出需要外科介入
  - adequate：要了心电图或尿量等次要项，但没抓关键
  - missed：选择先留观复测、明早再说
- **是否把二线/外科叫起来**　`dp_escalate`　权重 30　规则 `require_within`
  - strong：四轮内叫了二线/外科
  - adequate：更晚才叫
  - missed：始终没有升级
- **是否同时给出支持性处置与观察要点**　`dp_plan`　权重 15　规则 `action_set_covers`
  - strong：交代了补液/观察要点或写入病程
  - adequate：只做了其中一件
  - missed：只下检查、没有后续交代

**设备面**（读数只有被测过才有值；未测一律「未测量」）
- `duty_phone`（值班手机）
  - `scene.lactate` 乳酸 mmol/L　无区间

**学生看不到的真相**（只进模型的解析上下文，学生永远看不到；也是防泄漏词表）
- 这是外科急腹症合并早期循环不稳，需要尽快确诊并升级到外科
- 关键下一步是乳酸/血常规与床旁超声，并把二线叫起来
- 患者不在你的视野里：你只能通过电话决策，到不了他床边

**结局**：recoverable
