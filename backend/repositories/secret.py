from models import ApiSecret
from repositories.base import Repository


class ApiSecretRepository(Repository[ApiSecret]):
    model = ApiSecret
