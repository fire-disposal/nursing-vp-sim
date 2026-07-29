"""Auth API tests: login, register, token validation, role-based access."""


class TestLogin:
    def test_login_success(self, client, db_session):
        from core.security import hash_password
        from models import Role, User

        student_role = db_session.query(Role).filter(Role.name == "student").first()
        user = User(
            username="testuser",
            password_hash=hash_password("pass123"),
            role_id=student_role.id,
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
        from models import Role, User

        student_role = db_session.query(Role).filter(Role.name == "student").first()
        user = User(
            username="testuser2",
            password_hash=hash_password("pass123"),
            role_id=student_role.id,
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
        from models import Role, User

        _, token = teacher

        student_role = db_session.query(Role).filter(Role.name == "student").first()
        db_session.add(
            User(
                username="dup",
                password_hash=hash_password("x"),
                role_id=student_role.id,
                display_name="Dup",
            )
        )
        db_session.commit()

        resp = client.post(
            "/api/auth/register",
            json={"username": "dup", "password": "123456", "role": "student", "display_name": "Dup2"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 409

    def test_register_duplicate_race_returns_409(self, client, teacher, db_session, engine):
        import threading

        from sqlalchemy.orm import sessionmaker

        from core.exceptions import ConflictError
        from models import Role, User
        from modules.auth.service import AuthService
        from schemas import RegisterRequest

        results = []
        barrier = threading.Barrier(2)

        def do_register():
            SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
            session = SessionLocal()
            try:
                teacher_user = session.query(User).join(User.role).filter(Role.name == "teacher").first()
                svc = AuthService(session)
                req = RegisterRequest(
                    username="conc_dup",
                    password="123456",
                    role="student",
                    display_name="Conc",
                )
                barrier.wait()
                try:
                    svc.register(req, teacher_user)
                    results.append("ok")
                except ConflictError:
                    results.append("conflict")
                except Exception:
                    results.append("error")
            finally:
                session.rollback()
                session.close()

        t1 = threading.Thread(target=do_register)
        t2 = threading.Thread(target=do_register)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        assert "ok" in results, f"Expected one success, got {results}"
        assert "error" not in results, f"Expected no raw IntegrityError (500), got {results}"

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


class TestDisabledUserLogin:
    def test_disabled_user_login_returns_403(self, client, db_session):
        from core.security import hash_password
        from models import Role, User

        student_role = db_session.query(Role).filter(Role.name == "student").first()
        user = User(
            username="disableduser",
            password_hash=hash_password("pass123"),
            role_id=student_role.id,
            display_name="禁用用户",
            is_active=False,
        )
        db_session.add(user)
        db_session.commit()

        resp = client.post("/api/auth/login", json={"username": "disableduser", "password": "pass123"})
        assert resp.status_code == 403
        detail = resp.json()["detail"]
        assert "禁用" in detail

    def test_active_user_login_still_works(self, client, db_session):
        from core.security import hash_password
        from models import Role, User

        student_role = db_session.query(Role).filter(Role.name == "student").first()
        user = User(
            username="activeuser",
            password_hash=hash_password("pass123"),
            role_id=student_role.id,
            display_name="正常用户",
            is_active=True,
        )
        db_session.add(user)
        db_session.commit()

        resp = client.post("/api/auth/login", json={"username": "activeuser", "password": "pass123"})
        assert resp.status_code == 200


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
