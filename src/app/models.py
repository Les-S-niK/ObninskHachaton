from enum import IntEnum
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class CellState(IntEnum):
    HEALTHY = 0
    INFECTED = 1
    RECOVERED = 2
    REMOVED = 3


Coord = Annotated[list[int], Field(min_length=2, max_length=2)]  # [row, col]
Grid = list[list[int]]  # rows x cols


class DiseaseParams(BaseModel):
    infection_prob: float = Field(..., ge=0, le=1)
    recovery_prob: float = Field(..., ge=0, le=1)
    removal_prob: float = Field(..., ge=0, le=1)

    @model_validator(mode="after")
    def check_probs_sum(self):
        if self.recovery_prob + self.removal_prob > 1:
            raise ValueError("recovery_prob + removal_prob must be <= 1")
        return self


class RemoveInfectedIntervention(BaseModel):
    type: Literal["remove_infected"]
    day: int = Field(..., ge=1)
    coord: Coord
    cost_per_plant: float = Field(..., ge=0)


class IsolateZoneIntervention(BaseModel):
    type: Literal["isolate_zone"]
    day: int = Field(..., ge=0)
    center: Coord
    radius: int = Field(..., ge=0)
    cost_per_cell: float = Field(..., ge=0)


Intervention = Annotated[
    RemoveInfectedIntervention | IsolateZoneIntervention,
    Field(discriminator="type"),
]


class SimulateRequest(BaseModel):
    rows: int = Field(..., ge=5, le=50)
    cols: int = Field(..., ge=5, le=50)
    initial_infected: list[Coord] = Field(..., min_length=1, max_length=5)
    days: int = Field(..., ge=1, le=100)
    seed: int
    disease: DiseaseParams
    interventions: list[Intervention] = Field(default_factory=list, max_length=200)

    @field_validator("initial_infected")
    @classmethod
    def unique_points(cls, v):
        pts = [tuple(p) for p in v]
        if len(set(pts)) != len(pts):
            raise ValueError("initial_infected contains duplicates")
        return v

    @model_validator(mode="after")
    def check_bounds_and_days(self):
        for r, c in self.initial_infected:
            if not (0 <= r < self.rows and 0 <= c < self.cols):
                raise ValueError(
                    f"initial_infected point [{r}, {c}] is out of grid bounds"
                )
        for iv in self.interventions:
            if iv.day > self.days:
                raise ValueError(f"intervention day {iv.day} exceeds days={self.days}")
            if isinstance(iv, RemoveInfectedIntervention):
                r, c = iv.coord
                if not (0 <= r < self.rows and 0 <= c < self.cols):
                    raise ValueError(
                        f"remove_infected coord [{r}, {c}] is out of grid bounds"
                    )
            elif isinstance(iv, IsolateZoneIntervention):
                r, c = iv.center
                if not (0 <= r < self.rows and 0 <= c < self.cols):
                    raise ValueError(
                        f"isolate_zone center [{r}, {c}] is out of grid bounds"
                    )
        return self


class AppliedRemoveInfected(BaseModel):
    type: Literal["remove_infected"]
    day: int
    removed_count: int
    coord: Coord
    cost: float


class AppliedIsolateZone(BaseModel):
    type: Literal["isolate_zone"]
    day: int
    center: Coord
    radius: int
    zone_size: int
    cost: float


AppliedIntervention = Annotated[
    AppliedRemoveInfected | AppliedIsolateZone,
    Field(discriminator="type"),
]


class Metrics(BaseModel):
    healthy: int
    infected: int
    recovered: int
    removed: int
    isolated: int
    cost: float


class Frame(BaseModel):
    day: int
    grid: Grid
    isolation_mask: Grid
    metrics: Metrics


class Summary(BaseModel):
    total_infected: int
    saved: int
    recovered: int
    removed: int
    cost: float
    loss: int
    peak_infected: int
    peak_day: int


class ComparisonEntry(BaseModel):
    baseline: float
    intervention: float
    change: float = Field(
        description="intervention - baseline. Отрицательное значение = снижение метрики."
    )


class CompareResponse(BaseModel):
    baseline: SimulateResponse
    intervention: SimulateResponse
    comparison: dict[str, ComparisonEntry]


class SimulateResponse(BaseModel):
    scenario_id: str
    seed: int
    rows: int
    cols: int
    days: int
    state_names: dict[str, str]
    applied_interventions: list[AppliedIntervention]
    frames: list[Frame]  # длина days + 1
    summary: Summary
