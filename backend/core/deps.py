"""Standard FastAPI dependency aliases for thin routers."""

from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user
from models import User

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
