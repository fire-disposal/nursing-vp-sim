"""Unit tests for the permission vocabulary and system role mapping."""

from core.permissions import PERMISSION_KEYS, PERMISSION_LABELS, PERMISSIONS, PermissionDef
from core.roles import SYSTEM_PERMISSIONS, SYSTEM_ROLES


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


class TestSystemPermissions:
    def test_super_admin_has_all_permissions(self):
        assert set(PERMISSION_KEYS) == set(SYSTEM_PERMISSIONS["super_admin"])

    def test_every_role_perm_is_defined(self):
        defined = set(PERMISSION_KEYS)
        for role, perms in SYSTEM_PERMISSIONS.items():
            assert set(perms) <= defined, f"{role} 引用了未定义权限"

    def test_roles_are_disjoint_subsets(self):
        # 权限分层：student ⊂ teacher ⊂ admin ⊂ super_admin
        student = set(SYSTEM_PERMISSIONS["student"])
        teacher = set(SYSTEM_PERMISSIONS["teacher"])
        admin = set(SYSTEM_PERMISSIONS["admin"])
        assert student <= teacher <= admin

    def test_student_has_minimal_permissions(self):
        assert SYSTEM_PERMISSIONS["student"] == ["training_access", "qa_access"]

    def test_system_roles_pairs(self):
        labels = dict(SYSTEM_ROLES)
        assert set(labels) == set(SYSTEM_PERMISSIONS)
        assert labels["student"] == "学生"
        assert labels["super_admin"] == "超级管理员"
