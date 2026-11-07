"""权限词表 / 视角预设 / 账号类型的关系。

自「视角 = 权限预设」起：
- 权限只来自 `core/personas.py` 的预设；
- 角色（账号类型）只决定默认视角与展示，不再携带权限。
"""

from core.permissions import PERMISSION_KEYS, PERMISSION_LABELS, PERMISSIONS, PermissionDef
from core.personas import DEFAULT_PERSONA_BY_ROLE, PERSONAS, permissions_for_role_name
from core.roles import SYSTEM_ROLES


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

    def test_system_roles_are_account_types_only(self):
        labels = dict(SYSTEM_ROLES)
        assert set(labels) == {"student", "teacher", "admin", "super_admin"}
        assert labels["student"] == "学生"
        assert labels["super_admin"] == "超级管理员"
        # 角色不再携带权限：唯一相关是"默认视角"
        assert set(DEFAULT_PERSONA_BY_ROLE) == set(labels)

    def test_role_default_permissions_come_from_personas(self):
        assert permissions_for_role_name("teacher") == frozenset(PERSONAS["teacher"].permissions)
        assert permissions_for_role_name("super_admin") == frozenset(PERMISSION_KEYS)
        assert permissions_for_role_name("custom") == frozenset()
