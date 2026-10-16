from dataclasses import dataclass


@dataclass
class AppSettings:
    HOST: str = "127.0.0.1"
    PORT: int = 8080
    DEBUG: bool = True
