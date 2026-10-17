(() => {
  // ======================================================================
  // ЛОКАЛЬНЫЙ БЭКЕНД (заменить на fetch, когда коллега поднимет FastAPI)
  // ======================================================================
  const STATE = { HEALTHY: 0, RISK: 1, INFECTED: 2, RECOVERED: 3, REMOVED: 4 };

  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function stepScenario(sc) {
    const { rows, cols, disease, rand, grid, isolationMask } = sc;
    const newGrid = grid.map(r => [...r]);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const s = grid[r][c];
        if (s === STATE.INFECTED) {
          const roll = rand();
          if (roll < disease.recovery_prob) newGrid[r][c] = STATE.RECOVERED;
          else if (roll < disease.recovery_prob + disease.removal_prob) newGrid[r][c] = STATE.REMOVED;
        } else if (s === STATE.HEALTHY || s === STATE.RISK) {
          if (isolationMask[r][c]) continue;
          const nbs = [[r-1,c],[r+1,c],[r,c-1],[r,c+1]];
          let hasInfected = false;
          for (const [nr, nc] of nbs) {
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] === STATE.INFECTED) { hasInfected = true; break; }
          }
          if (hasInfected) {
            if (s === STATE.HEALTHY) {
              if (rand() < disease.infection_prob) newGrid[r][c] = STATE.INFECTED;
              else newGrid[r][c] = STATE.RISK;
            } else if (s === STATE.RISK) {
              if (rand() < disease.infection_prob * 1.5) newGrid[r][c] = STATE.INFECTED;
            }
          } else if (s === STATE.RISK) {
            newGrid[r][c] = STATE.HEALTHY;
          }
        }
      }
    }
    sc.grid = newGrid;
    sc.day += 1;
  }

  function calcMetrics(grid) {
    let healthy = 0, risk = 0, infected = 0, recovered = 0, removed = 0;
    for (const row of grid) for (const s of row) {
      if (s === STATE.HEALTHY) healthy++;
      else if (s === STATE.RISK) risk++;
      else if (s === STATE.INFECTED) infected++;
      else if (s === STATE.RECOVERED) recovered++;
      else if (s === STATE.REMOVED) removed++;
    }
    return { healthy, risk, infected, recovered, removed };
  }

  // ======================================================================
  // СОСТОЯНИЕ ФРОНТЕНДА
  // ======================================================================
  const $ = (id) => document.getElementById(id);
  const COLORS = ["healthy", "risk", "infected", "recovered", "removed"];

  let baseline = null;
  let intervention = null;
  let playing = false;
  let timer = null;
  let currentTool = 'seed';
  let pendingSeeds = [];
  let chart = null;
  let log = []; // журнал принятых мер: {day, type, coords, cost}

  // ======================================================================
  // ГРАФИК
  // ======================================================================
  function initChart() {
    const ctx = $('diseaseChart').getContext('2d');
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Заражено (базовая)',
            borderColor: '#e05252',
            backgroundColor: 'rgba(224,82,82,0.1)',
            data: [],
            tension: 0.25,
            borderWidth: 2,
            pointRadius: 0,
            borderDash: [6, 4],
          },
          {
            label: 'Заражено (с мерами)',
            borderColor: '#ff8888',
            backgroundColor: 'rgba(255,136,136,0.15)',
            data: [],
            tension: 0.25,
            borderWidth: 2,
            pointRadius: 0,
            fill: true,
          },
          {
            label: 'Здоровые (с мерами)',
            borderColor: '#4f8a5b',
            backgroundColor: 'transparent',
            data: [],
            tension: 0.25,
            borderWidth: 2,
            pointRadius: 0,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 200 },
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#9aada2', boxWidth: 12, boxHeight: 12, padding: 10, font: { size: 11 } }
          },
          tooltip: { backgroundColor: '#121b19', borderColor: '#293a34', borderWidth: 1, titleColor: '#e7f0e9', bodyColor: '#9aada2' }
        },
        scales: {
          x: {
            grid: { color: 'rgba(41,58,52,0.5)' },
            ticks: { color: '#9aada2', font: { size: 10 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(41,58,52,0.5)' },
            ticks: { color: '#9aada2', font: { size: 10 } }
          }
        }
      }
    });
  }

  function updateChart() {
    if (!chart || !baseline || !intervention) return;
    // Пересчитываем все точки от 0 до текущего дня
    // Для этого нужен массив истории. Проще — поддерживать history.
    // Здесь — пересчёт по истории шагов.
    const bHist = baseline.history || [];
    const iHist = intervention.history || [];

    const labels = [];
    const bInf = [];
    const iInf = [];
    const iHealthy = [];

    for (let i = 0; i < iHist.length; i++) {
      labels.push(`Д${i}`);
      bInf.push(bHist[i] ? bHist[i].infected : 0);
      iInf.push(iHist[i].infected);
      iHealthy.push(iHist[i].healthy);
    }
    chart.data.labels = labels;
    chart.data.datasets[0].data = bInf;
    chart.data.datasets[1].data = iInf;
    chart.data.datasets[2].data = iHealthy;
    chart.update();
  }

  // ======================================================================
  // РЕНДЕР
  // ======================================================================
  function renderGridInto(el, sc) {
    const { rows, cols, grid, isolationMask } = sc;
    el.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    el.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `cell ${COLORS[grid[r][c]]}`;
        if (isolationMask[r][c]) btn.classList.add('isolated');
        btn.addEventListener('click', () => onCellClick(sc, r, c));
        frag.appendChild(btn);
      }
    }
    el.appendChild(frag);
  }

  function updateMetricsUI() {
    if (!baseline) return;
    const b = calcMetrics(baseline.grid);
    $('bHealthy').textContent = b.healthy;
    $('bInfected').textContent = b.infected;
    $('bRecovered').textContent = b.recovered;
    $('bRemoved').textContent = b.removed;
    $('baselineDay').textContent = `День ${baseline.day}`;

    const i = calcMetrics(intervention.grid);
    $('iHealthy').textContent = i.healthy;
    $('iInfected').textContent = i.infected;
    $('iRecovered').textContent = i.recovered;
    $('iRemoved').textContent = i.removed;
    $('interventionDay').textContent = `День ${intervention.day}`;

    $('dayLabel').textContent = `День ${intervention.day}`;
  }

  function renderAll() {
    if (!baseline) return;
    renderGridInto($('gridBaseline'), baseline);
    renderGridInto($('gridIntervention'), intervention);
    updateMetricsUI();
    updateChart();
    renderLog();
  }

  // ======================================================================
  // ЖУРНАЛ МЕР
  // ======================================================================
  function renderLog() {
    const el = $('actionLog');
    if (!log.length) {
      el.innerHTML = '<p class="muted log-empty">Пока мер не принято.</p>';
    } else {
      el.innerHTML = '';
      // Показываем в обратном порядке (последние сверху)
      [...log].reverse().forEach(a => {
        const div = document.createElement('div');
        div.className = 'log-item';
        div.innerHTML = `<span class="log-desc">${a.desc}</span><span class="log-cost">${a.cost} ₽</span>`;
        el.appendChild(div);
      });
    }
    const total = log.reduce((s, a) => s + a.cost, 0);
    $('totalCost').textContent = `${total} ₽`;
  }

  function addLog(desc, cost) {
    log.push({ day: intervention ? intervention.day : 0, desc, cost });
    renderLog();
  }

  // ======================================================================
  // ВМЕШАТЕЛЬСТВА
  // ======================================================================
  function onCellClick(sc, r, c) {
    if (!baseline) {
      if (currentTool !== 'seed') return;
      const i = pendingSeeds.findIndex(([sr, scc]) => sr === r && scc === c);
      if (i >= 0) pendingSeeds.splice(i, 1);
      else pendingSeeds.push([r, c]);
      renderPreview();
      return;
    }

    // Вмешательство — только в сценарии intervention
    if (sc === baseline) {
      // Клик по baseline ничего не делает (это контрольный сценарий)
      return;
    }

    if (currentTool === 'remove') {
      if (sc.grid[r][c] === STATE.REMOVED) return; // no-op
      const cost = Number($('costRemove').value) || 0;
      sc.grid[r][c] = STATE.REMOVED;
      addLog(`Удалено (${r}, ${c})`, cost);
      renderAll();
    } else if (currentTool === 'isolate') {
      const rad = Number($('isolateRadius').value) || 0;
      const cellCost = Number($('costIsolate').value) || 0;
      let newCells = 0;
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (dr*dr + dc*dc > rad*rad) continue;
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= sc.rows || cc < 0 || cc >= sc.cols) continue;
          if (sc.isolationMask[rr][cc]) continue;
          sc.isolationMask[rr][cc] = 1;
          newCells++;
        }
      }
      if (newCells === 0) return;
      const total = newCells * cellCost;
      addLog(`Изоляция (${r}, ${c}), радиус ${rad} — ${newCells} кл.`, total);
      renderAll();
    }
  }

  // ======================================================================
  // ПРЕВЬЮ (до создания сессии)
  // ======================================================================
  function renderPreview() {
    const R = Number($('rows').value) || 10;
    const C = Number($('cols').value) || 10;

    const empty = {
      rows: R, cols: C,
      grid: Array.from({length: R}, () => Array(C).fill(0)),
      isolationMask: Array.from({length: R}, () => Array(C).fill(0)),
    };
    for (const [r, c] of pendingSeeds) empty.grid[r][c] = STATE.INFECTED;

    renderGridInto($('gridBaseline'), empty);
    renderGridInto($('gridIntervention'), empty);
    $('baselineDay').textContent = 'День 0';
    $('interventionDay').textContent = 'День 0';
    $('dayLabel').textContent = 'День 0';
  }

  // ======================================================================
  // СОЗДАНИЕ СЕССИИ
  // ======================================================================
  function createSession() {
    const R = Number($('rows').value);
    const C = Number($('cols').value);
    const seed = Number($('seed').value);
    const inf = Number($('infectionProb').value);
    const rec = Number($('recoveryProb').value);
    const rem = Number($('removalProb').value);

    if (!pendingSeeds.length) { showStatus('Сначала отметьте хотя бы один очаг.', true); return; }

    const disease = { infection_prob: inf, recovery_prob: rec, removal_prob: rem };

    const mk = () => {
      const g = Array.from({length: R}, () => Array(C).fill(0));
      for (const [r, c] of pendingSeeds) g[r][c] = STATE.INFECTED;
      const m0 = calcMetrics(g);
      return {
        rows: R, cols: C, day: 0,
        disease,
        rand: rng(seed),
        grid: g,
        isolationMask: Array.from({length: R}, () => Array(C).fill(0)),
        history: [m0],
      };
    };

    baseline = mk();
    intervention = mk();
    log = [];

    // Разблокировки
    $('stepBtn').disabled = false;
    $('playBtn').disabled = false;
    $('resetBtn').disabled = false;
    document.querySelectorAll('.tool-btn').forEach(b => b.disabled = false);
    $('isolateRadius').disabled = false;
    $('startBtn').disabled = true;
    document.querySelectorAll('#rows, #cols, #seed').forEach(el => el.disabled = true);

    // Сброс графика
    chart.data.labels = [];
    chart.data.datasets.forEach(ds => ds.data = []);
    chart.update();

    renderAll();
    showStatus('Сессия создана. Вмешивайтесь кликом по правой сетке.');
  }

  // ======================================================================
  // ШАГ
  // ======================================================================
  function stepOne() {
    if (!baseline) return;
    stepScenario(baseline);
    stepScenario(intervention);
    baseline.history.push(calcMetrics(baseline.grid));
    intervention.history.push(calcMetrics(intervention.grid));
    renderAll();
  }

  function startPlay() {
    if (playing) return stopPlay();
    playing = true;
    $('playBtn').textContent = 'Пауза';
    timer = setInterval(stepOne, 500);
  }
  function stopPlay() {
    playing = false;
    if (timer) { clearInterval(timer); timer = null; }
    $('playBtn').textContent = 'Play';
  }

  function resetSession() {
    stopPlay();
    baseline = null;
    intervention = null;
    pendingSeeds = [];
    log = [];
    $('startBtn').disabled = false;
    $('stepBtn').disabled = true;
    $('playBtn').disabled = true;
    $('resetBtn').disabled = true;
    document.querySelectorAll('.tool-btn').forEach(b => b.disabled = b.dataset.tool !== 'seed');
    document.querySelector('[data-tool="seed"]').classList.add('active');
    document.querySelectorAll('.tool-btn').forEach(b => { if (b.dataset.tool !== 'seed') b.classList.remove('active'); });
    currentTool = 'seed';
    $('isolateRadius').disabled = true;
    document.querySelectorAll('#rows, #cols, #seed').forEach(el => el.disabled = false);

    if (chart) {
      chart.data.labels = [];
      chart.data.datasets.forEach(ds => ds.data = []);
      chart.update();
    }

    renderPreview();
    renderLog();
    showStatus('Сессия удалена.');
  }

  // ======================================================================
  // УТИЛИТЫ
  // ======================================================================
  function showStatus(msg, err = false) {
    $('status').textContent = msg;
    $('status').classList.toggle('error', err);
  }

  // ======================================================================
  // СОБЫТИЯ
  // ======================================================================
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
    });
  });

  $('rows').addEventListener('input', () => { if (!baseline) renderPreview(); });
  $('cols').addEventListener('input', () => { if (!baseline) renderPreview(); });

  $('startBtn').addEventListener('click', createSession);
  $('resetBtn').addEventListener('click', resetSession);
  $('stepBtn').addEventListener('click', stepOne);
  $('playBtn').addEventListener('click', startPlay);

  // ======================================================================
  // СТАРТ
  // ======================================================================
  initChart();
  renderPreview();
})();