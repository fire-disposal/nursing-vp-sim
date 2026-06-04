"""Auth API tests: login, register, token validation, role-based access."""


class TestLogin:
    def test_login_success(self, client, db_session):
        from core.security import hash_password
        from models import User

        user = User(
            username="testuser",
            password_hash=hash_password("pass123"),
            role="student",
            display_name="测试",
        )
        db_session.add(user)
        db_session.commit()

        resp = client.post("/api/auth/login", json={"username": "testuser", "password": "pass123"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["access_token"]
        assert data["role"] == "student"
        assert data["display_name"] == "测试"

    def test_login_wrong_password(self, client, db_session):
        from core.security import hash_password
        from models import User

        user = User(
            username="testuser2",
            password_hash=hash_password("pass123"),
            role="student",
            display_name="测试",
        )
        db_session.add(user)
        db_session.commit()

        resp = client.post("/api/auth/login", json={"username": "testuser2", "password": "wrong"})
        assert resp.status_code == 401

    def test_login_user_not_found(self, client):
        resp = client.post("/api/auth/login", json={"username": "noone", "password": "x"})
        assert resp.status_code == 401


class TestRegister:
    def test_register_student(self, client, teacher):
        """Register requires teacher auth."""
        _, token = teacher
        resp = client.post(
            "/api/auth/register",
            json={
                "username": "newstudent",
                "password": "123456",
                "role": "student",
                "display_name": "新同学",
                "student_id": "20240099",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["role"] == "student"
        assert data["display_name"] == "新同学"

    def test_register_duplicate_username(self, client, teacher, db_session):
        from core.security import hash_password
        from models import User

        _, token = teacher

        db_session.add(User(username="dup", password_hash=hash_password("x"), role="student", display_name="Dup"))
        db_session.commit()

        resp = client.post(
            "/api/auth/register",
            json={"username": "dup", "password": "123456", "role": "student", "display_name": "Dup2"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 400

    def test_register_requires_teacher(self, client, student):
        """Student cannot register users."""
        _, token = student
        resp = client.post(
            "/api/auth/register",
            json={"username": "x", "password": "123456", "role": "student", "display_name": "X"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403

    def test_register_unauthenticated(self, client):
        resp = client.post(
            "/api/auth/register", json={"username": "x", "password": "x", "role": "student", "display_name": "X"}
        )
        assert resp.status_code == 401


class TestGetMe:
    def test_get_me_valid_token(self, client, student):
        _user, token = student
        resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.json()["username"] == "student1"

    def test_get_me_no_token(self, client):
        resp = client.get("/api/auth/me")
        assert resp.status_code == 401

    def test_get_me_invalid_token(self, client):
        resp = client.get("/api/auth/me", headers={"Authorization": "Bearer bad-token"})
        assert resp.status_code == 401


class TestWechatRegister:
    def test_wechat_register_creates_user(self, client, db_session, monkeypatch):
        """微信注册：code 有效时应创建新用户并返回 token"""
        async def mock_code2session(code):
            return {"openid": "test_openid_register_001"}

        from services import wechat as wechat_module
        monkeypatch.setattr(wechat_module, "code2session", mock_code2session)

        resp = client.post(
            "/api/auth/wechat/register",
            json={"code": "valid_code", "display_name": "微信用户"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["access_token"]
        assert data["role"] == "student"
        assert data["display_name"] == "微信用户"

        from models import User
        user = db_session.query(User).filter(User.wechat_openid == "test_openid_register_001").first()
        assert user is not None
        assert user.username.startswith("wx_")

    def test_wechat_register_duplicate_openid(self, client, db_session, monkeypatch):
        """微信注册：重复 openid 应返回 400"""
        from core.security import hash_password
        from models import User

        user = User(
            username="existing_wx_user",
            password_hash=hash_password("x"),
            role="student",
            display_name="已有用户",
            wechat_openid="dup_openid_002",
        )
        db_session.add(user)
        db_session.commit()

        async def mock_code2session(code):
            return {"openid": "dup_openid_002"}

        from services import wechat as wechat_module
        monkeypatch.setattr(wechat_module, "code2session", mock_code2session)

        resp = client.post(
            "/api/auth/wechat/register",
            json={"code": "dup_code", "display_name": "新用户"},
        )
        assert resp.status_code == 400
        assert "已注册" in str(resp.json().get("detail", ""))

    def test_wechat_register_empty_display_name(self, client):
        """微信注册：昵称为空应返回 422"""
        resp = client.post(
            "/api/auth/wechat/register",
            json={"code": "x", "display_name": ""},
        )
        assert resp.status_code == 422
