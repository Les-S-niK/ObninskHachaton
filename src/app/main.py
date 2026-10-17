from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from uvicorn import run

from app.config import AppSettings

from .models import (
    CompareResponse,
    LiveIntervention,
    SessionState,
    SimulateRequest,
    SimulateResponse,
)
from .service import (
    SimulationFinishedError,
    SimulationSession,
    compare_scenarios,
    run_simulation,
    store,
)

app = FastAPI(debug=AppSettings.DEBUG)

app.add_middleware(
    CORSMiddleware,
    allow_origins=AppSettings.CORS.ALLOW_ORIGINS,
    allow_credentials=AppSettings.CORS.ALLOW_CREDENTIALS,
    allow_methods=AppSettings.CORS.ALLOW_METHODS,
    allow_headers=AppSettings.CORS.ALLOW_HEADERS,
)

STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/", response_class=FileResponse)
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/api/simulate/", response_model=SimulateResponse)
def simulate(payload: SimulateRequest) -> SimulateResponse:
    try:
        data = run_simulation(
            rows=payload.rows,
            cols=payload.cols,
            initial_infected=payload.initial_infected,
            days=payload.days,
            seed=payload.seed,
            disease=payload.disease.model_dump(),
            interventions=[item.model_dump() for item in payload.interventions],
        )
    except ValueError as exc:
        raise _bad_request(exc) from exc
    return SimulateResponse.model_validate(data)


@app.post("/api/compare/", response_model=CompareResponse)
def compare(payload: SimulateRequest) -> CompareResponse:
    try:
        data = compare_scenarios(
            rows=payload.rows,
            cols=payload.cols,
            initial_infected=payload.initial_infected,
            days=payload.days,
            seed=payload.seed,
            disease=payload.disease.model_dump(),
            interventions=[item.model_dump() for item in payload.interventions],
        )
    except ValueError as exc:
        raise _bad_request(exc) from exc
    return CompareResponse.model_validate(data)


def _get_session_or_404(scenario_id: str) -> SimulationSession:
    session = store.get(scenario_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Сессия не найдена или истекла")
    return session


def _bad_request(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


@app.post("/api/session/", response_model=SessionState)
def create_session(payload: SimulateRequest) -> SessionState:
    try:
        session = SimulationSession(
            rows=payload.rows,
            cols=payload.cols,
            initial_infected=payload.initial_infected,
            days=payload.days,
            seed=payload.seed,
            disease=payload.disease.model_dump(),
            interventions=[item.model_dump() for item in payload.interventions],
        )
    except ValueError as exc:
        raise _bad_request(exc) from exc
    store.create(session)
    return SessionState.model_validate(session.to_session_state())


@app.get("/api/session/{scenario_id}", response_model=SessionState)
def get_session(scenario_id: str) -> SessionState:
    session = _get_session_or_404(scenario_id)
    return SessionState.model_validate(session.to_session_state())


@app.post("/api/session/{scenario_id}/step", response_model=SessionState)
def step_session(scenario_id: str) -> SessionState:
    session = _get_session_or_404(scenario_id)
    try:
        session.step()
    except SimulationFinishedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return SessionState.model_validate(session.to_session_state())


@app.post("/api/session/{scenario_id}/intervene", response_model=SessionState)
def intervene_session(scenario_id: str, action: LiveIntervention) -> SessionState:
    session = _get_session_or_404(scenario_id)
    if session.finished:
        raise HTTPException(status_code=409, detail="Симуляция уже завершена")

    if action.type == "remove_cell":
        try:
            session.intervene_remove(action.coord, action.cost_per_plant)
        except ValueError as exc:
            raise _bad_request(exc) from exc
    else:  # isolate_zone
        try:
            session.intervene_isolate(
                action.center, action.radius, action.cost_per_cell
            )
        except ValueError as exc:
            raise _bad_request(exc) from exc

    return SessionState.model_validate(session.to_session_state())


@app.delete("/api/session/{scenario_id}", status_code=204)
def delete_session(scenario_id: str) -> None:
    store.delete(scenario_id)


def main() -> None:
    run(
        "app.main:app",
        host=AppSettings.HOST,
        port=AppSettings.PORT,
        reload=AppSettings.DEBUG,
    )


if __name__ == "__main__":
    main()
