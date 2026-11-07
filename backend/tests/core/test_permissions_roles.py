"""权限词表 / 视角预设的关系。

自「视角 = 权限预设」起：
- 权限只来自 `core/personas.py` 的预设；
- 角色已整体退场（无角色表、无角色列）：用户持有的是**视角授予**，平台身份是 `is_platform`。
"""

from core.permissions import PERMISSION_KEYS, PERMISSION_LABELS, PERMISSIONS, PermissionDef
from core.personas import PERSONA_KEYS, PERSONAS, persona_permissions


class TestPermissionDef:
    def test_all_defs_have_key_and_label(self):
        for p in PERMISSIONS:
            assert isinstance(p, PermissionDef)
            assert p.key
            assert p.label

    def test_keys_unique(self):
        keys = [p.key for p in PERMISSIONS]
        assert len(keys) == len(set(keys))

    def test_perm_keys_match_defs_order(self):
        assert tuple(p.key for p in PERMISSIONS) == PERMISSION_KEYS

    def test_labels_index_correctly(self):
        for p in PERMISSIONS:
            assert PERMISSION_LABELS[p.key] == p.label


class TestPersonaPresets:
    def test_every_persona_perm_is_defined(self):
        defined = set(PERMISSION_KEYS)
        for key, persona in PERSONAS.items():
            assert set(persona.permissions) <= defined, f"{key} 引用了未定义权限"

    def test_personas_are_nested_subset(self):
        # 权限分层：student ⊆ teacher ⊆ admin；ops 是并行的运维集合
        student = set(PERSONAS["student"].permissions)
        teacher = set(PERSONAS["teacher"].permissions)
        admin = set(PERSONAS["admin"].permissions)
        assert student <= teacher <= admin

    def test_student_has_minimal_permissions(self):
        assert set(PERSONAS["student"].permissions) == {"training_access", "scenario_training", "qa_access"}

    def test_persona_scope_is_declared_and_known(self):
        assert {key: persona.scope for key, persona in PERSONAS.items()} == {
            "student": "self",
            "teacher": "class",
            "admin": "tenant",
            "ops": "tenant",
            "platform": "platform",
        }

    def test_permissions_only_come_from_personas(self):
        """角色退场后唯一的权限来源：视角预设（未知视角 → 空集，不回落到任何角色）。"""
        assert persona_permissions("teacher") == frozenset(PERSONAS["teacher"].permissions)
        assert persona_permissions("admin") == frozenset(PERSONAS["admin"].permissions)
        assert persona_permissions("nurse_lead") == frozenset()
        assert persona_permissions(None) == frozenset()
        # 视角 key 里不再有"角色"这种身份（没有 super_admin）
        assert "super_admin" not in PERSONA_KEYS
