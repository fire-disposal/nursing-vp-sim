> 派生文件：由 `backend/scripts/render_cases.py` 从 `backend/modules/scenario_training/packs/*.json` 生成。
> `packs/*.json` 是唯一真源；改了病例请重新生成，不要手改这一份。

# 吸痰无效：血氧上不来（`sputum-ineffective`）

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
- `c_low_spo2`：吸着 3 L/min 的氧，指夹血氧还是上不来。
- `c_left_absent`：左侧呼吸音几乎听不到，右侧痰鸣明显。
- `c_tube_blood`：吸痰管回抽只有少量血性黏痰，越吸患者越躁。
- `c_plan`：医生指示：球囊面罩加压给氧，准备插管。

**动作**（学生的结构化入口；效果与揭示由平台确定性执行）
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

**判读要观察的事实**
- `f_low_spo2`，关键：吸氧条件下血氧仍低于正常
- `f_left_absent`，关键：单侧呼吸音消失，提示深部痰栓或单侧堵塞
- `f_bloody_sputum`：吸出物为少量血性黏痰

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

**学生看不到的真相**（只进模型的解析上下文，学生永远看不到；也是防泄漏词表）
- 深部痰栓把左侧气道堵住了，经口吸痰取不出来
- 正确处置是加压给氧＋体位引流＋呼叫医生准备插管，而不是继续吸痰

**结局**：irreversible
- 不可逆失败条件：{"all": [{"kind": "state_cmp", "key": "patient.consciousness", "op": "<=", "value": 1}]}
