> 派生文件：由 `backend/scripts/render_cases.py` 从 `backend/modules/scenario_training/packs/*.json` 生成。
> `packs/*.json` 是唯一真源；改了病例请重新生成，不要手改这一份。

# 预检分诊：说「腰闪了」的那个人（`triage-hidden-bleed`）

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
- `c_vitals`：脉搏细速、血压偏低、四肢发凉。
- `c_shoulder`：追问搬箱子那一刻，他说「一下就疼起来了，左肩膀也酸」。
- `c_guarding`：他没有明显的腰部压痛点，反而左侧一碰就躲。
- `c_shock`：抢救区医生接手：「先按内出血走，床旁超声马上到。」

**动作**（学生的结构化入口；效果与揭示由平台确定性执行）
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

**判读要观察的事实**
- `f_shock_signs`，关键：脉搏细速与血压偏低提示循环不稳
- `f_shoulder_pain`，关键：突发腹侧疼痛伴肩部放射，提示腹内出血可能
- `f_abdomen_guarding`，关键：左侧回避触碰，与『闪腰』的解释不符
- `f_self_story`：患者自述只是搬东西闪了腰

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

**学生看不到的真相**（只进模型的解析上下文，学生永远看不到；也是防泄漏词表）
- 他极可能是腹内出血，主诉『闪了腰』是误归因
- 正确处置是立即送抢救区并呼叫医生，而不是骨科或开药回家

**结局**：irreversible
- 不可逆失败条件：{"all": [{"kind": "state_cmp", "key": "scene.consciousness", "op": "<=", "value": 1}]}
