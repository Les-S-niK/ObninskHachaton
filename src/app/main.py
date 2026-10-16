from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from uvicorn import run

from app.config import AppSettings

from .models import SimulateRequest, SimulateResponse

app = FastAPI(debug=AppSettings.DEBUG)

app.add_middleware(
    CORSMiddleware,
    allow_origins=AppSettings.CORS.ALLOW_ORIGINS,
    allow_credentials=AppSettings.CORS.ALLOW_CREDENTIALS,
    allow_methods=AppSettings.CORS.ALLOW_METHODS,
    allow_headers=AppSettings.CORS.ALLOW_HEADERS,
)


@app.post("/api/simulate/", response_model=SimulateResponse)
async def simulate(payload: SimulateRequest) -> SimulateResponse:
    # TODO: вызвать сервис симуляции (payload -> SimulateResponse)
    raise HTTPException(status_code=501, detail="Not implemented")


def main() -> None:
    run(
        "app.main:app",
        host=AppSettings.HOST,
        port=AppSettings.PORT,
        reload=AppSettings.DEBUG,
    )


if __name__ == "__main__":
    main()
