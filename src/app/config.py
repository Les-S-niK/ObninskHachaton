from dataclasses import dataclass
from typing import ClassVar


@dataclass
class AppSettings:
    HOST: ClassVar[str] = "0.0.0.0"
    PORT: ClassVar[int] = 80
    DEBUG: ClassVar[bool] = True

    class CORS:
        ALLOW_ORIGINS: ClassVar[list[str]] = [
            "http://localhost",
            "http://127.0.0.1",
            "http://0.0.0.0",
            "http://0.0.0.0:80",
            "http://localhost:80",
            "http://localhost:8080",
        ]
        ALLOW_CREDENTIALS: ClassVar[bool] = True
        ALLOW_METHODS: ClassVar[list[str]] = ["*"]
        ALLOW_HEADERS: ClassVar[list[str]] = ["*"]
