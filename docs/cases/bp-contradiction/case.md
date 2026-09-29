> 派生文件：由 `backend/scripts/render_cases.py` 从 `backend/modules/scenario_training/packs/*.json` 生成。
> `packs/*.json` 是唯一真源；改了病例请重新生成，不要手改这一份。

# 入院检查：量出来像高血压，患者坚决否认（`bp-contradiction`）

> 一次入院检查：患者说他身体好得很，血压计不这么认为。
> 你是：**入院责任护士** ｜ 地点：内科病房 ｜ 时间：上午 09:20
> 手边：血压计、床头柜、既往就诊记录、入院评估单

**在场者**
- `patient`（患者）在场方式=on_site，索取注意力=neutral
  - 风格：不认为自己有病；被直接追问「有没有高血压」时回避、否认甚至不耐烦；被问到具体用药或旧记录时会含糊但会松口
  - 目的：证明自己身体没问题；尽快把检查做完
  - 他知道：{"主诉": "我没什么病，就是来做个检查", "自述": "我没有高血压，别给我记这个", "抽屉": "半板白色小药片（他自己也说不清是什么）"}

**状态键**（模型的唯一可写通道，越界即拒）
- `scene.bp_sys` = 168　边界 {"lo": 40, "hi": 300}
- `scene.bp_dia` = 98　边界 {"lo": 20, "hi": 200}
- `patient.trust` = 2　边界 {"lo": 0, "hi": 5}
- `patient.guarded` = 0　边界 {"lo": 0, "hi": 5}

**线索**（未被揭示前，学生看不到、模型也不许提前说）
- `c_denial`　（开场即见）：他反复说「我没有高血压，我身体好得很」，语气很坚决。
- `c_impatient`　（开场即见）：他答话时眼睛看着窗外，手指敲着床边。
- `c_bp_high`：袖带读数偏高，左右臂差别不大。
- `c_bp_retake`：换另一侧复测，结果和第一次一致。
- `c_bp_rest`：静息 5 分钟后再测，读数没下来——不是一时紧张。
- `c_pills`：床头抽屉里有半板白色小药片；他说「就那种小小白药片，降压的？我不清楚」。
- `c_record`：既往就诊记录里有一次 165/95 mmHg 的记载，但诊断一栏写着「待查」。

**动作**（学生的结构化入口；效果与揭示由平台确定性执行）
- `measure_bp`（measure）按规范测血压　目标 patient
  - 揭示：c_bp_high
  - 效果：[{"target": "scene", "key": "bp_sys", "op": "set", "value": 168}, {"target": "scene", "key": "bp_dia", "op": "set", "value": 98}]
- `measure_bp_again`（measure）换另一侧复测　目标 patient
  - 揭示：c_bp_retake
  - 效果：[{"target": "scene", "key": "bp_sys", "op": "set", "value": 166}, {"target": "scene", "key": "bp_dia", "op": "set", "value": 96}]
- `wait_rest_recheck`（measure）让他静息 5 分钟后再测　目标 patient　耗时 +5
  - 揭示：c_bp_rest
  - 效果：[{"target": "scene", "key": "bp_sys", "op": "set", "value": 164}, {"target": "scene", "key": "bp_dia", "op": "set", "value": 94}]
- `ask_history`（ask）问他有没有高血压、平时血压多少　目标 patient
  - 效果：[{"target": "patient", "key": "guarded", "op": "incr", "value": 1}]
- `ask_meds`（ask）问他平时吃什么药、谁来开药　目标 patient
  - 揭示：c_pills
  - 效果：[{"target": "patient", "key": "trust", "op": "incr", "value": 1}]
- `ask_record`（observe）查看既往就诊记录
  - 揭示：c_record
- `document`（document）把体征与陈述的不一致写入入院记录

**判读要观察的事实**
- `f_bp_high`，关键：测得血压明显高于正常范围
- `f_denial`，关键：患者本人坚决否认既往高血压
- `f_third_route`，关键：用不依赖患者承认的第三方证据核对

**判据**（作者自写；权重合计 100）
- **是否识别并处理「体征与陈述不一致」这个矛盾**　`dp_conflict`　权重 40　规则 `action_set_covers`
  - strong：量到了、也核对了第三方证据，明确指出两者不一致
  - adequate：量到了并问过，但把「他说没有」当成结论
  - missed：照清单记成「无高血压史」
- **是否用第三条路求证（用药 / 旧记录 / 复测）**　`dp_no_dismiss`　权重 30　规则 `action_set_covers`
  - strong：主动找了不依赖他承认的证据
  - adequate：复测了一次，但没有追证据
  - missed：只以他的口头陈述为准
- **追问是否合分寸（没有反复逼问同一件事）**　`dp_trust`　权重 15　规则 `avoid_repeat`
  - strong：问过一次就换路径求证
  - adequate：问了两次但随后调整了方式
  - missed：反复逼问，把他问得更设防
- **是否把不一致与下一步写进入院记录**　`dp_document`　权重 15　规则 `action_set_covers`
  - strong：记录了测量值、他的说法、核对到的证据与下一步
  - adequate：有记录但缺证据或下一步
  - missed：未记录

**设备面**（读数只有被测过才有值；未测一律「未测量」）
- `ward_monitor`（病房监护仪）
  - `scene.bp_sys` 血压（收缩压） mmHg　无区间
  - `scene.bp_dia` 血压（舒张压） mmHg　无区间

**学生看不到的真相**（只进模型的解析上下文，学生永远看不到；也是防泄漏词表）
- 他很可能是被漏诊、或者自行停了药的高血压
- 这一点只能靠第三方证据（用药、旧记录、复测）核实，不能靠他承认

**结局**：recoverable
