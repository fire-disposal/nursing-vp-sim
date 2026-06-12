import type { RecordSheetConfig } from "./types";

const smokingBranches = [
	{ key: "per_day", type: "input" as const, label: "平均", unit: "支/日" },
	{ key: "years", type: "input" as const, label: "已抽", unit: "年" },
	{ key: "quit_years", type: "input" as const, label: "已戒", unit: "年" },
];

const alcoholBranches = [
	{ key: "per_month", type: "input" as const, label: "平均", unit: "两/月" },
	{ key: "years", type: "input" as const, label: "已饮", unit: "年" },
	{ key: "quit_years", type: "input" as const, label: "已戒", unit: "年" },
];

export const NURSING_RECORD_SHEET_CONFIG: RecordSheetConfig = {
	title: "入院患者评估表",
	sections: [
		// ========== 1. 病史 ==========
		{
			key: "medical_history",
			label: "病史",
			icon: "FileText",
			collapsible: true,
			items: [
				{
					key: "chief_complaint",
					type: "textarea",
					label: "主诉",
					placeholder: "患者主要不适及持续时间",
				},
				{
					key: "present_illness",
					type: "textarea",
					label: "现病史",
					placeholder: "本次发病情况、诊治经过等",
				},
			],
		},

		// ========== 2. 日常生活状况 ==========
		{
			key: "daily_living",
			label: "日常生活状况",
			icon: "UtensilsCrossed",
			collapsible: true,
			items: [
				{
					key: "diet_types",
					type: "checkbox_group",
					label: "膳食种类",
					columns: 2,
					options: [
						{
							key: "regular",
							label: "普食",
							detail: { type: "input", placeholder: "餐/日" },
						},
						{
							key: "soft",
							label: "软食",
							detail: { type: "input", placeholder: "餐/日" },
						},
						{
							key: "liquid",
							label: "流质",
							detail: { type: "input", placeholder: "餐/日" },
						},
						{
							key: "semi_liquid",
							label: "半流",
							detail: { type: "input", placeholder: "餐/日" },
						},
						{
							key: "nasogastric",
							label: "鼻饲",
							detail: { type: "input", placeholder: "餐/日" },
						},
						{
							key: "therapeutic",
							label: "治疗膳食",
							detail: { type: "input", placeholder: "描述" },
						},
						{
							key: "fasting",
							label: "禁食",
							detail: { type: "input", placeholder: "餐/日" },
						},
						{
							key: "avoid",
							label: "忌食",
							detail: { type: "input", placeholder: "忌食内容" },
						},
					],
				},
				{
					key: "eating_method",
					type: "checkbox_group",
					label: "进食方式",
					columns: 2,
					options: [
						{ key: "normal", label: "正常" },
						{ key: "nasogastric", label: "鼻饲" },
						{ key: "enterostomy", label: "全肠造瘘" },
						{ key: "tpn", label: "全静脉营养" },
						{
							key: "other",
							label: "其他",
							detail: { type: "input", placeholder: "描述" },
						},
					],
				},
				{
					key: "appetite",
					type: "radio",
					label: "食欲",
					options: ["正常", "增加", "亢进", "减退", "厌食"],
				},
				{
					key: "defecation",
					type: "compound",
					label: "排便",
					trigger: {
						key: "status",
						type: "radio",
						label: "排便",
						options: ["正常", "便秘", "腹泻", "失禁", "造瘘", "其他"],
					},
					branches: {
						便秘: [
							{
								key: "days",
								type: "input",
								label: "频率",
								unit: "日/次",
								placeholder: "如：3",
							},
							{
								key: "assist",
								type: "radio",
								label: "辅助排便",
								options: ["无", "有"],
							},
						],
						腹泻: [
							{
								key: "times",
								type: "input",
								label: "频率",
								unit: "次/日",
								placeholder: "如：5",
							},
						],
						造瘘: [
							{
								key: "self_care",
								type: "radio",
								label: "能否自理",
								options: ["能", "否"],
							},
						],
						其他: [
							{
								key: "detail",
								type: "input",
								label: "描述",
								placeholder: "其他排便异常",
							},
						],
					},
				},
				{
					key: "urination",
					type: "compound",
					label: "排尿",
					trigger: {
						key: "status",
						type: "radio",
						label: "排尿",
						options: ["正常", "增多", "减少"],
					},
					branches: {
						增多: [
							{ key: "times", type: "input", label: "频率", unit: "次/日" },
							{ key: "color", type: "input", label: "颜色" },
						],
						减少: [
							{ key: "times", type: "input", label: "频率", unit: "次/日" },
							{ key: "color", type: "input", label: "颜色" },
						],
					},
				},
				{
					key: "activity_ability",
					type: "radio",
					label: "活动能力",
					options: ["无限制", "坐椅子", "床旁活动", "卧床"],
				},
				{
					key: "self_care",
					type: "radio",
					label: "自理能力",
					options: ["完全自理", "部分自理", "完全依靠"],
				},
				{
					key: "sleep",
					type: "compound",
					label: "睡眠",
					trigger: {
						key: "status",
						type: "radio",
						label: "睡眠",
						options: ["正常", "失眠"],
					},
					branches: {
						失眠: [
							{
								key: "description",
								type: "textarea",
								label: "描述",
								placeholder: "失眠情况描述",
							},
						],
					},
				},
				{
					key: "smoking",
					type: "compound",
					label: "吸烟",
					trigger: {
						key: "status",
						type: "radio",
						label: "吸烟",
						options: ["无", "偶吸", "大量"],
					},
					branches: {
						偶吸: smokingBranches,
						大量: smokingBranches,
					},
				},
				{
					key: "alcohol",
					type: "compound",
					label: "饮酒",
					trigger: {
						key: "status",
						type: "radio",
						label: "饮酒",
						options: ["无", "偶饮", "大量"],
					},
					branches: {
						偶饮: alcoholBranches,
						大量: alcoholBranches,
					},
				},
				{
					key: "drug_dependence",
					type: "compound",
					label: "药物依赖",
					trigger: {
						key: "status",
						type: "radio",
						label: "药物依赖",
						options: ["无", "有"],
					},
					branches: {
						有: [
							{
								key: "detail",
								type: "input",
								label: "药名/剂量",
								placeholder: "药物名称及剂量",
							},
						],
					},
				},
			],
		},

		// ========== 3. 既往史 ==========
		{
			key: "past_history",
			label: "既往史",
			icon: "Clock",
			collapsible: true,
			items: [
				{
					key: "health_status",
					type: "radio",
					label: "既往健康状况",
					options: ["良好", "一般", "差"],
				},
				{
					key: "illness_history",
					type: "compound",
					label: "既往患病/住院史",
					trigger: {
						key: "status",
						type: "radio",
						label: "既往患病/住院史",
						options: ["无", "有"],
					},
					branches: {
						有: [
							{
								key: "description",
								type: "textarea",
								label: "描述",
								placeholder: "患病/住院情况描述",
							},
						],
					},
				},
				{
					key: "infectious_history",
					type: "compound",
					label: "传染病史",
					trigger: {
						key: "status",
						type: "radio",
						label: "传染病史",
						options: ["无", "有"],
					},
					branches: {
						有: [
							{
								key: "description",
								type: "textarea",
								label: "描述",
								placeholder: "传染病情况描述",
							},
						],
					},
				},
				{
					key: "vaccination_history",
					type: "compound",
					label: "预防接种史",
					trigger: {
						key: "status",
						type: "radio",
						label: "预防接种史",
						options: ["无", "有"],
					},
					branches: {
						有: [
							{
								key: "description",
								type: "input",
								label: "描述",
								placeholder: "接种情况描述",
							},
						],
					},
				},
				{
					key: "surgery_history",
					type: "compound",
					label: "手术/外伤史",
					trigger: {
						key: "status",
						type: "radio",
						label: "手术/外伤史",
						options: ["无", "有"],
					},
					branches: {
						有: [
							{
								key: "description",
								type: "textarea",
								label: "描述",
								placeholder: "手术/外伤情况描述",
							},
						],
					},
				},
				{
					key: "allergy",
					type: "checkbox_group",
					label: "过敏史",
					columns: 2,
					options: [
						{ key: "none", label: "无" },
						{
							key: "food",
							label: "食物",
							detail: { type: "input", placeholder: "描述" },
						},
						{
							key: "drug",
							label: "药物",
							detail: { type: "input", placeholder: "描述" },
						},
						{ key: "unknown", label: "不详" },
						{
							key: "other",
							label: "其他",
							detail: { type: "input", placeholder: "描述" },
						},
					],
				},
				{ key: "marriage_age", type: "input", label: "结婚年龄", unit: "岁" },
				{
					key: "spouse_health",
					type: "compound",
					label: "配偶健康状况",
					trigger: {
						key: "status",
						type: "radio",
						label: "配偶健康状况",
						options: ["健在", "患病", "已故"],
					},
					branches: {
						已故: [{ key: "cause", type: "input", label: "死因" }],
						患病: [{ key: "detail", type: "input", label: "疾病" }],
					},
				},
				{
					key: "reproduction",
					type: "repeater",
					label: "生育史",
					rows: [{ key: "reproduction", label: "生育" }],
					fields: [
						{ key: "pregnancy", type: "input", label: "妊娠", unit: "次" },
						{ key: "full_term", type: "input", label: "顺产", unit: "胎" },
						{ key: "abortion", type: "input", label: "流产", unit: "胎" },
						{ key: "premature", type: "input", label: "早产", unit: "胎" },
						{ key: "stillbirth", type: "input", label: "死产", unit: "胎" },
					],
				},
				{
					key: "menstruation",
					type: "repeater",
					label: "月经史",
					rows: [{ key: "menstruation", label: "月经" }],
					fields: [
						{ key: "menarche", type: "input", label: "初潮", unit: "岁" },
						{ key: "period_days", type: "input", label: "行经期", unit: "天" },
						{ key: "cycle_days", type: "input", label: "月经周期", unit: "天" },
						{
							key: "menopause_age",
							type: "input",
							label: "绝经年龄",
							unit: "岁",
						},
						{ key: "last_period", type: "input", label: "末次月经时间" },
					],
				},
				{
					key: "family_history",
					type: "repeater",
					label: "家族史",
					rows: [
						{ key: "father", label: "父" },
						{ key: "mother", label: "母" },
						{ key: "children", label: "子女" },
						{ key: "siblings", label: "兄弟姐妹" },
					],
					fields: [
						{
							key: "status",
							type: "radio",
							label: "健康状况",
							options: ["健在", "患病", "已故"],
						},
						{
							key: "cause",
							type: "input",
							label: "死因/疾病",
							showWhen: { status: "已故" },
						},
						{
							key: "detail",
							type: "input",
							label: "疾病",
							showWhen: { status: "患病" },
						},
					],
				},
			],
		},

		// ========== 4. 系统回顾 ==========
		{
			key: "system_review",
			label: "系统回顾",
			icon: "Stethoscope",
			collapsible: true,
			items: [
				{
					key: "head_neck",
					type: "checkbox_group",
					label: "头颅五官",
					columns: 2,
					options: [
						{ key: "normal", label: "正常/无异" },
						{ key: "vision", label: "视力障碍" },
						{ key: "deafness", label: "耳聋" },
						{ key: "tinnitus", label: "耳鸣" },
						{ key: "vertigo", label: "眩晕" },
						{ key: "nosebleed", label: "鼻血" },
						{ key: "toothache", label: "牙痛" },
						{ key: "gum_bleeding", label: "牙龈出血" },
						{ key: "hoarseness", label: "声音嘶哑" },
						{
							key: "other",
							label: "其它",
							detail: { type: "input", placeholder: "描述" },
						},
					],
				},
				{
					key: "respiratory",
					type: "checkbox_group",
					label: "呼吸系统",
					columns: 2,
					options: [
						{ key: "normal", label: "正常/无异" },
						{ key: "cough", label: "咳嗽" },
						{ key: "sputum", label: "咳痰" },
						{ key: "hemoptysis", label: "咯血" },
						{ key: "dyspnea", label: "呼吸困难" },
						{ key: "wheezing", label: "喘息" },
						{ key: "low_fever", label: "长期低热" },
						{ key: "night_sweat", label: "盗汗" },
						{ key: "weight_loss", label: "消瘦" },
						{ key: "chest_pain", label: "胸痛" },
						{
							key: "other",
							label: "其它",
							detail: { type: "input", placeholder: "描述" },
						},
					],
				},
				{
					key: "circulatory",
					type: "checkbox_group",
					label: "循环系统",
					columns: 2,
					options: [
						{ key: "normal", label: "正常/无异" },
						{ key: "palpitation", label: "心悸" },
						{ key: "exertion_dyspnea", label: "活动后气促" },
						{ key: "precordial_pain", label: "心前区疼痛" },
						{ key: "edema", label: "下肢水肿" },
						{ key: "syncope", label: "晕厥" },
						{ key: "hypertension", label: "血压升高" },
						{
							key: "other",
							label: "其它",
							detail: { type: "input", placeholder: "描述" },
						},
					],
				},
				{
					key: "digestive",
					type: "checkbox_group",
					label: "消化系统",
					columns: 2,
					options: [
						{ key: "normal", label: "正常/无异" },
						{ key: "appetite_loss", label: "食欲减退" },
						{ key: "acid_reflux", label: "反酸" },
						{ key: "belching", label: "嗳气" },
						{ key: "nausea", label: "恶心" },
						{ key: "vomiting", label: "呕吐" },
						{ key: "dysphagia", label: "吞咽困难" },
						{ key: "abdominal_distension", label: "腹胀" },
						{ key: "abdominal_pain", label: "腹痛" },
						{ key: "diarrhea", label: "腹泻" },
						{ key: "constipation", label: "便秘" },
						{ key: "hematemesis", label: "呕血" },
						{ key: "melena", label: "黑便" },
						{ key: "jaundice", label: "黄疸" },
						{
							key: "other",
							label: "其它",
							detail: { type: "input", placeholder: "描述" },
						},
					],
				},
				{
					key: "urinary",
					type: "checkbox_group",
					label: "泌尿系统",
					columns: 2,
					options: [
						{ key: "normal", label: "正常/无异" },
						{ key: "frequency", label: "尿频" },
						{ key: "urgency", label: "尿急" },
						{ key: "dysuria", label: "尿痛" },
						{ key: "difficulty", label: "排尿困难" },
						{ key: "abnormal_volume", label: "尿量异常" },
						{ key: "hematuria", label: "血尿" },
						{ key: "color_change", label: "尿的颜色改变" },
						{ key: "incontinence", label: "尿失禁" },
						{ key: "facial_edema", label: "颜面水肿" },
						{ key: "lumbago", label: "腰痛" },
						{
							key: "other",
							label: "其它",
							detail: { type: "input", placeholder: "描述" },
						},
					],
				},
				{
					key: "hematologic",
					type: "checkbox_group",
					label: "血液系统",
					columns: 2,
					options: [
						{ key: "normal", label: "正常/无异" },
						{ key: "fatigue", label: "乏力" },
						{ key: "dizziness", label: "头晕" },
						{ key: "blurred_vision", label: "眼花" },
						{ key: "pallor", label: "皮肤黏膜苍白" },
						{ key: "jaundice", label: "黄疸" },
						{ key: "mucosal_bleeding", label: "皮肤黏膜出血" },
						{ key: "epistaxis", label: "鼻出血" },
						{ key: "hepatosplenomegaly", label: "肝脾淋巴结大" },
						{ key: "bone_pain", label: "骨痛" },
						{
							key: "other",
							label: "其它",
							detail: { type: "input", placeholder: "描述" },
						},
					],
				},
				{
					key: "endocrine",
					type: "checkbox_group",
					label: "内分泌及代谢",
					columns: 2,
					options: [
						{ key: "normal", label: "正常/无异" },
						{ key: "hyperorexia", label: "食欲亢进" },
						{ key: "chill", label: "畏寒" },
						{ key: "heat_intolerance", label: "怕热" },
						{ key: "hyperhidrosis", label: "多汗" },
						{ key: "polydipsia", label: "烦渴" },
						{ key: "polyuria", label: "多尿" },
						{ key: "tremor", label: "双手震颤" },
						{ key: "weight_change", label: "体重改变" },
						{ key: "hair_change", label: "毛发增多/脱落" },
						{ key: "pigmentation", label: "色素沉着" },
						{ key: "sexual_dysfunction", label: "性功能改变" },
						{
							key: "other",
							label: "其它",
							detail: { type: "input", placeholder: "描述" },
						},
					],
				},
				{
					key: "musculoskeletal",
					type: "checkbox_group",
					label: "肌肉骨骼系统",
					columns: 2,
					options: [
						{ key: "normal", label: "正常/无异" },
						{ key: "joint_pain", label: "关节疼痛" },
						{ key: "joint_swelling", label: "关节红肿" },
						{ key: "joint_deformity", label: "关节畸形" },
						{ key: "limb_disability", label: "肢体活动障碍" },
						{ key: "muscle_weakness", label: "肌无力" },
						{ key: "muscle_atrophy", label: "肌肉萎缩" },
						{
							key: "other",
							label: "其它",
							detail: { type: "input", placeholder: "描述" },
						},
					],
				},
				{
					key: "nervous",
					type: "checkbox_group",
					label: "神经系统",
					columns: 2,
					options: [
						{ key: "normal", label: "正常/无异" },
						{ key: "headache", label: "头痛" },
						{ key: "dizziness", label: "头晕" },
						{ key: "syncope", label: "晕厥" },
						{ key: "insomnia", label: "失眠" },
						{ key: "consciousness", label: "意识障碍" },
						{ key: "convulsion", label: "抽搐" },
						{ key: "paralysis", label: "瘫痪" },
						{ key: "paresthesia", label: "皮肤感觉异常" },
						{ key: "memory_loss", label: "记忆力减退" },
						{ key: "speech_disorder", label: "语言障碍" },
						{
							key: "other",
							label: "其它",
							detail: { type: "input", placeholder: "描述" },
						},
					],
				},
				{
					key: "mental_state",
					type: "checkbox_group",
					label: "精神状态",
					columns: 2,
					options: [
						{ key: "normal", label: "正常/无异" },
						{ key: "mood_change", label: "情绪改变" },
						{ key: "anxiety", label: "焦虑" },
						{ key: "depression", label: "抑郁" },
						{ key: "hallucination", label: "幻觉" },
						{ key: "delusion", label: "妄想" },
						{ key: "disorientation", label: "定向力障碍" },
						{ key: "intelligence_change", label: "智力改变" },
						{
							key: "other",
							label: "其它",
							detail: { type: "input", placeholder: "描述" },
						},
					],
				},
			],
		},

		// ========== 5. 心理评估 ==========
		{
			key: "psychological",
			label: "心理评估",
			icon: "HeartPulse",
			collapsible: true,
			items: [
				{
					key: "self_view",
					type: "radio",
					label: "对自我的看法",
					options: ["满意", "不满意", "其它"],
				},
				{
					key: "emotion",
					type: "radio",
					label: "情绪",
					options: ["镇静", "易激动", "焦虑", "恐惧", "悲哀", "其它"],
				},
				{
					key: "disease_awareness",
					type: "radio",
					label: "对疾病的认识",
					options: ["完全", "部分", "不认识", "未被告知"],
				},
				{
					key: "life_events",
					type: "compound",
					label: "过去1年内重要生活事件",
					trigger: {
						key: "status",
						type: "radio",
						label: "重要生活事件",
						options: ["无", "有"],
					},
					branches: {
						有: [
							{
								key: "description",
								type: "input",
								label: "描述",
								placeholder: "重要生活事件描述",
							},
						],
					},
				},
				{
					key: "confidant",
					type: "radio",
					label: "遇困难最愿意向谁倾诉",
					options: ["父母", "子女", "其它"],
				},
				{
					key: "religion",
					type: "radio",
					label: "宗教信仰",
					options: ["无", "佛教", "基督教", "伊斯兰教", "其它"],
				},
			],
		},

		// ========== 6. 社会评估 ==========
		{
			key: "social",
			label: "社会评估",
			icon: "Users",
			collapsible: true,
			items: [
				{
					key: "family_relation",
					type: "radio",
					label: "家庭关系",
					options: ["和睦", "冷淡", "紧张"],
				},
				{
					key: "marital_status",
					type: "radio",
					label: "婚姻状况",
					options: ["未婚", "已婚", "离婚", "丧偶", "其它"],
				},
				{
					key: "living_situation",
					type: "radio",
					label: "居住情况",
					options: ["独居", "和家人同住", "和亲友同住", "老人院"],
				},
				{
					key: "occupation",
					type: "radio",
					label: "职业状况",
					options: ["在岗", "下岗", "务农", "无业", "个体经营", "丧失劳动能力"],
				},
				{
					key: "education",
					type: "radio",
					label: "文化程度",
					options: ["文盲", "小学", "初中", "高中/中专", "大专", "大学及以上"],
				},
				{
					key: "social_interaction",
					type: "radio",
					label: "社会交往情况",
					options: ["正常", "较少", "回避"],
				},
				{
					key: "payment_method",
					type: "compound",
					label: "医疗费用支付形式",
					trigger: {
						key: "status",
						type: "radio",
						label: "支付形式",
						options: ["公费", "医疗保险", "自费", "其它"],
					},
					branches: {
						其它: [
							{
								key: "detail",
								type: "input",
								label: "描述",
								placeholder: "其他支付方式",
							},
						],
					},
				},
				{
					key: "hospitalization_concern",
					type: "checkbox_group",
					label: "住院顾虑",
					columns: 2,
					options: [
						{ key: "none", label: "无" },
						{ key: "financial", label: "经济负担" },
						{ key: "self_care", label: "自理能力" },
						{ key: "prognosis", label: "预后" },
						{
							key: "other",
							label: "其它",
							detail: { type: "input", placeholder: "描述" },
						},
					],
				},
			],
		},

		// ========== 7. 初步护理诊断 ==========
		{
			key: "nursing_diagnosis",
			label: "初步护理诊断",
			icon: "ClipboardList",
			collapsible: true,
			items: [
				{
					key: "preliminary_diagnosis",
					type: "textarea",
					label: "初步护理诊断",
					placeholder: "列出初步护理诊断...",
				},
			],
		},

		// ========== 8. 签名 ==========
		{
			key: "signature",
			label: "签名",
			icon: "PenLine",
			collapsible: true,
			items: [
				{ key: "nurse_signature", type: "input", label: "护士签名" },
				{ key: "date", type: "input", label: "日期" },
			],
		},
	],
};
