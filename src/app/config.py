from dataclasses import dataclass
from typing import ClassVar


@dataclass
class AppSettings:
    HOST: ClassVar[str] = "127.0.0.1"
    PORT: ClassVar[int] = 8080
    DEBUG: ClassVar[bool] = True

    class CORS:
        ALLOW_ORIGINS: ClassVar[list[str]] = [
            "http://localhost.tiangolo.com",
            "https://localhost.tiangolo.com",
            "http://localhost",
            "http://localhost:8080",
        ]
        ALLOW_CREDENTIALS: ClassVar[bool] = True
        ALLOW_METHODS: ClassVar[list[str]] = ["*"]
        ALLOW_HEADERS: ClassVar[list[str]] = ["*"]
