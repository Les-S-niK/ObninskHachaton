const $ = (id) => document.getElementById(id);

const HEALTHY = 0,
    INFECTED = 1,
    RECOVERED = 2,
    REMOVED = 3;

// Цвета состояний: здоровые — белые, заражённые — красные,
// выздоровевшие с иммунитетом — зелёные, удалённые — чёрные.
const COLORS = {
    [HEALTHY]: "#ffffff",
    [INFECTED]: "#e53935",
    [RECOVERED]: "#4caf50",
    [REMOVED]: "#000000",
};
const ISOLATION_COLOR = "#8e24aa";
const ISOLATION_HATCH = "rgba(142, 36, 170, 0.6)";
const CELL_BORDER = "#d0d7de";

const MAX_CELLS = 3;
const SETUP_MAX_PX = 450;

const state = {
    rows: 15,
    cols: 15,
    days: 20,
    seed: 42,
    infection_prob: 0.15,
    recovery_prob: 0.05,
    removal_prob: 0.03,
    initial: new Set(),
    baselineId: null,
    interventionId: null,
    baseline: null,
    intervention: null,
    playing: false,
    timer: null,
    lastAction: null,
};

function cellSize(cols) {
    return Math.max(4, Math.floor(SETUP_MAX_PX / cols));
}

function drawSetup() {
    const canvas = $("setupCanvas");
    const cols = +$("cols").value,
        rows = +$("rows").value;
    const cs = cellSize(cols);
    canvas.width = cols * cs;
    canvas.height = rows * cs;
    const ctx = canvas.getContext("2d");
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = c * cs,
                y = r * cs;
            ctx.fillStyle = state.initial.has(r + "," + c)
                ? COLORS[INFECTED]
                : COLORS[HEALTHY];
            ctx.fillRect(x, y, cs, cs);
            ctx.lineWidth = 1;
            ctx.strokeStyle = CELL_BORDER;
            ctx.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
        }
    }
}

$("setupCanvas").addEventListener("click", (e) => {
    const canvas = e.target;
    const rect = canvas.getBoundingClientRect();
    const cols = +$("cols").value,
        rows = +$("rows").value;
    const cs = cellSize(cols);
    const c = Math.floor((e.clientX - rect.left) / cs);
    const r = Math.floor((e.clientY - rect.top) / cs);
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;
    const key = r + "," + c;
    if (state.initial.has(key)) state.initial.delete(key);
    else {
        if (state.initial.size >= MAX_CELLS) {
            alert("Максимум " + MAX_CELLS + " очага");
            return;
        }
        state.initial.add(key);
    }
    drawSetup();
});

function buildPayload() {
    return {
        rows: +$("rows").value,
        cols: +$("cols").value,
        days: +$("days").value,
        seed: +$("seed").value,
        initial_infected: [...state.initial].map((s) =>
            s.split(",").map(Number),
        ),
        disease: {
            infection_prob: +$("infection_prob").value,
            recovery_prob: +$("recovery_prob").value,
            removal_prob: +$("removal_prob").value,
        },
        interventions: [],
    };
}

async function post(url, body) {
    const resp = await fetch(url, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return resp.json();
}

async function createSimulations() {
    const payload = buildPayload();
    if (payload.initial_infected.length === 0) {
        alert("Выберите хотя бы один очаг");
        return;
    }
    try {
        const [baseline, intervention] = await Promise.all([
            post("/api/session/", payload),
            post("/api/session/", payload),
        ]);
        state.baselineId = baseline.scenario_id;
        state.interventionId = intervention.scenario_id;
        state.baseline = baseline;
        state.intervention = intervention;
        state.lastAction = null;
        $("setupCard").style.display = "none";
        $("playback").style.display = "block";
        $("log").innerHTML = "";
        setupCanvases();
        renderAll();
    } catch (err) {
        alert("Ошибка создания: " + err.message);
    }
}

function setupCanvases() {
    const cols = state.intervention.cols,
        rows = state.intervention.rows;
    const cs = cellSize(cols);
    for (const id of ["baselineCanvas", "interventionCanvas"]) {
        const cv = $(id);
        cv.width = cols * cs;
        cv.height = rows * cs;
    }
}

function drawHatch(ctx, x, y, size, color) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, size, size);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, size * 0.07);
    const step = Math.max(3, size * 0.32);
    ctx.beginPath();
    for (let d = -size; d < size * 2; d += step) {
        ctx.moveTo(x + d, y);
        ctx.lineTo(x + d + size, y + size);
    }
    ctx.stroke();
    ctx.restore();
}

function drawGrid(id, session, marker) {
    const cv = $(id);
    const ctx = cv.getContext("2d");
    const cols = session.cols,
        rows = session.rows;
    const cs = cv.width / cols;
    const grid = session.frame.grid,
        iso = session.frame.isolation_mask;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = c * cs,
                y = r * cs;
            const isolated = !!(iso && iso[r][c]);
            ctx.fillStyle = COLORS[grid[r][c]] || "#000";
            ctx.fillRect(x, y, cs, cs);
            if (isolated) {
                drawHatch(ctx, x, y, cs, ISOLATION_HATCH);
            }
            ctx.lineWidth = 1;
            ctx.strokeStyle = isolated ? ISOLATION_COLOR : CELL_BORDER;
            ctx.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
        }
    }
    if (marker) {
        ctx.lineWidth = Math.max(1.5, cs * 0.12);
        if (marker.type === "remove_cell") {
            const [r, c] = marker.coord;
            ctx.strokeStyle = "#000";
            ctx.beginPath();
            ctx.moveTo(c * cs + 2, r * cs + 2);
            ctx.lineTo((c + 1) * cs - 2, (r + 1) * cs - 2);
            ctx.moveTo((c + 1) * cs - 2, r * cs + 2);
            ctx.lineTo(c * cs + 2, (r + 1) * cs - 2);
            ctx.stroke();
        } else if (marker.type === "isolate_zone") {
            // Вместо круга — фиолетовая рамка у всех клеток зоны.
            const [r, c] = marker.center;
            const rad = marker.radius;
            ctx.strokeStyle = ISOLATION_COLOR;
            for (let rr = 0; rr < rows; rr++) {
                for (let cc = 0; cc < cols; cc++) {
                    if ((rr - r) ** 2 + (cc - c) ** 2 <= rad * rad) {
                        ctx.strokeRect(cc * cs + 0.5, rr * cs + 0.5, cs - 1, cs - 1);
                    }
                }
            }
        }
    }
}

function renderMetrics(id, session) {
    const m = session.frame.metrics;
    const items = [
        ["Здоровые", m.healthy],
        ["Заражены", m.infected],
        ["Выздоровели", m.recovered],
        ["Удалены", m.removed],
        ["Изолировано", m.isolated],
        ["Расходы", m.cost],
    ];
    $(id).innerHTML = items
        .map(
            ([l, v]) =>
                '<div class="metric"><div class="v">' +
                v +
                '</div><div class="l">' +
                l +
                "</div></div>",
        )
        .join("");
}

function renderCompare() {
    const b = state.baseline.frame.metrics,
        i = state.intervention.frame.metrics;
    const rows = [
        ["Заражены", "infected"],
        ["Здоровые", "healthy"],
        ["Выздоровели", "recovered"],
        ["Удалены", "removed"],
        ["Изолировано", "isolated"],
        ["Расходы", "cost"],
    ];
    let html =
        "<tr><th>Метрика</th><th>Без вмешательства</th><th>С вмешательствами</th><th>Δ</th></tr>";
    for (const [label, key] of rows) {
        const d = i[key] - b[key];
        const cls = d > 0 ? "delta-pos" : d < 0 ? "delta-neg" : "";
        const sign = d > 0 ? "+" : "";
        html +=
            "<tr><td>" +
            label +
            "</td><td>" +
            b[key] +
            "</td><td>" +
            i[key] +
            '</td><td class="' +
            cls +
            '">' +
            sign +
            d +
            "</td></tr>";
    }
    $("compareTable").innerHTML = html;
}

function renderAll() {
    if (!state.intervention) return;
    drawGrid("baselineCanvas", state.baseline);
    drawGrid("interventionCanvas", state.intervention, state.lastAction);
    renderMetrics("baselineMetrics", state.baseline);
    renderMetrics("interventionMetrics", state.intervention);
    renderCompare();
    const s = state.intervention;
    $("status").textContent =
        "День " +
        s.current_day +
        " / " +
        s.days +
        (s.finished ? " — завершено" : "");
}

async function step() {
    if (!state.intervention || state.intervention.finished) {
        stopPlay();
        return;
    }
    try {
        const [b, i] = await Promise.all([
            post("/api/session/" + state.baselineId + "/step", {}),
            post("/api/session/" + state.interventionId + "/step", {}),
        ]);
        state.baseline = b;
        state.intervention = i;
        state.lastAction = null;
        renderAll();
        if (state.intervention.finished) stopPlay();
    } catch (err) {
        stopPlay();
        alert("Ошибка шага: " + err.message);
    }
}

function togglePlay() {
    if (state.playing) {
        stopPlay();
        return;
    }
    if (!state.intervention || state.intervention.finished) return;
    state.playing = true;
    $("playBtn").textContent = "Пауза";
    state.timer = setInterval(step, 450);
    step();
}

function stopPlay() {
    state.playing = false;
    $("playBtn").textContent = "Запустить";
    if (state.timer) {
        clearInterval(state.timer);
        state.timer = null;
    }
}

async function reset() {
    stopPlay();
    if (state.baselineId)
        await fetch("/api/session/" + state.baselineId, {
            method: "DELETE",
        }).catch(() => { });
    if (state.interventionId)
        await fetch("/api/session/" + state.interventionId, {
            method: "DELETE",
        }).catch(() => { });
    state.baselineId = state.interventionId = null;
    state.baseline = state.intervention = null;
    $("playback").style.display = "none";
    $("setupCard").style.display = "block";
}

$("interventionCanvas").addEventListener("click", async (e) => {
    if (!state.intervention || state.intervention.finished) return;
    const cv = e.target;
    const rect = cv.getBoundingClientRect();
    const cols = state.intervention.cols,
        rows = state.intervention.rows;
    const cs = cv.width / cols;
    const c = Math.floor((e.clientX - rect.left) / cs);
    const r = Math.floor((e.clientY - rect.top) / cs);
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;

    const mode = document.querySelector("input[name=mode]:checked").value;
    const body =
        mode === "remove"
            ? {
                type: "remove_cell",
                coord: [r, c],
                cost_per_plant: +$("costPlant").value,
            }
            : {
                type: "isolate_zone",
                center: [r, c],
                radius: +$("radius").value,
                cost_per_cell: +$("costCell").value,
            };

    try {
        state.intervention = await post(
            "/api/session/" + state.interventionId + "/intervene",
            body,
        );
        state.lastAction = state.intervention.last_action;
        addLog(
            state.intervention.applied_interventions[
            state.intervention.applied_interventions.length - 1
            ],
        );
        renderAll();
    } catch (err) {
        alert("Ошибка вмешательства: " + err.message);
    }
});

function addLog(a) {
    if (!a) return;
    let text;
    if (a.type === "remove_cell") {
        text =
            "День " +
            a.day +
            ": удаление [" +
            a.coord +
            "] (до этого состояние " +
            a.previous_state +
            ")" +
            (a.applied ? "" : " — уже удалено");
    } else {
        text =
            "День " +
            a.day +
            ": изоляция [" +
            a.center +
            "] r=" +
            a.radius +
            ", новых клеток " +
            a.newly_isolated +
            ", стоимость " +
            a.cost;
    }
    const div = document.createElement("div");
    div.textContent = text;
    $("log").prepend(div);
}

$("rows").addEventListener("input", drawSetup);
$("cols").addEventListener("input", drawSetup);
$("randomSeed").addEventListener("click", () => {
    $("seed").value = Math.floor(Math.random() * 1000000);
});
$("createBtn").addEventListener("click", createSimulations);
$("stepBtn").addEventListener("click", step);
$("playBtn").addEventListener("click", togglePlay);
$("resetBtn").addEventListener("click", reset);

drawSetup();
