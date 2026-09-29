"""病例文件夹（`cases/<key>/{case.toml,case.md,img/}`）：**无损**往返 + 宽容导入 + zip 防护。

两条往返断言拿仓库里的**真实病例**当夹具（病例改了也照样跑）：
- `folders → pack → folders`：文本逐字节相同（磁盘上那一份就是导出器写出来的那一份）；
- `pack → folders → pack`：模型深相等（含图片字节原样进出）。

再加一条逐字段覆盖：任何一个 `ScenarioPack` 字段被换掉，导出文本都必须跟着变、读回来必须一模一样
——哪天给模型加了字段却忘了写进 `case_folder`，这条当场就红。
"""

from __future__ import annotations

import zipfile

import pytest
from pydantic_core import PydanticUndefined

from modules.scenario_training import case_folder as cf
from modules.scenario_training import standard_case as sc
from modules.scenario_training.pack_loader import load_case, pack_from_content
from modules.scenario_training.schema import ScenarioPack, Trigger

CASES = cf.case_keys()


def _disk(key: str) -> dict[str, bytes]:
    root = cf.CASES_DIR / key
    return {path.relative_to(root).as_posix(): path.read_bytes() for path in sorted(root.rglob("*")) if path.is_file()}


def test_repo_holds_the_five_cases() -> None:
    assert CASES == [
        "bp-contradiction",
        "night-call-decision",
        "sputum-ineffective",
        "triage-hidden-bleed",
        "two-beds-priority",
    ]


@pytest.mark.parametrize("key", CASES)
def test_folders_to_pack_to_folders_is_byte_identical(key: str) -> None:
    case = cf.read_case(key)
    pack = pack_from_content(case.content)
    assert case.notes == []
    assert cf.case_files(pack, case.images) == _disk(key)


@pytest.mark.parametrize("key", CASES)
def test_pack_to_folders_to_pack_is_equal(key: str) -> None:
    pack, images = load_case(key)
    parsed = cf.parse_files(cf.case_files(pack, images))
    assert pack_from_content(parsed.content) == pack
    assert parsed.images == images  # 图片字节原样（不重编码）
    assert parsed.notes == []


@pytest.mark.parametrize("key", CASES)
def test_five_cases_validate(key: str) -> None:
    """五个病例从文件夹加载 + 加载期校验：5/5 通过（校验只有一套）。"""
    pack, _images = load_case(key)
    assert pack.key == key


def _variant(pack: ScenarioPack, name: str) -> ScenarioPack:
    """换掉一个字段：可选字段清空、必填字段换成另一个合法的值。"""
    if name == "key":
        return pack.model_copy(update={"key": "another-key"})
    if name == "title":
        return pack.model_copy(update={"title": f"{pack.title}（改）"})
    if name == "player":
        return pack.model_copy(update={"player": pack.player.model_copy(update={"role": f"{pack.player.role}乙"})})
    if name == "setting":
        return pack.model_copy(update={"setting": pack.setting.model_copy(update={"place": f"{pack.setting.place}乙"})})
    if name == "actors":
        first = pack.actors[0].model_copy(update={"role": f"{pack.actors[0].role}乙"})
        return pack.model_copy(update={"actors": [first, *pack.actors[1:]]})
    if name == "affordances":
        first = pack.affordances[0].model_copy(update={"label": f"{pack.affordances[0].label}乙"})
        return pack.model_copy(update={"affordances": [first, *pack.affordances[1:]]})
    if name == "failure":
        return pack.model_copy(update={"failure": "recoverable", "failure_when": None})
    if name == "failure_when":
        assert pack.failure_when is not None
        clause = pack.failure_when.all[0].model_copy(update={"value": 0})
        return pack.model_copy(update={"failure_when": Trigger(all=[clause])})
    if name == "state_keys":
        # 状态键被引用得很密，清空会连带把别的字段判成坏包 → 加一个（unreferenced 的键是合法的）
        return pack.model_copy(update={"state_keys": {**pack.state_keys, "scene.extra": 0}})
    default = ScenarioPack.model_fields[name].get_default(call_default_factory=True)
    assert default is not PydanticUndefined, f"{name} 没有默认值，请在这里给它写一个变体"
    return pack.model_copy(update={name: default})


@pytest.mark.parametrize("name", sorted(ScenarioPack.model_fields))
def test_every_field_lands_in_the_folder(name: str) -> None:
    """逐个字段：改动它必须改变导出文本，并且读回来一模一样（覆盖 = 导出与导入两侧都有落点）。

    基线用真实病例，只把 `teacher_notes` 填成非空——不然"改动"没处可改（病例里它本来就是空的）。
    """
    pack, images = load_case("sputum-ineffective")
    pack = pack.model_copy(update={"teacher_notes": "（写给自己与同事的话）"})
    variant = _variant(pack, name)
    assert cf.case_files(variant, images) != cf.case_files(pack, images)
    assert pack_from_content(cf.parse_files(cf.case_files(variant, images)).content) == variant


def test_standard_template_parses_and_installs_like_content() -> None:
    """标准模板是可导入的：解析 → 校验 → key/title 预填生效，且下载与新建同源。"""
    files = sc.files("tpl-case", "模板病例")
    parsed = cf.parse_files(files)
    assert parsed.notes == []
    pack = pack_from_content(parsed.content)
    assert (pack.key, pack.title) == ("tpl-case", "模板病例")
    assert pack.affordances
    assert pack.setting.cues
    assert pack.actors
    assert sc.content("tpl-case", "模板病例") == parsed.content


def test_import_tolerates_extra_files_and_absent_md() -> None:
    """宽容导入：多余的忽略并提示；没有 case.md 就当作散文全空（病例照样能用）。"""
    files = sc.files("tpl-case", "模板病例")
    files.pop(cf.CASE_MD)
    files["README.txt"] = "作者的备注".encode()
    files["img/orphan.png"] = b"\x89PNG orphan"
    parsed = cf.parse_files(files)
    pack = pack_from_content(parsed.content)
    assert pack.brief == ""
    assert pack.truth == []
    assert pack.teacher_notes == ""
    assert pack.actors[0].persona == ""
    assert any("没有 case.md" in note for note in parsed.notes)
    assert any("README.txt" in note and "orphan.png" in note for note in parsed.notes)


def test_import_reports_unknown_keys_without_failing() -> None:
    files = sc.files("tpl-case", "模板病例")
    files[cf.CASE_TOML] = files[cf.CASE_TOML].replace(b"[player]", 'titlle = "拼错的键"\n\n[player]'.encode())
    parsed = cf.parse_files(files)
    assert pack_from_content(parsed.content).key == "tpl-case"
    assert any("titlle" in note for note in parsed.notes)


def test_broken_toml_says_why() -> None:
    files = sc.files("tpl-case", "模板病例")
    files[cf.CASE_TOML] = b'key = "x"\ntitle = "y\n'
    with pytest.raises(cf.CaseFolderError) as exc:
        cf.parse_files(files)
    assert "case.toml 解析失败" in str(exc.value)


def test_missing_case_toml_is_refused() -> None:
    with pytest.raises(cf.CaseFolderError, match=r"没有找到 case\.toml"):
        cf.parse_files({"case.md": b"## \xe5\xa4\x84\xe5\xa2\x83\n"})


def test_zip_roundtrip_keeps_content_and_image_bytes() -> None:
    pack, images = load_case("sputum-ineffective")
    data = cf.zip_bytes(cf.case_files(pack, images), root=f"{pack.key}/")
    parsed = cf.parse_files(cf.unzip_files(data))
    assert pack_from_content(parsed.content) == pack
    assert parsed.notes == []
    assert parsed.images["room-panel.png"] == _disk(pack.key)["img/room-panel.png"]


def test_zip_slip_and_limits_are_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    buffer = __import__("io").BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("../evil/case.toml", b'key = "x"\ntitle = "x"\n')
    with pytest.raises(cf.CaseFolderError, match="路径不安全"):
        cf.unzip_files(buffer.getvalue())

    good = cf.zip_bytes(sc.files("tpl-case", "模板病例"), root="tpl-case/")
    monkeypatch.setattr(cf, "MAX_ZIP_FILES", 1)
    with pytest.raises(cf.CaseFolderError, match="条目过多"):
        cf.unzip_files(good)
    monkeypatch.setattr(cf, "MAX_ZIP_FILES", 64)
    monkeypatch.setattr(cf, "MAX_ZIP_BYTES", 16)
    with pytest.raises(cf.CaseFolderError, match="压缩包过大"):
        cf.unzip_files(good)


def test_asset_file_name_cannot_escape_the_folder() -> None:
    pack, _images = load_case("sputum-ineffective")
    broken = pack.model_copy(update={"assets": [pack.assets[0].model_copy(update={"file": "../secret.png"})]})
    with pytest.raises(cf.CaseFolderError, match="不能用作文件名"):
        cf.case_files(broken, {"../secret.png": b"x"})


def test_bad_key_is_refused_at_the_folder_boundary() -> None:
    """`key` 就是文件夹名：能爬出文件夹的 key 不是这份格式的内容。"""
    files = sc.files("tpl-case", "模板病例")
    files[cf.CASE_TOML] = files[cf.CASE_TOML].replace(b'"tpl-case"', b'"../evil"')
    with pytest.raises(cf.CaseFolderError, match=r"case\.toml 里的 key"):
        cf.parse_files(files)


def test_truth_items_must_stay_single_paragraph() -> None:
    """真相按空行分段：一条里有空行就没法无损读回来——导出时直接说清楚，不悄悄改词表。"""
    pack, images = load_case("sputum-ineffective")
    broken = pack.model_copy(update={"truth": ["第一段\n\n第二段"]})
    with pytest.raises(cf.CaseFolderError, match="真相的一条必须是一段"):
        cf.case_files(broken, images)
