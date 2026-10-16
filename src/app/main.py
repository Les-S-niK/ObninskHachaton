from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from uvicorn import run

from app.config import AppSettings

from .models import CompareResponse, SimulateRequest, SimulateResponse
from .service import compare_scenarios, run_simulation

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
    data = run_simulation(
        rows=payload.rows,
        cols=payload.cols,
        initial_infected=payload.initial_infected,
        days=payload.days,
        seed=payload.seed,
        disease=payload.disease.model_dump(),
        interventions=[item.model_dump() for item in payload.interventions],
    )
    return SimulateResponse.model_validate(data)


@app.post("/api/compare/", response_model=CompareResponse)
async def compare(payload: SimulateRequest) -> CompareResponse:
    data = compare_scenarios(
        rows=payload.rows,
        cols=payload.cols,
        initial_infected=payload.initial_infected,
        days=payload.days,
        seed=payload.seed,
        disease=payload.disease.model_dump(),
        interventions=[item.model_dump() for item in payload.interventions],
    )
    return CompareResponse.model_validate(data)


def main() -> None:
    run(
        "app.main:app",
        host=AppSettings.HOST,
        port=AppSettings.PORT,
        reload=AppSettings.DEBUG,
    )


if __name__ == "__main__":
    main()
