from __future__ import annotations

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
        "cost": cumulative_cost,
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
    if len(interventions) > 10:
        raise ValueError("Допускается не более 10 вмешательств.")

    normalized: list[dict[str, Any]] = []
    for index, original in enumerate(interventions):
        intervention = dict(original)
        kind = intervention.get("type")
        day = int(intervention.get("day", 0))
        if not 1 <= day <= days:
            raise ValueError(
                f"Вмешательство #{index + 1}: day должен быть от 1 до {days}."
            )
        intervention["day"] = day

        if kind == "remove_infected":
            cost = int(intervention.get("cost_per_plant", 10))
            if cost < 0:
                raise ValueError("cost_per_plant не может быть отрицательным.")
            intervention["cost_per_plant"] = cost
        elif kind == "isolate_zone":
            center = intervention.get("center")
            if not isinstance(center, (list, tuple)) or len(center) != 2:
                raise ValueError("Для isolate_zone нужно указать center: [row, col].")
            center_row, center_col = int(center[0]), int(center[1])
            if not (0 <= center_row < rows and 0 <= center_col < cols):
                raise ValueError("Центр изоляции находится за границами сетки.")
            radius = int(intervention.get("radius", 2))
            cost = int(intervention.get("cost_per_cell", 2))
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
    if not (10 <= rows <= 50 and 10 <= cols <= 50):
        raise ValueError("Размеры сетки должны быть в диапазоне от 10 до 50.")
    if not isinstance(days, int) or not 1 <= days <= 100:
        raise ValueError("days должен быть целым числом от 1 до 100.")
    if not isinstance(seed, int) or seed < 0:
        raise ValueError("seed должен быть неотрицательным целым числом.")

    disease = disease or {}
    interventions = interventions or []
    infection_prob, recovery_prob, removal_prob = _normalize_disease(disease)
    normalized_interventions = _validate_interventions(interventions, rows, cols, days)

    grid = create_initial_grid(rows, cols, initial_infected)
    isolation_mask = np.zeros((rows, cols), dtype=bool)
    ever_infected = grid == INFECTED
    rng = np.random.default_rng(seed)

    by_day: dict[int, list[dict[str, Any]]] = {}
    for intervention in normalized_interventions:
        by_day.setdefault(intervention["day"], []).append(intervention)

    cumulative_cost: int | float = 0
    frames: list[dict[str, Any]] = [
        _make_frame(0, grid, isolation_mask, cumulative_cost)
    ]
    applied_interventions: list[dict[str, Any]] = []

    for day in range(1, days + 1):
        # Вмешательства сначала изменяют текущую сетку и/или маску изоляции.
        for intervention in by_day.get(day, []):
            if intervention["type"] == "remove_infected":
                infected_now = grid == INFECTED
                removed_count = int(np.count_nonzero(infected_now))
                grid[infected_now] = REMOVED
                cost = removed_count * intervention["cost_per_plant"]
                cumulative_cost += cost
                applied_interventions.append(
                    {
                        "type": "remove_infected",
                        "day": day,
                        "removed_count": removed_count,
                        "cost_per_plant": intervention["cost_per_plant"],
                        "cost": cost,
                    }
                )
            else:  # isolate_zone
                zone_mask = build_isolation_mask(
                    rows, cols, intervention["center"], intervention["radius"]
                )
                zone_size = int(np.count_nonzero(zone_mask))
                isolation_mask |= zone_mask
                cost = zone_size * intervention["cost_per_cell"]
                cumulative_cost += cost
                applied_interventions.append(
                    {
                        "type": "isolate_zone",
                        "day": day,
                        "center": intervention["center"],
                        "radius": intervention["radius"],
                        "zone_size": zone_size,
                        "removed_inside": 0,
                        "cost_per_cell": intervention["cost_per_cell"],
                        "cost": cost,
                    }
                )

        # Фиксированное число случайных выборок на день обеспечивает сопоставимость
        # сценариев с одинаковыми seed: значения привязаны к координатам клеток.
        infection_draws = rng.random((rows, cols))
        outcome_draws = rng.random((rows, cols))

        snapshot = grid.copy()
        infected_neighbors = count_infected_neighbors(snapshot, isolation_mask)
        exposure_probability = 1.0 - np.power(1.0 - infection_prob, infected_neighbors)
        healthy_at_start = snapshot == HEALTHY
        infected_at_start = snapshot == INFECTED
        newly_infected = healthy_at_start & (infection_draws < exposure_probability)

        next_grid = snapshot.copy()
        next_grid[newly_infected] = INFECTED
        ever_infected |= newly_infected

        recovered_now = infected_at_start & (outcome_draws < recovery_prob)
        removed_now = (
            infected_at_start
            & (outcome_draws >= recovery_prob)
            & (outcome_draws < recovery_prob + removal_prob)
        )
        next_grid[recovered_now] = RECOVERED
        next_grid[removed_now] = REMOVED
        # Остальные растения, заражённые в начале дня, остаются INFECTED.
        grid = next_grid
        frames.append(_make_frame(day, grid, isolation_mask, cumulative_cost))

    final_metrics = frames[-1]["metrics"]
    infected_by_day = [frame["metrics"]["infected"] for frame in frames]
    peak_infected = max(infected_by_day)
    peak_day = infected_by_day.index(peak_infected)

    summary = {
        "total_infected": int(np.count_nonzero(ever_infected)),
        "saved": int(final_metrics["healthy"] + final_metrics["recovered"]),
        "recovered": int(final_metrics["recovered"]),
        "removed": int(final_metrics["removed"]),
        "cost": cumulative_cost,
        "loss": int(final_metrics["removed"]),
        "peak_infected": int(peak_infected),
        "peak_day": int(peak_day),
    }

    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
    scenario_id = f"sim_{seed}_{timestamp}_{uuid4().hex[:6]}"
    return {
        "scenario_id": scenario_id,
        "seed": seed,
        "rows": rows,
        "cols": cols,
        "days": days,
        "state_names": STATE_NAMES.copy(),
        "applied_interventions": applied_interventions,
        "frames": frames,
        "summary": summary,
    }


def compare_scenarios(
    rows: int,
    cols: int,
    initial_infected: list[list[int]] | list[tuple[int, int]],
    days: int = 20,
    seed: int = 42,
    disease: dict[str, Any] | None = None,
    interventions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Сравнить базовый запуск с запуском с вмешательствами при одинаковом seed."""
    common = {
        "rows": rows,
        "cols": cols,
        "initial_infected": initial_infected,
        "days": days,
        "seed": seed,
        "disease": disease or {},
    }
    baseline = run_simulation(**common, interventions=[])
    intervention_result = run_simulation(**common, interventions=interventions or [])

    base_final = baseline["frames"][-1]["metrics"]
    intervention_final = intervention_result["frames"][-1]["metrics"]
    comparison = {
        "infected": {
            "baseline": base_final["infected"],
            "intervention": intervention_final["infected"],
            "change": intervention_final["infected"] - base_final["infected"],
        },
        "total_infected": {
            "baseline": baseline["summary"]["total_infected"],
            "intervention": intervention_result["summary"]["total_infected"],
            "change": intervention_result["summary"]["total_infected"]
            - baseline["summary"]["total_infected"],
        },
        "saved": {
            "baseline": baseline["summary"]["saved"],
            "intervention": intervention_result["summary"]["saved"],
            "change": intervention_result["summary"]["saved"]
            - baseline["summary"]["saved"],
        },
        "removed": {
            "baseline": baseline["summary"]["removed"],
            "intervention": intervention_result["summary"]["removed"],
            "change": intervention_result["summary"]["removed"]
            - baseline["summary"]["removed"],
        },
        "cost": {
            "baseline": baseline["summary"]["cost"],
            "intervention": intervention_result["summary"]["cost"],
            "change": intervention_result["summary"]["cost"]
            - baseline["summary"]["cost"],
        },
    }
    return {
        "baseline": baseline,
        "intervention": intervention_result,
        "comparison": comparison,
    }
