from __future__ import annotations

import threading
import time
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import numpy as np

HEALTHY, INFECTED, RECOVERED, REMOVED = 0, 1, 2, 3
STATE_NAMES = {
    str(HEALTHY): "healthy",
    str(INFECTED): "infected",
    str(RECOVERED): "recovered",
    str(REMOVED): "removed",
}

DEFAULT_COST_PER_PLANT = 10.0
DEFAULT_COST_PER_CELL = 2.0
MAX_SCHEDULED_INTERVENTIONS = 100


class SimulationFinishedError(RuntimeError):
    """Попытка сделать шаг в уже завершённой симуляции."""


def create_initial_grid(
    rows: int,
    cols: int,
    initial_infected: list[list[int]] | list[tuple[int, int]],
) -> np.ndarray:
    """Создать здоровую сетку и разместить начальные очаги заражения."""
    if rows < 10 or cols < 10:
        raise ValueError("Размер сетки должен быть не меньше 10 × 10.")
    if not 1 <= len(initial_infected) <= 3:
        raise ValueError("Нужно указать от 1 до 3 начальных очагов заражения.")

    grid = np.full((rows, cols), HEALTHY, dtype=np.uint8)
    seen: set[tuple[int, int]] = set()
    for coordinate in initial_infected:
        if len(coordinate) != 2:
            raise ValueError("Координата очага должна содержать row и col.")
        row, col = int(coordinate[0]), int(coordinate[1])
        if not (0 <= row < rows and 0 <= col < cols):
            raise ValueError(f"Координата ({row}, {col}) выходит за границы сетки.")
        if (row, col) in seen:
            raise ValueError(f"Координата ({row}, {col}) указана дважды.")
        seen.add((row, col))
        grid[row, col] = INFECTED
    return grid


def build_isolation_mask(
    rows: int,
    cols: int,
    center: list[int] | tuple[int, int],
    radius: int,
) -> np.ndarray:
    """Вернуть маску круглой зоны; клетки за пределами сетки не создаются."""
    center_row, center_col = int(center[0]), int(center[1])
    if not (0 <= center_row < rows and 0 <= center_col < cols):
        raise ValueError("Центр изоляции находится за границами сетки.")
    if radius < 0:
        raise ValueError("Радиус изоляции не может быть отрицательным.")

    row_coords, col_coords = np.ogrid[:rows, :cols]
    distance_squared = (row_coords - center_row) ** 2 + (col_coords - center_col) ** 2
    return distance_squared <= radius**2


def count_infected_neighbors(
    grid: np.ndarray, isolation_mask: np.ndarray | None = None
) -> np.ndarray:
    """Посчитать заражённых соседей Мура без перехода через края сетки.

    Если задана маска изоляции, заражение не проходит между клетками,
    одна из которых находится внутри изоляции, а другая снаружи.
    """
    infected = grid == INFECTED
    rows, cols = grid.shape
    if isolation_mask is None:
        isolation_mask = np.zeros((rows, cols), dtype=bool)
    else:
        isolation_mask = isolation_mask.astype(bool, copy=False)

    counts = np.zeros((rows, cols), dtype=np.uint8)

    shifts = (
        ((slice(1, None), slice(None)), (slice(None, -1), slice(None))),  # сверху
        ((slice(None, -1), slice(None)), (slice(1, None), slice(None))),  # снизу
        ((slice(None), slice(1, None)), (slice(None), slice(None, -1))),  # слева
        ((slice(None), slice(None, -1)), (slice(None), slice(1, None))),  # справа
        ((slice(1, None), slice(1, None)), (slice(None, -1), slice(None, -1))),  # СЗ
        ((slice(1, None), slice(None, -1)), (slice(None, -1), slice(1, None))),  # СВ
        ((slice(None, -1), slice(1, None)), (slice(1, None), slice(None, -1))),  # ЮЗ
        ((slice(None, -1), slice(None, -1)), (slice(1, None), slice(1, None))),  # ЮВ
    )

    for target_slices, source_slices in shifts:
        same_side = isolation_mask[target_slices] == isolation_mask[source_slices]
        contributing = infected[source_slices] & same_side
        counts[target_slices] += contributing.astype(np.uint8)

    return counts


def calculate_metrics(
    grid: np.ndarray,
    isolation_mask: np.ndarray,
    cumulative_cost: float,
) -> dict[str, int | float]:
    """Посчитать статистику одного кадра."""
    return {
        "healthy": int(np.count_nonzero(grid == HEALTHY)),
        "infected": int(np.count_nonzero(grid == INFECTED)),
        "recovered": int(np.count_nonzero(grid == RECOVERED)),
        "removed": int(np.count_nonzero(grid == REMOVED)),
        "isolated": int(np.count_nonzero(isolation_mask)),
        "cost": float(cumulative_cost),
    }


def _make_frame(
    day: int,
    grid: np.ndarray,
    isolation_mask: np.ndarray,
    cumulative_cost: float,
) -> dict[str, Any]:
    return {
        "day": day,
        "grid": grid.astype(int).tolist(),
        "isolation_mask": isolation_mask.astype(np.uint8).tolist(),
        "metrics": calculate_metrics(grid, isolation_mask, cumulative_cost),
    }


def _normalize_disease(disease: dict[str, Any]) -> tuple[float, float, float]:
    infection_prob = float(disease.get("infection_prob", 0.15))
    recovery_prob = float(disease.get("recovery_prob", 0.05))
    removal_prob = float(disease.get("removal_prob", 0.03))
    for name, value in (
        ("infection_prob", infection_prob),
        ("recovery_prob", recovery_prob),
        ("removal_prob", removal_prob),
    ):
        if not 0.0 <= value <= 1.0:
            raise ValueError(f"{name} должен находиться в диапазоне от 0 до 1.")
    if recovery_prob + removal_prob > 1.0:
        raise ValueError("recovery_prob + removal_prob не может быть больше 1.")
    return infection_prob, recovery_prob, removal_prob


def _validate_interventions(
    interventions: list[dict[str, Any]], rows: int, cols: int, days: int
) -> list[dict[str, Any]]:
    """Нормализовать плановые вмешательства (batch/compare).

    Удаление трактуется как удаление ОДНОЙ клетки по coord.
    """
    if len(interventions) > MAX_SCHEDULED_INTERVENTIONS:
        raise ValueError(
            f"Допускается не более {MAX_SCHEDULED_INTERVENTIONS} вмешательств."
        )

    normalized: list[dict[str, Any]] = []
    for index, original in enumerate(interventions):
        intervention = dict(original)
        kind = intervention.get("type")
        day = int(intervention.get("day", 0))
        if not 0 <= day <= days:
            raise ValueError(
                f"Вмешательство #{index + 1}: day должен быть от 0 до {days}."
            )
        intervention["day"] = day

        if kind == "remove_infected":
            center = intervention.get("coord")
            if not isinstance(center, (list, tuple)) or len(center) != 2:
                raise ValueError(
                    f"Вмешательство #{index + 1}: для remove_infected нужен coord: [row, col]."
                )
            center_row, center_col = int(center[0]), int(center[1])
            if not (0 <= center_row < rows and 0 <= center_col < cols):
                raise ValueError(
                    f"Вмешательство #{index + 1}: coord [{center_row}, {center_col}] "
                    "выходит за границы сетки."
                )
            cost = float(intervention.get("cost_per_plant", DEFAULT_COST_PER_PLANT))
            if cost < 0:
                raise ValueError("cost_per_plant не может быть отрицательным.")
            intervention["coord"] = [center_row, center_col]
            intervention["cost_per_plant"] = cost
        elif kind == "isolate_zone":
            center = intervention.get("center")
            if not isinstance(center, (list, tuple)) or len(center) != 2:
                raise ValueError(
                    f"Вмешательство #{index + 1}: для isolate_zone нужно указать center: [row, col]."
                )
            center_row, center_col = int(center[0]), int(center[1])
            if not (0 <= center_row < rows and 0 <= center_col < cols):
                raise ValueError("Центр изоляции находится за границами сетки.")
            radius = int(intervention.get("radius", 2))
            cost = float(intervention.get("cost_per_cell", DEFAULT_COST_PER_CELL))
            if radius < 0:
                raise ValueError("Радиус изоляции не может быть отрицательным.")
            if cost < 0:
                raise ValueError("cost_per_cell не может быть отрицательным.")
            intervention["center"] = [center_row, center_col]
            intervention["radius"] = radius
            intervention["cost_per_cell"] = cost
        else:
            raise ValueError(
                f"Неизвестный тип вмешательства {kind!r}. Используйте remove_infected или isolate_zone."
            )
        normalized.append(intervention)
    return normalized


class SimulationSession:
    """Живая сессия симуляции.

    Хранит текущее состояние (сетка, маска изоляции, RNG, метрики) и позволяет
    продвигать модель на один день за раз, а также применять вмешательства
    пользователя «на лету». Каждый шаг потребляет ровно два массива случайных
    чисел, поэтому вмешательства не сдвигают поток случайности и сценарии с
    одинаковым seed остаются сопоставимыми.
    """

    def __init__(
        self,
        rows: int,
        cols: int,
        initial_infected: list[list[int]] | list[tuple[int, int]],
        days: int = 20,
        seed: int = 42,
        disease: dict[str, Any] | None = None,
        interventions: list[dict[str, Any]] | None = None,
    ) -> None:
        if not (10 <= rows <= 50 and 10 <= cols <= 50):
            raise ValueError("Размеры сетки должны быть в диапазоне от 10 до 50.")
        if not isinstance(days, int) or not 1 <= days <= 100:
            raise ValueError("days должен быть целым числом от 1 до 100.")
        if not isinstance(seed, int) or seed < 0:
            raise ValueError("seed должен быть неотрицательным целым числом.")

        self.rows = rows
        self.cols = cols
        self.days = days
        self.seed = seed
        self.infection_prob, self.recovery_prob, self.removal_prob = _normalize_disease(
            disease or {}
        )

        self.grid = create_initial_grid(rows, cols, initial_infected)
        self.isolation_mask = np.zeros((rows, cols), dtype=bool)
        self.ever_infected = self.grid == INFECTED
        self.rng = np.random.default_rng(seed)

        self.day = 0
        self.cumulative_cost = 0.0
        self.applied: list[dict[str, Any]] = []

        self._by_day: dict[int, list[dict[str, Any]]] = {}
        for intervention in _validate_interventions(
            interventions or [], rows, cols, days
        ):
            self._by_day.setdefault(intervention["day"], []).append(intervention)

        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
        self.scenario_id = f"sim_{seed}_{timestamp}_{uuid4().hex[:6]}"
        self.created_at = time.monotonic()

        # Вмешательства дня 0 применяются до первого кадра.
        for intervention in self._by_day.get(0, []):
            self._apply_scheduled(intervention)

        self.frames: list[dict[str, Any]] = [self._make_frame(0)]

    # ------------------------------------------------------------------ props
    @property
    def finished(self) -> bool:
        return self.day >= self.days

    # ------------------------------------------------------------- public API
    def step(self) -> dict[str, Any]:
        """Продвинуть симуляцию на один день и вернуть новый кадр."""
        if self.finished:
            raise SimulationFinishedError(
                f"Симуляция {self.scenario_id} уже завершена на дне {self.day}."
            )

        day = self.day + 1
        # Плановые вмешательства дня применяются до распространения.
        for intervention in self._by_day.get(day, []):
            self._apply_scheduled(intervention)

        self._spread()
        self.day = day
        self.frames.append(self._make_frame(day))
        return self.frames[-1]

    def intervene_remove(
        self, coord: list[int] | tuple[int, int], cost_per_plant: float
    ) -> dict[str, Any]:
        """Удалить одну клетку по coord (в любом случае, даже если не заражена)."""
        row, col = int(coord[0]), int(coord[1])
        if not (0 <= row < self.rows and 0 <= col < self.cols):
            raise ValueError(f"Координата ({row}, {col}) выходит за границы сетки.")
        if cost_per_plant < 0:
            raise ValueError("cost_per_plant не может быть отрицательной.")

        previous_state = int(self.grid[row, col])
        if previous_state == REMOVED:
            applied = {
                "type": "remove_cell",
                "day": self.day,
                "coord": [row, col],
                "previous_state": previous_state,
                "cost": 0.0,
                "applied": False,
            }
        else:
            self.grid[row, col] = REMOVED
            self.cumulative_cost += cost_per_plant
            applied = {
                "type": "remove_cell",
                "day": self.day,
                "coord": [row, col],
                "previous_state": previous_state,
                "cost": float(cost_per_plant),
                "applied": True,
            }
        self.applied.append(applied)
        return applied

    def intervene_isolate(
        self,
        center: list[int] | tuple[int, int],
        radius: int,
        cost_per_cell: float,
    ) -> dict[str, Any]:
        """Изолировать круглую зону (постоянно). Оплата — только за новые клетки."""
        center_row, center_col = int(center[0]), int(center[1])
        if not (0 <= center_row < self.rows and 0 <= center_col < self.cols):
            raise ValueError("Центр изоляции находится за границами сетки.")
        if radius < 0:
            raise ValueError("Радиус изоляции не может быть отрицательным.")
        if cost_per_cell < 0:
            raise ValueError("cost_per_cell не может быть отрицательной.")

        zone_mask = build_isolation_mask(
            self.rows, self.cols, (center_row, center_col), radius
        )
        zone_size = int(np.count_nonzero(zone_mask))
        newly_isolated = int(np.count_nonzero(zone_mask & ~self.isolation_mask))
        self.isolation_mask |= zone_mask
        cost = newly_isolated * cost_per_cell
        self.cumulative_cost += cost

        applied = {
            "type": "isolate_zone",
            "day": self.day,
            "center": [center_row, center_col],
            "radius": int(radius),
            "zone_size": zone_size,
            "newly_isolated": newly_isolated,
            "cost": float(cost),
        }
        self.applied.append(applied)
        return applied

    # --------------------------------------------------------------- internals
    def _apply_scheduled(self, intervention: dict[str, Any]) -> dict[str, Any]:
        if intervention["type"] == "remove_infected":
            return self.intervene_remove(
                intervention["coord"], intervention["cost_per_plant"]
            )
        return self.intervene_isolate(
            intervention["center"],
            intervention["radius"],
            intervention["cost_per_cell"],
        )

    def _spread(self) -> None:
        # Фиксированное число случайных выборок на день обеспечивает
        # сопоставимость сценариев с одинаковым seed.
        infection_draws = self.rng.random((self.rows, self.cols))
        outcome_draws = self.rng.random((self.rows, self.cols))

        snapshot = self.grid.copy()
        infected_neighbors = count_infected_neighbors(snapshot, self.isolation_mask)
        exposure_probability = 1.0 - np.power(
            1.0 - self.infection_prob, infected_neighbors
        )
        healthy_at_start = snapshot == HEALTHY
        infected_at_start = snapshot == INFECTED
        newly_infected = healthy_at_start & (infection_draws < exposure_probability)

        next_grid = snapshot.copy()
        next_grid[newly_infected] = INFECTED
        self.ever_infected |= newly_infected

        recovered_now = infected_at_start & (outcome_draws < self.recovery_prob)
        removed_now = (
            infected_at_start
            & (outcome_draws >= self.recovery_prob)
            & (outcome_draws < self.recovery_prob + self.removal_prob)
        )
        next_grid[recovered_now] = RECOVERED
        next_grid[removed_now] = REMOVED
        # Остальные растения, заражённые в начале дня, остаются INFECTED.
        self.grid = next_grid

    def _make_frame(self, day: int) -> dict[str, Any]:
        return _make_frame(day, self.grid, self.isolation_mask, self.cumulative_cost)

    def summary(self) -> dict[str, Any]:
        metrics = self.frames[-1]["metrics"]
        infected_by_day = [frame["metrics"]["infected"] for frame in self.frames]
        peak_infected = max(infected_by_day)
        peak_day = infected_by_day.index(peak_infected)
        return {
            "total_infected": int(np.count_nonzero(self.ever_infected)),
            "saved": int(metrics["healthy"] + metrics["recovered"]),
            "recovered": int(metrics["recovered"]),
            "removed": int(metrics["removed"]),
            "cost": float(self.cumulative_cost),
            "loss": int(metrics["removed"]),
            "peak_infected": int(peak_infected),
            "peak_day": int(peak_day),
        }

    def to_session_state(self) -> dict[str, Any]:
        return {
            "scenario_id": self.scenario_id,
            "seed": self.seed,
            "rows": self.rows,
            "cols": self.cols,
            "days": self.days,
            "current_day": self.day,
            "finished": self.finished,
            "state_names": STATE_NAMES.copy(),
            "frame": self.frames[-1],
            "applied_interventions": self.applied,
            "last_action": self.applied[-1] if self.applied else None,
            "summary": self.summary(),
        }

    def to_response(self) -> dict[str, Any]:
        return {
            "scenario_id": self.scenario_id,
            "seed": self.seed,
            "rows": self.rows,
            "cols": self.cols,
            "days": self.days,
            "state_names": STATE_NAMES.copy(),
            "applied_interventions": self.applied,
            "frames": self.frames,
            "summary": self.summary(),
        }


class SessionStore:
    """Потокобезопасное in-memory хранилище сессий с TTL и лимитом размера."""

    def __init__(self, ttl_seconds: float = 1800.0, max_sessions: int = 100) -> None:
        self._sessions: dict[str, SimulationSession] = {}
        self._last_activity: dict[str, float] = {}
        self._lock = threading.Lock()
        self._ttl = ttl_seconds
        self._max = max_sessions

    def create(self, session: SimulationSession) -> None:
        with self._lock:
            self._cleanup_locked()
            if len(self._sessions) >= self._max:
                oldest = min(self._last_activity, key=self._last_activity.get)
                self._sessions.pop(oldest, None)
                self._last_activity.pop(oldest, None)
            self._sessions[session.scenario_id] = session
            self._last_activity[session.scenario_id] = time.monotonic()

    def get(self, scenario_id: str) -> SimulationSession | None:
        with self._lock:
            self._cleanup_locked()
            session = self._sessions.get(scenario_id)
            if session is not None:
                self._last_activity[scenario_id] = time.monotonic()
            return session

    def delete(self, scenario_id: str) -> bool:
        with self._lock:
            existed = self._sessions.pop(scenario_id, None) is not None
            self._last_activity.pop(scenario_id, None)
            return existed

    def _cleanup_locked(self) -> None:
        now = time.monotonic()
        expired = [
            sid for sid, ts in self._last_activity.items() if now - ts > self._ttl
        ]
        for sid in expired:
            self._sessions.pop(sid, None)
            self._last_activity.pop(sid, None)


store = SessionStore()


def run_simulation(
    rows: int,
    cols: int,
    initial_infected: list[list[int]] | list[tuple[int, int]],
    days: int = 20,
    seed: int = 42,
    disease: dict[str, Any] | None = None,
    interventions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Запустить полный эксперимент и вернуть JSON-совместимый словарь.

    Интервенции применяются в начале указанного дня, до распространения.
    Кадр day=0 содержит исходную сетку; последующие кадры фиксируют итог дня.
    Изоляция остаётся активной до конца эксперимента и сама по себе не удаляет растения.
    """
    session = SimulationSession(
        rows=rows,
        cols=cols,
        initial_infected=initial_infected,
        days=days,
        seed=seed,
        disease=disease,
        interventions=interventions,
    )
    while not session.finished:
        session.step()
    return session.to_response()


def compare_scenarios(
    rows: int,
    cols: int,
    initial_infected: list[list[int]] | list[tuple[int, int]],
    days: int = 20,
    seed: int = 42,
    disease: dict[str, Any] | None = None,
    interventions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Сравнить базовый запуск с запуском с вмешательствами при одинаковом seed.

    Обе сессии шагают синхронно, поэтому потоки случайности совпадают.
    """
    common = {
        "rows": rows,
        "cols": cols,
        "initial_infected": initial_infected,
        "days": days,
        "seed": seed,
        "disease": disease or {},
    }
    baseline = SimulationSession(**common, interventions=[])
    intervention = SimulationSession(**common, interventions=interventions or [])

    while not baseline.finished or not intervention.finished:
        if not baseline.finished:
            baseline.step()
        if not intervention.finished:
            intervention.step()

    baseline_response = baseline.to_response()
    intervention_response = intervention.to_response()

    base_final = baseline_response["frames"][-1]["metrics"]
    intervention_final = intervention_response["frames"][-1]["metrics"]
    comparison = {
        "infected": {
            "baseline": base_final["infected"],
            "intervention": intervention_final["infected"],
            "change": intervention_final["infected"] - base_final["infected"],
        },
        "total_infected": {
            "baseline": baseline_response["summary"]["total_infected"],
            "intervention": intervention_response["summary"]["total_infected"],
            "change": intervention_response["summary"]["total_infected"]
            - baseline_response["summary"]["total_infected"],
        },
        "saved": {
            "baseline": baseline_response["summary"]["saved"],
            "intervention": intervention_response["summary"]["saved"],
            "change": intervention_response["summary"]["saved"]
            - baseline_response["summary"]["saved"],
        },
        "removed": {
            "baseline": baseline_response["summary"]["removed"],
            "intervention": intervention_response["summary"]["removed"],
            "change": intervention_response["summary"]["removed"]
            - baseline_response["summary"]["removed"],
        },
        "cost": {
            "baseline": baseline_response["summary"]["cost"],
            "intervention": intervention_response["summary"]["cost"],
            "change": intervention_response["summary"]["cost"]
            - baseline_response["summary"]["cost"],
        },
    }
    return {
        "baseline": baseline_response,
        "intervention": intervention_response,
        "comparison": comparison,
    }
