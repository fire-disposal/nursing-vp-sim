"""Prompt 模板管理器 —— 从 DB 加载模板，支持热切换和硬编码兜底"""
import logging
import asyncio
import re

_logger = logging.getLogger("nursing")

_VAR_RE = re.compile(r"\{#([^}#]+)#\}")


def render_template(template: str, **kwargs) -> str:
    """安全模板渲染：用 {#variable#} 语法替换变量，变量值中的任何字符（含 {}）都原样保留。"""
    def _replace(m: re.Match) -> str:
        var = m.group(1).strip()
        if var not in kwargs:
            raise RuntimeError(f"模板变量缺失: '{var}'")
        return str(kwargs[var])

    try:
        return _VAR_RE.sub(_replace, template)
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError(f"模板渲染异常: {e}")


class PromptTemplateObj:
    """单个 prompt 模板实例，支持变量渲染"""
    def __init__(self, id: int, purpose: str, version: int, system_prompt: str,
                 user_prompt: str | None):
        self.id = id
        self.purpose = purpose
        self.version = version
        self.system_prompt = system_prompt
        self.user_prompt = user_prompt

    def render(self, **kwargs) -> str:
        try:
            return render_template(self.system_prompt, **kwargs)
        except RuntimeError as e:
            import re as _re
            expected = sorted(set(_re.findall(r"\{#([^}#]+)#\}", self.system_prompt)))
            provided = sorted(kwargs.keys())
            missing = [v for v in expected if v not in kwargs]
            raise RuntimeError(
                f"{e} (purpose={self.purpose}, v{self.version}, "
                f"期望变量: {expected}, 实际传入: {provided}, 缺失: {missing})"
            )

    def render_pair(self, **kwargs) -> tuple[str, str]:
        system = self.render(**kwargs)
        user = ""
        if self.user_prompt:
            try:
                user = render_template(self.user_prompt, **kwargs)
            except RuntimeError as e:
                raise RuntimeError(f"{e} in user_prompt (purpose={self.purpose}, v{self.version})")
        return system, user


class PromptManager:
    def __init__(self):
        self._cache: dict[str, PromptTemplateObj] = {}
        self._last_valid_cache: dict[str, PromptTemplateObj] | None = None
        self._lock = asyncio.Lock()

    async def load_from_db(self):
        from database import SessionLocal
        from models import PromptTemplate as PT

        db = SessionLocal()
        try:
            self._upsert_v1_defaults(db)

            rows = db.query(PT).filter(PT.is_active == True).all()

            new_cache = {}
            for r in rows:
                new_cache[r.purpose] = PromptTemplateObj(
                    id=r.id, purpose=r.purpose, version=r.version,
                    system_prompt=r.system_prompt, user_prompt=r.user_prompt,
                )

            async with self._lock:
                self._last_valid_cache = self._cache
                self._cache = new_cache
            _logger.info("PromptManager 加载: %d 个模板", len(new_cache))
        except Exception:
            _logger.exception("PromptManager 加载失败")
            if self._last_valid_cache:
                async with self._lock:
                    self._cache = self._last_valid_cache
                _logger.warning("保留上次有效缓存")
            raise
        finally:
            db.close()

    def _upsert_v1_defaults(self, db):
        """强制 v1 模板始终与代码内置版本一致。每次启动 upsert，确保部署后旧语法被覆写。"""
        from models import PromptTemplate as PT

        defaults = [
            ("qa", "v1-默认QA", _HARDCODED_QA, None),
            ("patient_chat", "v1-默认患者对话", _HARDCODED_PATIENT_CHAT, None),
            ("scoring", "v1-默认评分", _HARDCODED_SCORING_SYSTEM, _HARDCODED_SCORING_USER),
            ("case_generation", "v1-默认病例生成", _HARDCODED_CASE_GENERATION, None),
        ]
        updated = 0
        for purpose, name, system_prompt, user_prompt in defaults:
            v1 = db.query(PT).filter(PT.purpose == purpose, PT.version == 1).first()
            if v1:
                old_sp = v1.system_prompt
                v1.system_prompt = system_prompt
                v1.user_prompt = user_prompt
                v1.name = name
                v1.is_active = True
                from services.variable_registry import get_registry
                v1.variables = get_registry().get_variables_jsonb(purpose)
                if old_sp != system_prompt:
                    updated += 1
            else:
                from services.variable_registry import get_registry
                db.add(PT(
                    purpose=purpose, version=1, name=name,
                    system_prompt=system_prompt, user_prompt=user_prompt,
                    variables=get_registry().get_variables_jsonb(purpose),
                    is_active=True, created_by="system",
                ))
                updated += 1
        if updated:
            db.commit()
            _logger.info("v1 默认模板已同步: %d 个更新", updated)

    async def get(self, purpose: str) -> PromptTemplateObj:
        async with self._lock:
            tmpl = self._cache.get(purpose)
        if tmpl is not None:
            return tmpl
        try:
            await self.load_from_db()
        except Exception:
            _logger.warning("reload 失败，使用硬编码兜底 for purpose=%s", purpose)
        async with self._lock:
            tmpl = self._cache.get(purpose)
        if tmpl is not None:
            return tmpl
        return _hardcoded_fallback(purpose)

    async def reload(self):
        await self.load_from_db()


# ── 硬编码兜底 ──

_HARDCODED_QA = """你是一名专业的护理学教育导师，你的职责是帮助护理专业学生学习和理解护理学知识。你有以下五项核心能力：

1.  回答各类护理学相关的**健康史采集方法**问题，包括一般资料、社会心理状况、生活型态、各系统过去健康史、各系统功能性健康型态评估等。
2.  回答**护理评估框架**相关问题，包括11项功能性健康型态（健康感知与健康管理、营养与代谢、排泄、活动与运动、睡眠与休息、认知与感知、自我概念、角色与关系、性与生殖、压力与耐受、价值与信念）。
3.  帮助学生区分**护理诊断**与**医疗诊断**的区别，分析护理诊断的组成部分（问题、病因、症状和体征），并教授书写规范。
4.  回答**护理操作标准**、无菌技术、生命体征测量、给药流程等护理技能问题。
5.  帮助学生理解**自我护理**和**健康信念**的评估方法及其对护理计划的影响。

你的回答要求：
1.  专业但通俗易懂，**保护患者隐私**，体现人文关怀。
2.  语言简洁明了，避免冗长复杂的解释，长度控制在200字以内。
3.  对不确定的问题，诚实说明"目前对此没有足够的信息"，并给出合理的建议方向。
4.  适时提供具体的临床案例或情境来说明抽象概念。
5.  鼓励学生主动思考，可在回复中适当提出引导性问题。
6.  始终保持支持和鼓励的态度，强调持续学习和临床实践的重要性。

重要限制：
1.  你只能讨论护理学相关的学术和专业问题。
2.  如何被问到护理之外的问题，请友善地引导学生回到护理学轨道。
3.  不能提供任何的处方建议、医疗诊断意见或替代临床指导老师的角色。"""

_HARDCODED_PATIENT_CHAT = """你是护理病史采集训练中的虚拟患者。你只能扮演患者本人，不能扮演护士、医生、老师、AI或评分者。
对话对象是护理学生/护生/护士实习生，不是医生；称呼对方时只能说"护士""同学"或直接说"你"，禁止称呼"医生""大夫""医师"。

你只有护理学知识，只了解下方角色信息的内容——不额外了解疾病病因、检查结果或药理机制。

## 核心规则
1. 只回答学生刚刚问到的问题，不主动补充完整病史
2. 资料中没有的信息说"不太清楚"或"记不清"，绝不编造
3. 隐藏信息只有学生明确问到相关主题时才透露
4. 每次中文自然口语回答，50-120字，可适当表达不适或担心
5. 不评价学生表现，不指导学生该问什么

## 患者资料
{#patient_info#}

主诉：{#chief_complaint#}
现病史：{#present_illness#}
过敏史：{#allergy_history#}

## 沟通风格
{#communication_style#}

## 可透露的隐藏信息（学生已明确问到相关主题）
{#hidden_info_rules#}

## 输出格式
只输出患者会说的话，不要加"患者："、括号说明、动作描写或分析。不要以"根据我的病例资料""作为患者""你问得很好"等开头。
你的回答将用于语音播报，不要在回复中出现符号或缩写，如使用"体温升高了"而不是"体温↑"。
如果学生说了告别的话，请自然地回应道别。"""

_HARDCODED_SCORING_SYSTEM = """你是一位经验丰富的护理教育评估专家，专门评估护理学生的病史采集能力。

{#scoring_rubric#}

## 评分背景
- 学生角色：护理学生
- 训练目标：练习系统的护理病史采集技能
- 评估重点：沟通技能 + 病史采集能力

## 评分要求

1. **逐项证据化评分**：每一条目必须根据对话实际内容独立评分。必须提供 `evidence`（对话中的具体证据，30-80字）和 `reason`（评分理由，20-50字）。学生未提及该条目相关内容则打1分，evidence 写"未涉及"。

2. **优点与不足必须具体**：strengths 和 weaknesses 要引用对话中的具体行为。

3. **漏问内容精准**：missed_content 列出学生确实没有问到的重要信息。

4. **suggestions 个性化**：结合对话实际内容反馈，格式为"你在XX方面表现得很好，但在XX方面还有提升空间，建议下次训练时注意..."。

评分要客观公正，结果要能帮助护理学生明确知道自己的优势和待改进之处。"""

_HARDCODED_SCORING_USER = """请评估以下护理学生与患者的病史采集对话：

{#conversation_text#}

请逐项评分，每项给出证据和理由。"""

_HARDCODED_CASE_GENERATION = """你是一名资深的护理学教育专家和临床病例编写专家。你的任务是根据用户提供的描述，生成一份完整的护理病史采集训练病例。

## 输出格式要求
必须输出**严格的 JSON**（不含 markdown 代码块标记），结构如下：

```json
{
  "name": "病例名称（20字以内，基于主诉概括）",
  "difficulty": 1,
  "time_limit": 20,
  "description": "训练目标描述（一句话）",
  "patient_info": {"name": "患者姓名（中文名）", "age": 0, "gender": "男/女"},
  "chief_complaint": "主诉（含部位、性质、持续时间、诱因）",
  "opening_line": "开场白（患者对护士说的第一句话，口语化）",
  "present_illness": "现病史（起病情况、发展经过、诊疗经过）",
  "past_history": "既往史",
  "medication_history": "用药史",
  "allergy_history": "过敏史",
  "family_history": "家族史",
  "social_history": "社会史/生活习惯",
  "communication_style": "沟通风格描述（友善自然/紧张焦虑/含糊其辞+细节）",
  "hidden_info": ["隐藏信息列表（患者不会主动透露但学生应该通过问诊发现的线索）"],
  "hidden_info_rules": [
    {"topic": "话题名", "content": "患者可以透露的具体信息", "trigger_keywords": ["关键词1", "关键词2"]}
  ],
  "required_inquiries": ["必须采集到的关键内容"],
  "scoring_criteria": {
    "沟通技能": {
      "max": 42,
      "description": "评估学生的沟通能力",
      "items": [
        {"id": "comm_1", "name": "主动问候与自我介绍", "anchors": {"1": "未问候", "2": "部分问候", "3": "完整问候与自我介绍"}},
        {"id": "comm_2", "name": "使用通俗易懂的语言", "anchors": {"1": "使用大量专业术语", "2": "部分通俗", "3": "语言通俗易懂"}},
        {"id": "comm_3", "name": "表达关怀与尊重", "anchors": {"1": "缺乏关怀", "2": "偶尔表达", "3": "全程表达关怀"}}
      ]
    },
    "病史采集": {
      "max": 15,
      "description": "评估病史采集的系统性和完整性",
      "items": [
        {"id": "hist_1", "name": "主诉信息采集完整性", "anchors": {"1": "仅问名称", "2": "问部分细节", "3": "完整采集部位/性质/时间/诱因"}},
        {"id": "hist_2", "name": "现病史采集", "anchors": {"1": "未问", "2": "部分采集", "3": "系统采集起病、经过、诊疗"}},
        {"id": "hist_3", "name": "既往史采集", "anchors": {"1": "未问", "2": "简单提及", "3": "系统询问"}},
        {"id": "hist_4", "name": "过敏史采集", "anchors": {"1": "未问", "2": "简单提及", "3": "具体询问过敏史"}},
        {"id": "hist_5", "name": "用药史采集", "anchors": {"1": "未问", "2": "简单提及", "3": "详细询问"}}
      ]
    }
  }
}
```

## 用户描述
{#description#}

## 参考资料
{#reference_material#}

## 临床生成指南
1. **真实可信**：症状描述、时间线、流行病学特征（年龄、性别高发）需符合临床实际
2. **教育价值**：隐藏信息和必须采集清单应有挑战性但不过于冷门，适合护理学生训练
3. **评分标准**：根据病例的临床特点微调 scoring_criteria 的 items，确保与 required_inquiries 对应
4. **语言口语化**：opening_line 和 communication_style 要有真实患者的口吻
5. **患者信息多样化**：姓名随机生成，年龄与疾病特征匹配

## 字段生成指南
- 如果用户指定了 field 为非 null，只生成并返回对应字段的值（如 {"field_value": [...]}）
- 如果 field 为 null，生成完整病例

直接输出 JSON，不要任何解释、前言或后记。"""


def _hardcoded_fallback(purpose: str) -> PromptTemplateObj:
    """硬编码兜底 - 永不返回 None"""
    if purpose == "qa":
        return PromptTemplateObj(0, "qa", 0, _HARDCODED_QA, None)
    elif purpose == "patient_chat":
        return PromptTemplateObj(0, "patient_chat", 0, _HARDCODED_PATIENT_CHAT, None)
    elif purpose == "scoring":
        return PromptTemplateObj(0, "scoring", 0, _HARDCODED_SCORING_SYSTEM, _HARDCODED_SCORING_USER)
    elif purpose == "case_generation":
        return PromptTemplateObj(0, "case_generation", 0, _HARDCODED_CASE_GENERATION, None)
    else:
        raise ValueError(f"Unknown prompt purpose: {purpose}")


# ── 全局单例 ──

_manager: PromptManager | None = None
_manager_lock = asyncio.Lock()


async def get_prompt_manager() -> PromptManager:
    global _manager
    if _manager is not None:
        return _manager
    async with _manager_lock:
        if _manager is None:
            _manager = PromptManager()
            await _manager.load_from_db()
    return _manager


async def refresh_prompts():
    global _manager
    if _manager is None:
        _manager = PromptManager()
    await _manager.load_from_db()
