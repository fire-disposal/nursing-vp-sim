"""病例文件夹 ⇄ 病例内容（**无损**）+ zip 收发。

一份病例 = 一个文件夹 `cases/<key>/`：

    case.toml   机制与 meta（动作、判据、状态键、设备、图片声明……）
    case.md     散文，**固定四个小节**：`## 处境` / `## 人物` / `## 真相` / `## 教师备注`
    img/<file>  图片字节，`asset.file` 指向它

规矩：
- **TOML 只装机制与 meta，MD 只装散文**：同一份事实一处落点（`test_case_folder.py` 逐字段断言）。
- **解析只按标题切块**，不做行内语法（`风格：…` 这种写法不认），因此往返无损：
  `folders → pack → folders` 文本逐字节相同、`pack → folders → pack` 模型深相等。
- **图片不重编码**：`img/` 里的字节原样进出；`mime` 由文件名后缀还原（`assets.SUFFIX_MIME`）。
- 不属于"内容"、**不参与往返**的：`st_packs.version/published/published_at`（运行期事实，
  不在 `ScenarioPack` 里）与 `st_assets` 行主键（库内身份，由 `(pack_key, asset_id)` 定位）。

TOML 里的表名与模型字段名**不是**一一对应（按作者读的顺序排版）：`setting.cues` → 顶层
`[[cue]]`、`presentation.devices` → 顶层 `[[device]]`、`Device.channels` → `[[device.channel]]`、
`Asset.file` → 图片文件名。映射只有这一处（导出与导入互为逆），别处不要再抄一份。
"""

from __future__ import annotations

import io
import json
import pathlib
import re
import tomllib
import zipfile
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from .schema import ScenarioPack

CASES_DIR = pathlib.Path(__file__).resolve().parent / "cases"
CASE_TOML = "case.toml"
CASE_MD = "case.md"
IMG_DIR = "img"

#: 压缩包的两道闸（**系统稳定**：不让人用一个包把内存/库撑爆）
MAX_ZIP_BYTES = 32 * 1024 * 1024
MAX_ZIP_FILES = 64

_SECTIONS = ("处境", "人物", "真相", "教师备注")


class CaseFolderError(RuntimeError):
    """病例文件夹或压缩包不可用（原因写给人看）。"""


@dataclass(frozen=True)
class ParsedCase:
    """一次解析的结果：内容 dict（与 `st_packs.content` 同形状）+ 图片字节 + 宽容导入的提示。"""

    content: dict[str, Any]
    images: dict[str, bytes] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# TOML 写出（确定性、无依赖；只写本模块 `_doc` 造出来的那些形状）
# --------------------------------------------------------------------------- #

_BARE_KEY = re.compile(r"^[A-Za-z0-9_-]+$")


def _key(key: str) -> str:
    """裸键或带引号的键——含 `.`（如 `scene.spo2`）的键必须带引号，否则会被读成嵌套表。"""
    return key if _BARE_KEY.match(key) else quoted(key)


def quoted(value: str) -> str:
    """TOML 基本字符串（JSON 的转义集是它的子集：`\\\\` `"` `\\n` `\\t` `\\uXXXX`）。

    唯一需要拼 TOML 文本的地方是标准模板的预填（`standard_case`）——别处一律走 `_value`。
    """
    return json.dumps(value, ensure_ascii=False)


def _value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        return quoted(value)
    if isinstance(value, (list, tuple)):
        return "[" + ", ".join(_value(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ", ".join(f"{_key(key)} = {_value(item)}" for key, item in value.items()) + "}"
    raise CaseFolderError(f"TOML 表达不了这个值（null 要写成省略）：{value!r}")


def _is_tables(value: Any) -> bool:
    return isinstance(value, list) and bool(value) and all(isinstance(item, dict) for item in value)


def _has_scalars(table: Mapping[str, Any]) -> bool:
    return any(not isinstance(value, dict) and not _is_tables(value) for value in table.values())


def _emit(lines: list[str], prefix: str, table: Mapping[str, Any]) -> None:
    """一张表：先标量、再子表、最后数组表——TOML 要求同一张表里标量在子表之前。"""
    scalars = [(key, value) for key, value in table.items() if not isinstance(value, dict) and not _is_tables(value)]
    for key, value in scalars:
        lines.append(f"{_key(key)} = {_value(value)}")
    for key, value in table.items():
        if not isinstance(value, dict):
            continue
        path = f"{prefix}.{_key(key)}" if prefix else _key(key)
        # 只有子表的父表不另写空表头（子表头会隐式建立它），只有真为空时才写 `[x]`
        if not value or _has_scalars(value):
            lines.append("")
            lines.append(f"[{path}]")
        _emit(lines, path, value)
    for key, value in table.items():
        if not _is_tables(value):
            continue
        path = f"{prefix}.{_key(key)}" if prefix else _key(key)
        for item in value:
            lines.append("")
            lines.append(f"[[{path}]]")
            _emit(lines, path, item)


def _toml_dumps(doc: Mapping[str, Any]) -> str:
    lines: list[str] = []
    _emit(lines, "", doc)
    return "\n".join(lines).strip("\n") + "\n"


# --------------------------------------------------------------------------- #
# 模型 → TOML / MD
# --------------------------------------------------------------------------- #


def _sort_maps(value: Any) -> Any:
    """自由映射（作者随手写的键→值）按键排序。

    键序没有语义，但 Postgres 的 JSONB 会按自己的规矩重排键——不排序的话，"库 → 文件夹"
    导出的 TOML 与仓库里那一份只差键的顺序，每次导出都刷出一大片无意义 diff。
    """
    if isinstance(value, dict):
        return {key: _sort_maps(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [_sort_maps(item) for item in value]
    return value


#: 需要排序的字段：自由映射（模型自己的字段顺序**不动**——那是排给人读的）
_FREE_MAPS = frozenset({"params", "knowledge", "anchors", "score_map", "state_keys", "state_bounds"})


def _lean(model: Any) -> dict[str, Any]:
    """子模型的字段：丢掉默认值与空值（TOML 没有 null），读回时由模型默认值补上——无损。"""
    return {
        key: _sort_maps(value) if key in _FREE_MAPS else value
        for key, value in model.model_dump(mode="json", exclude_defaults=True, exclude_none=True).items()
    }


def _actor_doc(actor: Any) -> dict[str, Any]:
    doc = _lean(actor)
    doc.pop("persona", None)  # 散文：走 case.md
    return doc


def _device_doc(device: Any) -> dict[str, Any]:
    doc = _lean(device)
    channels = doc.pop("channels", None)
    if channels:
        doc["channel"] = channels
    return doc


def _doc(pack: ScenarioPack) -> dict[str, Any]:
    """病例模型 → 文件的字段结构（导出唯一的映射处，顺序就是文件里的顺序）。"""
    setting = _lean(pack.setting)
    setting.pop("cues", None)
    doc: dict[str, Any] = {"key": pack.key, "title": pack.title}
    doc.update(
        {
            key: value
            for key, value in [
                ("one_line", pack.one_line),
                ("player", _lean(pack.player)),
                ("setting", setting),
                ("cue", [_lean(cue) for cue in pack.setting.cues]),
                ("actor", [_actor_doc(actor) for actor in pack.actors]),
                ("state_keys", _sort_maps(dict(pack.state_keys))),
                ("state_bounds", {key: _lean(pack.state_bounds[key]) for key in sorted(pack.state_bounds)}),
                ("affordance", [_lean(affordance) for affordance in pack.affordances]),
                ("fact", [_lean(fact) for fact in pack.facts]),
                ("criterion", [_lean(criterion) for criterion in pack.rubric]),
                ("device", [_device_doc(device) for device in pack.presentation.devices]),
                ("asset", [_lean(asset) for asset in pack.assets]),
                ("failure", "" if pack.failure == "recoverable" else pack.failure),
                ("failure_when", {} if pack.failure_when is None else _lean(pack.failure_when)),
            ]
            if value
        }
    )
    return doc


def _paragraphs(text: str) -> list[str]:
    """纯文本块 → 段落（空行分段；段内换行原样保留）。"""
    return [block.strip() for block in re.split(r"\n\s*\n", text) if block.strip()]


def _md_doc(pack: ScenarioPack) -> str:
    # 真相按**空行分段**（段内换行原样保留）：一条里有空行、或整条是空白，都读不回来——
    # 与其悄悄改掉作者的词表（`truth` 同时是防泄漏词表），不如在这里说清楚。
    for item in pack.truth:
        if len(_paragraphs(item)) != 1:
            raise CaseFolderError(f"真相的一条必须是一段（不能有整行空白）：{item.strip()[:40]!r}")
    rows: list[str] = ["## 处境", "", pack.brief.strip(), "", "## 人物", ""]
    for actor in pack.actors:
        rows.extend([f"### {actor.id}", "", actor.persona.strip(), ""])
    rows.extend(["## 真相", "", "\n\n".join(item.strip() for item in pack.truth), ""])
    rows.extend(["## 教师备注", "", pack.teacher_notes.strip(), ""])
    return "\n".join(rows).strip("\n") + "\n"


# --------------------------------------------------------------------------- #
# TOML / MD → 模型
# --------------------------------------------------------------------------- #

#: 每个表里认得的键（其余是**拼错或多写**：不失败，但要在 `problems` 里说一声）
_KNOWN_KEYS: dict[str, frozenset[str]] = {
    "": frozenset(
        {
            "key",
            "title",
            "one_line",
            "player",
            "setting",
            "cue",
            "actor",
            "state_keys",
            "state_bounds",
            "affordance",
            "fact",
            "criterion",
            "device",
            "asset",
            "failure",
            "failure_when",
        }
    ),
    "player": frozenset({"role"}),
    "setting": frozenset({"place", "time_hint", "resources"}),
    "cue": frozenset({"id", "text", "visible_from_start"}),
    "actor": frozenset({"id", "role", "presence", "knowledge", "demand"}),
    "affordance": frozenset(
        {
            "id",
            "type",
            "label",
            "params",
            "time_cost",
            "select",
            "free_input",
            "confirm",
            "targets",
            "effects",
            "reveals",
            "visible_when",
        }
    ),
    "fact": frozenset({"id", "intent", "critical", "banned_phrases", "cue_ids", "affordance_ids"}),
    "criterion": frozenset({"id", "title", "rule", "params", "anchors", "weight", "score_map"}),
    "device": frozenset({"id", "kind", "title", "sound", "visible_when", "channel"}),
    "asset": frozenset({"id", "kind", "file", "title", "alt", "reveal_with"}),
}


def _unknown_keys(doc: Mapping[str, Any]) -> list[str]:
    notes: list[str] = []
    for table, known in _KNOWN_KEYS.items():
        value = doc if table == "" else doc.get(table)
        if value is None:
            continue
        items = value if isinstance(value, list) else [value]
        for item in items:
            if not isinstance(item, dict):
                continue
            extra = sorted(set(item) - known)
            if extra:
                notes.append(f"{table or 'case.toml'} 里不认得的键（已忽略）：{'、'.join(extra)}")
    return notes


def _toml_text(files: Mapping[str, bytes]) -> str:
    raw = files.get(CASE_TOML)
    if raw is None:
        raise CaseFolderError(f"缺 {CASE_TOML}")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise CaseFolderError(f"{CASE_TOML} 不是 UTF-8 文本：{exc}") from exc


def parse_toml(text: str) -> dict[str, Any]:
    """TOML 文本 → 字段结构（解析失败给可读原因）。"""
    try:
        return tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        raise CaseFolderError(f"{CASE_TOML} 解析失败：{exc}") from exc


def parse_md(text: str) -> tuple[dict[str, Any], list[str]]:
    """MD 文本 → `{brief, personas, truth, teacher_notes}` + 提示（只按标题切块）。"""
    sections: dict[str, list[str]] = {}
    notes: list[str] = []
    current: str | None = None
    for line in text.splitlines():
        if line.startswith("## "):
            name = line[3:].strip()
            current = name if name in _SECTIONS else None
            if name in _SECTIONS:
                sections[name] = []
            else:
                notes.append(f"{CASE_MD} 里不认得的小节（已忽略）：{name}")
        elif current is not None:
            sections[current].append(line)

    def block(name: str) -> str:
        return "\n".join(sections.get(name, [])).strip()

    segments: dict[str, list[str]] = {}
    actor_id: str | None = None
    for line in sections.get("人物", []):
        if line.startswith("### "):
            actor_id = line[4:].strip()
            segments.setdefault(actor_id, [])
        elif actor_id is not None:
            segments[actor_id].append(line)
    personas = {key: "\n".join(lines).strip() for key, lines in segments.items()}
    return (
        {
            "brief": block("处境"),
            "personas": personas,
            "truth": _paragraphs(block("真相")),
            "teacher_notes": block("教师备注"),
        },
        notes,
    )


def _content(doc: Mapping[str, Any], prose: Mapping[str, Any]) -> dict[str, Any]:
    """TOML 字段结构 + MD 散文 → 内容 dict（导入唯一的映射处，与 `_doc` 互为逆）。

    形状不对的条目原样交给 pydantic 报（它给的消息比"这里 KeyError 了"有用）。
    """
    setting = dict(doc.get("setting") or {})
    cues = doc.get("cue") or []
    people = []
    for item in doc.get("actor") or []:
        actor = dict(item) if isinstance(item, dict) else item
        if isinstance(actor, dict):
            actor["persona"] = prose["personas"].get(str(actor.get("id", "")), "")
        people.append(actor)
    devices = []
    for item in doc.get("device") or []:
        device = dict(item) if isinstance(item, dict) else item
        if isinstance(device, dict):
            channels = device.pop("channel", None)
            if channels is not None:
                device["channels"] = channels
        devices.append(device)
    return {
        "key": doc.get("key"),
        "title": doc.get("title"),
        "one_line": doc.get("one_line", ""),
        "brief": prose["brief"],
        "player": doc.get("player") or {},
        "setting": {**setting, "cues": cues},
        "actors": people,
        "state_keys": doc.get("state_keys") or {},
        "state_bounds": doc.get("state_bounds") or {},
        "truth": prose["truth"],
        "affordances": doc.get("affordance") or [],
        "facts": doc.get("fact") or [],
        "rubric": doc.get("criterion") or [],
        "presentation": {"devices": devices},
        "assets": doc.get("asset") or [],
        "failure": doc.get("failure", "recoverable"),
        "failure_when": doc.get("failure_when"),
        "teacher_notes": prose["teacher_notes"],
    }


# --------------------------------------------------------------------------- #
# 路径安全（key 与图片文件名都会进 zip 成员名与磁盘路径）
# --------------------------------------------------------------------------- #

_UNSAFE = re.compile(r"[/\\]")


def safe_name(name: str, *, what: str) -> str:
    """`key` 与 `asset.file` 只允许**一个名字**：不含分隔符、不是 `.`/`..`、长度有限。"""
    if not name or _UNSAFE.search(name) or name in (".", "..") or len(name) > 128:
        raise CaseFolderError(f"{what} 不能用作文件名：{name!r}")
    return name


def safe_member(name: str) -> str:
    """压缩包成员名 → 相对路径（**zip-slip 防护**：绝对路径、`..`、盘符一律拒）。"""
    cleaned = name.replace("\\", "/")
    parts = [part for part in cleaned.split("/") if part not in ("", ".")]
    if cleaned.startswith("/") or re.match(r"^[A-Za-z]:", cleaned) or ".." in parts or not parts:
        raise CaseFolderError(f"压缩包里的路径不安全：{name!r}")
    return "/".join(parts)


# --------------------------------------------------------------------------- #
# 文件夹 ⇄ 文件集合
# --------------------------------------------------------------------------- #


def dump_toml(pack: ScenarioPack) -> str:
    return _toml_dumps(_doc(pack))


def dump_md(pack: ScenarioPack) -> str:
    return _md_doc(pack)


def case_files(pack: ScenarioPack, images: Mapping[str, bytes] | None = None) -> dict[str, bytes]:
    """病例 → 一个文件夹的全部文件（相对路径 → 字节；不含 zip 的根目录前缀）。"""
    files: dict[str, bytes] = {
        CASE_TOML: dump_toml(pack).encode("utf-8"),
        CASE_MD: dump_md(pack).encode("utf-8"),
    }
    for name, data in (images or {}).items():
        files[f"{IMG_DIR}/{safe_name(name, what='图片文件名')}"] = data
    return files


def _inside_root(files: Mapping[str, bytes]) -> tuple[dict[str, bytes], list[str]]:
    """定位病例的根目录（zip 里可能套了一层目录名）→ 根目录内的文件 + 提示。"""
    keys = {safe_member(name): data for name, data in files.items()}
    roots = [name[: -len(CASE_TOML)] for name in keys if name == CASE_TOML or name.endswith(f"/{CASE_TOML}")]
    if not roots:
        raise CaseFolderError(f"没有找到 {CASE_TOML}（病例的第一个文件）")
    if len(roots) > 1:
        raise CaseFolderError(f"找到多个 {CASE_TOML}：{'、'.join(sorted(roots))}（一个压缩包只能装一个病例）")
    root = roots[0]
    inside = {name[len(root) :]: data for name, data in keys.items() if name.startswith(root)}
    notes = [f"忽略了 {len(keys) - len(inside)} 个不在 {root} 下的文件"] if len(keys) != len(inside) else []
    return inside, notes


def _case_images(inside: Mapping[str, bytes], content: Mapping[str, Any]) -> tuple[dict[str, bytes], list[str]]:
    """`img/` 里**被声明过**的字节（其余忽略并提示），以及声明了却没字节的那些。"""
    assets = [item for item in content["assets"] if isinstance(item, dict)]
    declared = {str(asset.get("file") or ""): str(asset.get("id")) for asset in assets}
    images: dict[str, bytes] = {}
    extra = []
    for name, data in inside.items():
        if not name.startswith(f"{IMG_DIR}/"):
            if name not in (CASE_TOML, CASE_MD):
                extra.append(name)
            continue
        short = name[len(IMG_DIR) + 1 :]
        if "/" in short or short not in declared:
            extra.append(name)
        else:
            images[short] = data
    notes = [f"忽略了没有声明的文件：{'、'.join(sorted(extra))}"] if extra else []
    for name, asset_id in declared.items():
        if not name:
            notes.append(f"图片 {asset_id} 没有 file（只有声明，没有字节）")
        elif name not in images:
            notes.append(f"缺图片字节：{name}（声明在 {asset_id}）")
    return images, notes


def _prose_notes(prose: Mapping[str, Any], content: Mapping[str, Any]) -> list[str]:
    """散文与人物对不上的地方（不影响导入，说一声）。"""
    actors = [item for item in content["actors"] if isinstance(item, dict)]
    ids = {str(actor.get("id")) for actor in actors}
    notes = [
        f"人物 {actor.get('id')} 在 {CASE_MD} 里没有段落（persona 为空）"
        for actor in actors
        if not actor.get("persona")
    ]
    notes += [f"{CASE_MD} 里的 {name} 不在病例人物里（已忽略）" for name in sorted(set(prose["personas"]) - ids)]
    return notes


def parse_files(files: Mapping[str, bytes]) -> ParsedCase:
    """一堆文件（zip 解出来的、或前端按相对路径传上来的）→ 内容 + 图片 + 提示。

    宽容：多出来的文件忽略并提示；没有 `case.md` 就当作散文全空；`case.toml` 是必须的。
    """
    inside, notes = _inside_root(files)
    doc = parse_toml(_toml_text(inside))
    notes.extend(_unknown_keys(doc))
    if CASE_MD in inside:
        prose, md_notes = parse_md(inside[CASE_MD].decode("utf-8", errors="replace"))
        notes.extend(md_notes)
    else:
        prose = {"brief": "", "personas": {}, "truth": [], "teacher_notes": ""}
        notes.append(f"没有 {CASE_MD}：散文（处境 / 人物 / 真相 / 教师备注）按空处理")
    content = _content(doc, prose)
    key = content.get("key")
    if isinstance(key, str) and key:
        # `key` 就是文件夹名（也是导出压缩包的根目录名）：不能当文件名的 key 不是这份格式的内容
        safe_name(key, what=f"{CASE_TOML} 里的 key")
    images, image_notes = _case_images(inside, content)
    notes.extend(image_notes)
    notes.extend(_prose_notes(prose, content))
    return ParsedCase(content=content, images=images, notes=notes)


def read_folder(root: pathlib.Path) -> ParsedCase:
    files: dict[str, bytes] = {}
    for path in sorted(root.rglob("*")):
        if path.is_file():
            files[path.relative_to(root).as_posix()] = path.read_bytes()
    return parse_files(files)


def write_folder(root: pathlib.Path, pack: ScenarioPack, images: Mapping[str, bytes] = {}) -> None:
    """把病例写到磁盘（目录结构就是文件集合本身）。"""
    for name, data in case_files(pack, images).items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def images_of(key: str) -> dict[str, bytes]:
    """仓库里这个病例的 `img/`（播种来源）；没有这个文件夹就是空。"""
    root = CASES_DIR / key / IMG_DIR
    if not root.is_dir():
        return {}
    return {path.name: path.read_bytes() for path in sorted(root.iterdir()) if path.is_file()}


def case_keys() -> list[str]:
    """仓库里的病例 key（按目录名）。"""
    if not CASES_DIR.is_dir():
        return []
    return sorted(path.name for path in CASES_DIR.iterdir() if (path / CASE_TOML).is_file())


def read_case(name: str) -> ParsedCase:
    """按 key 或目录名读仓库里的病例（`sputum-ineffective` 与 `sputum_ineffective` 都能命中）。"""
    candidates = [name, name.replace("-", "_"), name.replace("_", "-")]
    for candidate in candidates:
        root = CASES_DIR / candidate
        if (root / CASE_TOML).is_file():
            parsed = read_folder(root)
            if parsed.content.get("key") != candidate:
                parsed.notes.append(
                    f"目录名 {candidate} 与 case.toml 里的 key={parsed.content.get('key')} 不同（以 TOML 为准）"
                )
            return parsed
    raise CaseFolderError(f"找不到病例文件夹：{name}（尝试过 {candidates}）")


# --------------------------------------------------------------------------- #
# zip 收发（标准模板下载 / 导入 / 导出共用）
# --------------------------------------------------------------------------- #


def zip_bytes(files: Mapping[str, bytes], *, root: str = "") -> bytes:
    """文件集合 → zip 字节（成员名带病例根目录；时间戳固定，同样的输入产出同样的字节）。"""
    if root:
        safe_name(root.rstrip("/"), what="压缩包的根目录")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(files):
            info = zipfile.ZipInfo(f"{root}{name}", date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, files[name])
    return buffer.getvalue()


def unzip_files(data: bytes) -> dict[str, bytes]:
    """zip 字节 → 文件集合（条目数、解压总量、成员路径三重校验）。"""
    if len(data) > MAX_ZIP_BYTES:
        raise CaseFolderError(f"压缩包过大：{len(data)} 字节（上限 {MAX_ZIP_BYTES}）")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise CaseFolderError(f"不是合法的 zip：{exc}") from exc
    with archive:
        entries = [item for item in archive.infolist() if not item.is_dir()]
        if len(entries) > MAX_ZIP_FILES:
            raise CaseFolderError(f"压缩包条目过多：{len(entries)}（上限 {MAX_ZIP_FILES}）")
        total = sum(item.file_size for item in entries)
        if total > MAX_ZIP_BYTES:
            raise CaseFolderError(f"解压后过大：{total} 字节（上限 {MAX_ZIP_BYTES}）")
        return {safe_member(item.filename): archive.read(item) for item in entries}
