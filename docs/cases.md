# 情境病例（派生文件）

> 由 `backend/scripts/render_cases.py` 从 `backend/modules/scenario_training/packs/*.json` 生成。
> **`packs/*.json` 是唯一真源**；改了病例请重新生成这份，不要手改。

## 入院检查：量出来像高血压，患者坚决否认（`bp-contradiction`）

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
- `c_bp_high`：血压计读数 168/98 mmHg，左右臂差别不大。
- `c_bp_retake`：换另一侧复测 166/96 mmHg，仍然偏高。
- `c_bp_rest`：让他安静坐了 5 分钟再测：164/94 mmHg，仍然偏高——不是一时紧张。
- `c_pills`：床头抽屉里有半板白色小药片；他说「就那种小小白药片，降压的？我不清楚」。
- `c_record`：既往就诊记录里有一次 165/95 mmHg 的记载，但诊断一栏写着「待查」。

**动作**（学生的结构化入口；效果与揭示是平台确定性执行的部分）
- `measure_bp`（measure）按规范测血压　目标 patient
  - 揭示：c_bp_high
  - 效果：[{"target": "scene", "key": "bp_sys", "op": "set", "value": 168}, {"target": "scene", "key": "bp_dia", "op": "set", "value": 98}]
- `measure_bp_again`（measure）换另一侧/静息后复测　目标 patient
  - 揭示：c_bp_retake
  - 效果：[{"target": "scene", "key": "bp_sys", "op": "set", "value": 166}, {"target": "scene", "key": "bp_dia", "op": "set", "value": 96}]
- `wait_rest_recheck`（measure）让他安静休息 5 分钟后再测一次　目标 patient　耗时 +5
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

**判读要抽取的事实**
- `f_bp_high`（measured，关键）：测得血压明显高于正常范围
- `f_denial`（reported，关键）：患者本人坚决否认既往高血压
- `f_third_route`（measured，关键）：用不依赖患者承认的第三方证据核对

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
  - `scene.bp_sys` 血压（收缩压） mmHg　正常 [90, 140]

**真相**（只进模型的解析上下文，学生永远看不到）
- 他很可能在被漏诊或已自行停药的高血压，需要靠第三方证据（用药、旧记录、复测）确认，而不是靠他承认

**结局**：recoverable

---

## 夜班电话：用几项数据决定下一步（`night-call-decision`）

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
- `c_results`：回报：乳酸 4.2 mmol/L、白细胞 16.8；床旁超声见右下腹游离液体。

**动作**（学生的结构化入口；效果与揭示是平台确定性执行的部分）
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

**判读要抽取的事实**
- `f_vitals`（measured，关键）：心率快、血压偏低、尿少——已经有循环不稳的迹象
- `f_peritonitis`（measured，关键）：右下腹压痛伴反跳痛，提示腹膜炎
- `f_lactate`（measured，关键）：乳酸升高与影像见游离液体，提示需要外科介入
- `f_urine`（measured）：尿量显著减少

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

**真相**（只进模型的解析上下文，学生永远看不到）
- 这是外科急腹症合并早期循环不稳，需要尽快确诊并升级到外科
- 关键下一步是化验（乳酸/血常规）与床旁超声，并把二线叫起来

**结局**：recoverable

---

## 吸痰无效：血氧上不来（`sputum-ineffective`）

> 夜班，患者痰多却吸不出来，血氧一路往下掉。
> 你是：**夜班护士** ｜ 地点：呼吸内科病房 ｜ 时间：凌晨 02:10
> 手边：床旁吸引器、氧气装置、简易呼吸器、呼叫铃

**在场者**
- `patient`（患者）在场方式=on_site，索取注意力=quiet
  - 风格：说话断续费力，越急越说不清；情绪一激动就更喘
  - 目的：想喘上气
  - 他知道：{"主诉": "……喘不上来……", "既往": "慢阻肺、长期吸烟", "自述": "痰很多，可就是咳不出来"}
- `doctor`（值班医生）在场方式=callable，索取注意力=neutral
  - 风格：干脆，要求具体数据与已采取措施
  - 目的：稳定气道
  - 他知道：{"现场": "需要护士先给出可复述的观察与已做处置"}

**状态键**（模型的唯一可写通道，越界即拒）
- `scene.spo2` = 88　边界 {"lo": 0, "hi": 100}
- `scene.o2_flow` = 3　边界 {"lo": 0, "hi": 15}
- `scene.doctor_present` = False
- `patient.comfort` = 2　边界 {"lo": 0, "hi": 5}
- `patient.consciousness` = 3　边界 {"lo": 0, "hi": 5}
- `patient.airway_patent` = False

**线索**（未被揭示前，学生看不到、模型也不许提前说）
- `c_restless`　（开场即见）：患者坐起前倾，说话断续，额头发汗。
- `c_secretions`　（开场即见）：床旁吸引器就位，痰液黏稠、量多。
- `c_low_spo2`：指夹血氧 88%（吸氧 3 L/min 下）。
- `c_left_absent`：左侧呼吸音几乎听不到，右侧痰鸣明显。
- `c_tube_blood`：吸痰管回抽只有少量血性黏痰，越吸患者越躁。
- `c_plan`：医生指示：球囊面罩加压给氧，准备插管。

**动作**（学生的结构化入口；效果与揭示是平台确定性执行的部分）
- `suction`（act）吸痰　目标 patient　耗时 +2
  - 揭示：c_tube_blood
- `increase_o2`（act）调高氧流量　目标 patient　耗时 +1
- `auscultate`（observe）听诊双肺　目标 patient
  - 揭示：c_left_absent
- `measure_spo2`（measure）测血氧　目标 patient
  - 揭示：c_low_spo2
  - 效果：[{"target": "scene", "key": "spo2", "op": "set", "value": 88}]
- `bag_valve`（act）球囊面罩加压给氧　目标 patient　耗时 +2
  - 效果：[{"target": "scene", "key": "spo2", "op": "incr", "value": 6}, {"target": "patient", "key": "airway_patent", "op": "set", "value": true}]
  - 门控：{"all": [{"kind": "action_used", "affordance_id": "measure_spo2"}, {"kind": "action_used", "affordance_id": "auscultate"}]}
- `reposition`（act）侧卧拍背 / 体位引流　目标 patient　耗时 +2
  - 效果：[{"target": "scene", "key": "spo2", "op": "incr", "value": 2}]
  - 门控：{"all": [{"kind": "action_used", "affordance_id": "measure_spo2"}, {"kind": "action_used", "affordance_id": "auscultate"}]}
- `call_doctor`（summon）呼叫值班医生　耗时 +2
  - 揭示：c_plan
  - 效果：[{"target": "scene", "key": "doctor_present", "op": "set", "value": true}]
  - 门控：{"all": [{"kind": "state_cmp", "key": "scene.doctor_present", "op": "==", "value": false}]}
- `document`（document）记录处置与病情变化
  - 门控：{"all": [{"kind": "action_used", "affordance_id": "bag_valve"}, {"kind": "action_used", "affordance_id": "call_doctor"}]}

**判读要抽取的事实**
- `f_low_spo2`（measured，关键）：吸氧条件下血氧仍低于正常
- `f_left_absent`（measured，关键）：单侧呼吸音消失，提示深部痰栓或单侧堵塞
- `f_bloody_sputum`（measured）：吸出物为少量血性黏痰

**判据**（作者自写；权重合计 100）
- **是否识别「吸痰无效 + 单侧呼吸音消失」提示深部痰栓 / 单侧堵塞**　`dp_recognize`　权重 25　规则 `action_set_covers`
  - strong：测了血氧并听诊，明确指出吸痰取不出深部痰、单侧通气受损
  - adequate：测了血氧或听诊之一，意识到吸痰无效
  - missed：只看血氧数字，或完全依赖吸痰
- **是否停止重复无效的吸痰**　`dp_no_repeat`　权重 30　规则 `avoid_repeat`
  - strong：吸痰一次后即停止，转而重新评估
  - adequate：吸痰两次但随后改变思路
  - missed：反复吸痰三次以上
- **是否及时升级（加压给氧 / 呼叫医生）**　`dp_escalate`　权重 30　规则 `require_within`
  - strong：三轮内上手加压给氧并呼叫医生
  - adequate：三轮内做到其中之一
  - missed：始终没有升级
- **是否先重新评估再升级处置**　`dp_sequence`　权重 10　规则 `action_order`
  - strong：先看清体征（听诊 / 血氧）再加压给氧或呼叫医生
  - adequate：评估与升级交错，但顺序合理
  - missed：没有任何评估就盲目处置
- **是否记录处置与病情变化**　`dp_document`　权重 5　规则 `action_set_covers`
  - strong：记录了观察、处置与患者反应
  - adequate：有记录但缺患者反应
  - missed：未记录

**设备面**（读数只有被测过才有值；未测一律「未测量」）
- `bedside_monitor`（床旁监护仪）
  - `scene.spo2` 血氧 %　正常 [95, 100]　危急 [0, 90]

**图片**（模型自行决定何时发；声明了闸门的必须等对应线索）
- `a_room` 夜班病房　闸门 ['c_secretions']

**真相**（只进模型的解析上下文，学生永远看不到）
- 深部痰栓导致左侧气道堵塞，单纯经口吸痰取不出
- 正确处置是加压给氧＋体位引流＋呼叫医生准备插管，而不是继续吸痰

**结局**：irreversible
- 不可逆失败条件：{"all": [{"kind": "state_cmp", "key": "patient.consciousness", "op": "<=", "value": 1}]}

---

## 预检分诊：说「腰闪了」的那个人（`triage-hidden-bleed`）

> 他扶着墙走进预检台，说自己只是搬东西闪了腰，想开点膏药就回家。
> 你是：**预检分诊护士** ｜ 地点：急诊预检台 ｜ 时间：傍晚 18:40
> 手边：分诊系统、血压计与监护、平车、抢救区呼叫铃

**在场者**
- `patient`（患者）在场方式=on_site，索取注意力=quiet
  - 风格：忍着、不爱麻烦人，倾向把话说小；被问到具体经过时才会补出关键信息
  - 目的：快点回家
  - 他知道：{"主诉": "搬箱子闪了腰", "需求": "开点膏药回家接孩子", "实情": "突发左上腹疼伴左肩酸，现在有点头晕"}
- `colleague`（分诊台同事）在场方式=on_site，索取注意力=neutral
  - 风格：务实；你给出理由她就会配合
  - 目的：别堵住通道
  - 他知道：{"立场": "通道不能堵，倾向按病人自述分流"}
- `doctor`（抢救区医生）在场方式=callable，索取注意力=neutral
  - 风格：干脆
  - 目的：抢时间
  - 他知道：{"现场": "要你给出主诉、生命体征、以及为什么送红区"}

**状态键**（模型的唯一可写通道，越界即拒）
- `scene.pulse` = 118　边界 {"lo": 0, "hi": 250}
- `scene.bp_sys` = 92　边界 {"lo": 40, "hi": 300}
- `scene.consciousness` = 3　边界 {"lo": 0, "hi": 5}
- `scene.triage_zone` = none
- `scene.doctor_present` = False
- `patient.comfort` = 2　边界 {"lo": 0, "hi": 5}

**线索**（未被揭示前，学生看不到、模型也不许提前说）
- `c_grip`　（开场即见）：他扶着分诊台边缘站着，不太敢直起腰。
- `c_pale`　（开场即见）：脸色发白、额角出汗，说话比刚进门时慢了半拍。
- `c_story`　（开场即见）：他说：「搬箱子闪了一下腰，给我开点膏药，我得回去接孩子。」
- `c_vitals`：脉搏 118、血压 92/58、四肢发凉。
- `c_shoulder`：追问搬箱子那一刻，他说「一下就疼起来了，左肩膀也酸」。
- `c_guarding`：他没有明显的腰部压痛点，反而左侧一碰就躲。
- `c_shock`：抢救区医生接手：「先按内出血走，床旁超声马上到。」

**动作**（学生的结构化入口；效果与揭示是平台确定性执行的部分）
- `measure_vitals`（measure）测生命体征　目标 patient
  - 揭示：c_vitals
  - 效果：[{"target": "scene", "key": "pulse", "op": "set", "value": 118}, {"target": "scene", "key": "bp_sys", "op": "set", "value": 92}]
- `ask_trauma`（ask）追问受伤那一刻的经过　目标 patient
  - 揭示：c_shoulder
- `observe_abdomen`（observe）看他捂的位置、轻轻触一下左侧　目标 patient
  - 揭示：c_guarding
- `triage_red`（act）立即送抢救区（红区）并呼叫医生　耗时 +1
  - 揭示：c_shock
  - 效果：[{"target": "scene", "key": "triage_zone", "op": "set", "value": "red"}, {"target": "scene", "key": "doctor_present", "op": "set", "value": true}]
- `triage_yellow`（act）分诊到急诊黄区留观　耗时 +1
  - 效果：[{"target": "scene", "key": "triage_zone", "op": "set", "value": "yellow"}]
- `triage_ortho`（act）分诊到骨科门诊　耗时 +1
  - 效果：[{"target": "scene", "key": "triage_zone", "op": "set", "value": "ortho"}]
- `triage_home`（act）开膏药回家观察　耗时 +1
  - 效果：[{"target": "scene", "key": "triage_zone", "op": "set", "value": "home"}]
- `document`（document）记录分诊判断与依据

**判读要抽取的事实**
- `f_shock_signs`（measured，关键）：脉搏细速与血压偏低提示循环不稳
- `f_shoulder_pain`（measured，关键）：突发腹侧疼痛伴肩部放射，提示腹内出血可能
- `f_abdomen_guarding`（measured，关键）：左侧回避触碰，与『闪腰』的解释不符
- `f_self_story`（reported）：患者自述只是搬东西闪了腰

**判据**（作者自写；权重合计 100）
- **把他分到哪儿**　`dp_zone`　权重 50　规则 `option_choice`
  - strong：直接送红区；或自输入写明疑似腹内出血/循环不稳
  - adequate：先留观黄区，但仍留在急诊视线内
  - missed：按骨科/开药回家处理
- **是否在分区前先核实体征（而不是照主诉分流）**　`dp_see_hidden`　权重 30　规则 `action_set_covers`
  - strong：量了生命体征并追问/查看，「闪腰」这个解释被推翻
  - adequate：做了其中一项，开始起疑
  - missed：完全按他自己的说法分流
- **是否记录分诊等级与依据**　`dp_document`　权重 20　规则 `action_set_covers`
  - strong：记录了主诉、我核到的体征、等级与依据
  - adequate：有记录但缺依据
  - missed：未记录

**设备面**（读数只有被测过才有值；未测一律「未测量」）
- `triage_monitor`（分诊台监护仪）
  - `scene.pulse` 脉搏 次/分　正常 [60, 100]
  - `scene.bp_sys` 收缩压 mmHg　正常 [90, 140]

**真相**（只进模型的解析上下文，学生永远看不到）
- 他极可能是腹腔内出血，主诉『闪了腰』是误归因
- 正确处置是立即送抢救区并呼叫医生，而不是骨科或开药回家

**结局**：irreversible
- 不可逆失败条件：{"all": [{"kind": "state_cmp", "key": "scene.consciousness", "op": "<=", "value": 1}]}

---

## 两床同铃：会叫的能等，不叫的危重（`two-beds-priority`）

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
- `c_b_low_sat`：B 床指夹血氧 88%，呼吸浅快、鼻翼翕动。
- `c_b_confused`：B 床答话开始不对劲：说自己在老家，还问什么时候能回去。

**动作**（学生的结构化入口；效果与揭示是平台确定性执行的部分）
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

**判读要抽取的事实**
- `f_b_low_sat`（measured，关键）：B 床在吸氧下血氧仍低、呼吸浅快
- `f_b_mental_change`（measured，关键）：B 床出现意识改变（答非所问、定向力下降）
- `f_a_stable`（measured）：A 床生命体征平稳、疼痛可处理但可等待

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

**真相**（只进模型的解析上下文，学生永远看不到）
- B 床正在静默低氧并出现意识改变，比 A 床危险得多
- A 床的疼是真的，但可以等待；他要的是被看见，而不是优先抢救

**结局**：irreversible
- 不可逆失败条件：{"all": [{"kind": "state_cmp", "key": "scene.bed_b_consciousness", "op": "<=", "value": 1}]}

---
