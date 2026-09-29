"""标准模板：**最小可运行病例**（管理端下载的起点 / 新建空白病例的骨架）。

模板是文本（带占位注释，作者打开就知道往哪儿写），所以它同时是"病例格式长什么样"的活文档：
`tests/scenario_training/test_case_folder.py` 断言它解析得开、校验得过、并且能装库。

**唯一的一份**：下载走 `files()`（原样文本，保留注释），新建空白病例走 `content()`（同一份文本
解析成内容 dict）——两处不会各说各话。
"""

from __future__ import annotations

from typing import Any

from .case_folder import CASE_MD, CASE_TOML, parse_files, quoted, safe_name

_KEY = "@@KEY@@"
_TITLE = "@@TITLE@@"

TOML_TEMPLATE = f"""\
# 一个病例 = 一个文件夹：case.toml（机制与 meta）+ case.md（散文，四个固定小节）+ img/（图片字节）。
# 下面是平台给的最小可运行病例（一个人物、一条线索、一个动作）：改完可以直接 import 试跑。

key = {_KEY}
title = {_TITLE}
one_line = "一句话说明这是什么处境（改我）"

[player]
# 学生扮演谁
role = "责任护士"

[setting]
place = "病房"
time_hint = ""              # 例如「凌晨 02:10」；留空就是不说明时间
resources = []              # 手边有什么：["床旁吸引器", "呼叫铃"]

[[cue]]
# 现场可见的东西。visible_from_start = true = 学生一进来就看见；
# 其余的等动作的 reveals 揭示（没揭示前学生看不到、模型也不许提前说）。
id = "c_first"
text = "（写下学生一进来就看得见的东西）"
visible_from_start = true

[[actor]]
# 现场的人物。性格、语气、在意什么写在 case.md 的「### <id>」那一段里，这里不重复写。
id = "patient"
role = "患者"
presence = "on_site"        # on_site / remote / callable / inaccessible
demand = "neutral"          # loud / quiet / neutral：他要不要抢注意力

[actor.knowledge]
# 这个人知道什么（信息隔离边界：他没说出口、学生也问不到的，模型不许替他说）。
# 主诉 = "……"

[[affordance]]
# 学生能做的动作。type 只有六种：ask / observe / measure / act / document / summon
id = "ask_open"
type = "ask"
label = "问一句（改我）"
reveals = ["c_first"]       # 这个动作揭示哪些线索

[[affordance.targets]]
kind = "actor"
id = "patient"

# 剩下的表按需打开（形状写在注释里，照抄改值即可）：
#   [state_keys]                     scene.spo2 = 88          # 状态键 <target>.<key> = 初值
#   [state_bounds."scene.spo2"]      lo = 0 / hi = 100        # 数值键的写边界
#   [[fact]]                         id / intent / critical   # 判读要观察的事实
#   [[criterion]]                    id / title / rule / weight  # 本场景自写的判据（权重合计 100）
#     [criterion.anchors]            strong / adequate / missed 各写一句
#   [[device]] + [[device.channel]]  # 设备面：要给学生看的读数都挂在这里
#   [[asset]]                        file = "xxx.png"  # 图片字节放 img/xxx.png
#   failure = "irreversible"         # 不可逆结局要另写 [[failure_when.all]] 的条件
"""

MD_TEMPLATE = """\
## 处境

（一段话写清学生睁眼时的处境：在哪儿、什么时候、眼前是什么情况。）

## 人物

### patient

（这个人是个什么样的人：怎么说话、在意什么、什么情况下会松口。
学生会从他的语气里判断要不要再问下去。）

## 真相

（学生看不到的真相：现场到底是怎么回事、正确处置是什么。一条一段、空行分隔。
这一段同时是防泄漏词表——这里的说法一个字都不许出现在学生可见的文本里。）

## 教师备注

（写给自己与同事：这个病例想让学生注意到什么、常见的走偏是哪几条。）
"""


def files(key: str = "new-case", title: str = "新病例") -> dict[str, bytes]:
    """模板的文件集合（保留注释的原文；`key`/`title` 预填）。"""
    toml = TOML_TEMPLATE.replace(_KEY, quoted(safe_name(key, what="key"))).replace(_TITLE, quoted(title))
    return {CASE_TOML: toml.encode("utf-8"), CASE_MD: MD_TEMPLATE.encode("utf-8")}


def content(key: str = "new-case", title: str = "新病例") -> dict[str, Any]:
    """同一份模板 → 内容 dict（新建空白病例用；不落库、不校验，调用方照常走校验）。"""
    return parse_files(files(key, title)).content
