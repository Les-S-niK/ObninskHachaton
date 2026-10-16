from fastapi import FastAPI
from uvicorn import run

from app.config import AppSettings

app: FastAPI = FastAPI()


def main() -> None:
    run(
        "app.main:app",
        host=AppSettings.HOST,
        port=AppSettings.PORT,
        reload=AppSettings.DEBUG,
    )


if __name__ == "__main__":
    main()
