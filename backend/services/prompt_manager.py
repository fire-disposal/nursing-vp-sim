"""Prompt 模板管理器 —— 从 DB 加载模板，支持热切换和硬编码兜底"""
import logging
import asyncio

_logger = logging.getLogger("nursing")


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
            return self.system_prompt.format(**kwargs)
        except KeyError as e:
            missing = str(e).strip("'")
            raise RuntimeError(f"模板变量缺失: '{missing}' (purpose={self.purpose}, v{self.version})")

    def render_pair(self, **kwargs) -> tuple[str, str]:
        system = self.render(**kwargs)
        user = ""
        if self.user_prompt:
            try:
                user = self.user_prompt.format(**kwargs)
            except KeyError as e:
                missing = str(e).strip("'")
                raise RuntimeError(f"模板变量缺失: '{missing}' in user_prompt (purpose={self.purpose}, v{self.version})")
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
            rows = db.query(PT).filter(PT.is_active == True).all()
            if not rows:
                _logger.info("DB 中无 active prompt 模板，seed 默认值")
                self._seed_defaults(db)
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

    def _seed_defaults(self, db):
        from models import PromptTemplate as PT
        db.add(PT(purpose="qa", version=1, name="v1-默认QA",
                  system_prompt=_HARDCODED_QA, is_active=True, created_by="system"))
        db.add(PT(purpose="patient_chat", version=1, name="v1-默认患者对话",
                  system_prompt=_HARDCODED_PATIENT_CHAT, is_active=True, created_by="system"))
        db.add(PT(purpose="scoring", version=1, name="v1-默认评分",
                  system_prompt=_HARDCODED_SCORING_SYSTEM,
                  user_prompt=_HARDCODED_SCORING_USER, is_active=True, created_by="system"))
        db.commit()
        _logger.info("已从硬编码 seed 3 个默认 prompt 模板")

    async def get(self, purpose: str) -> PromptTemplateObj:
        async with self._lock:
            tmpl = self._cache.get(purpose)
        if tmpl is not None:
            return tmpl
        try:
            await self.load_from_db()
        except Exception:
            _logger.warning("reload 失败，使用硬编码兜底 for purpose=%s", purpose)
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

_HARDCODED_PATIENT_CHAT = """你是一个完全沉浸于角色的标准化病人（SP），请严格遵循下方角色信息进行演绎。

你只有护理学知识，只了解角色信息的内容——不额外了解疾病病因、检查结果或药理机制。请注意遵守伦理规则，不主动提供可能导致伤害的建议。如果学生问到超出你认知范围的内容，请用自然的方式表示"不知道"。

## 沟通风格
{communication_style}

## 角色信息
{patient_info}

## 病情核心信息
主诉：{chief_complaint}
现病史：{present_illness}
过敏史：{allergy_history}

## 当前注意事项
{hidden_info_rules}

## 演绎要求
1. 完全沉浸角色，忘记自己是AI。只用口语作答。
2. 内容控制在20~100词之间，要求友好而真实自然。
3. 回应当前访谈话，不要跳出主题。
4. 根据交谈进度逐步透露线索，核心重要信息可用符合人物知识水平的提示信号引导学生继续提问，但不要一次性给出所有信息。
5. 尽量关注患者角色当前面临的实际困难。
6. 如果没有新的痛苦或信息，可以出现对话停滞或说重复的话。
7. 不要评价学生表现，也不要说"你做的很棒"、"你采集得很全面"类似的话，只是沉浸在患者角色中与他互动。
8. 你的回答将用于语音播报，不要在回复中出现符号或缩写，如使用"体温升高了"而不是"体温↑"。
9. 如果学生说了告别的话，请自然地回应道别。"""

_HARDCODED_SCORING_SYSTEM = """你是一名资深的护理学临床导师，需要根据对话记录评估学生的问诊表现。

## 评分标准
{rubric_dim_text}

## 必要采集内容清单
{required_inquiries}

## 输出要求
请严格按照以下JSON格式输出评分结果：
```json
{rubric_json_template}
```

请确保：
1. 每个维度都有一个evidence的案例举证，具体引用对话内容
2. 评价要客观公正，既有优点也要指出不足
3. 遗漏的必问内容需在reason中明确指出
4. 建议要具体可行，针对学生的薄弱环节提出改进方向"""

_HARDCODED_SCORING_USER = """请基于以下学生与标准化患者的对话记录进行评分：

## 对话记录
{conversation_text}

请严格按照要求的JSON格式输出完整的评分报告。"""


def _hardcoded_fallback(purpose: str) -> PromptTemplateObj:
    """硬编码兜底 - 永不返回 None"""
    if purpose == "qa":
        return PromptTemplateObj(0, "qa", 0, _HARDCODED_QA, None)
    elif purpose == "patient_chat":
        return PromptTemplateObj(0, "patient_chat", 0, _HARDCODED_PATIENT_CHAT, None)
    elif purpose == "scoring":
        return PromptTemplateObj(0, "scoring", 0, _HARDCODED_SCORING_SYSTEM, _HARDCODED_SCORING_USER)
    else:
        raise ValueError(f"Unknown prompt purpose: {purpose}")


# ── 全局单例 ──

_manager: PromptManager | None = None


async def get_prompt_manager() -> PromptManager:
    global _manager
    if _manager is None:
        _manager = PromptManager()
        await _manager.load_from_db()
    return _manager


async def refresh_prompts():
    global _manager
    if _manager is None:
        _manager = PromptManager()
    await _manager.load_from_db()
