(() => {
  // =========================================================================
  // МИНИ-БЭКЕНД (пока нет реального API)
  // Если коллега запустит FastAPI — замените эти функции на fetch(...)
  // =========================================================================

  const STATE = { HEALTHY: 0, RISK: 1, INFECTED: 2, RECOVERED: 3, REMOVED: 4 };

  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  // Один шаг симуляции для сценария (baseline или intervention)
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
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] === STATE.INFECTED) {
              hasInfected = true;
              break;
            }
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
    return newGrid;
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

  // =========================================================================
  // СОСТОЯНИЕ ФРОНТЕНДА
  // =========================================================================
  const $ = (id) => document.getElementById(id);
  const COLORS = ["healthy", "risk", "infected", "recovered", "removed"];

  let baseline = null;      // объект-сценарий
  let intervention = null;  // объект-сценарий
  let playing = false;
  let timer = null;
  let currentTool = 'seed';
  let pendingSeeds = [];    // очаги, выбранные до создания сессии

  // =========================================================================
  // РЕНДЕР
  // =========================================================================
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
        btn.dataset.r = r;
        btn.dataset.c = c;
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
  }

  // =========================================================================
  // КЛИК ПО КЛЕТКЕ (живое вмешательство)
  // =========================================================================
  function onCellClick(sc, r, c) {
    // Если это ещё не сессия, а первичный выбор очагов
    if (!baseline) {
      if (currentTool !== 'seed') return;
      const key = `${r},${c}`;
      const i = pendingSeeds.findIndex(([sr, sc2]) => sr === r && sc2 === c);
      if (i >= 0) pendingSeeds.splice(i, 1);
      else pendingSeeds.push([r, c]);
      renderPreview();
      return;
    }

    // Живое вмешательство
    if (currentTool === 'remove') {
      const cost = Number($('costRemove').value) || 0;
      if (sc.grid[r][c] === STATE.REMOVED) return;
      sc.grid[r][c] = STATE.REMOVED;
      sc.cost += cost;
      renderAll();
    } else if (currentTool === 'isolate') {
      const rad = Number($('isolateRadius').value) || 0;
      const cost = Number($('costIsolate').value) || 0;
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
      sc.cost += newCells * cost;
      renderAll();
    }
  }

  // =========================================================================
  // ПРЕВЬЮ СЕТКИ (до создания сессии)
  // =========================================================================
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

  // =========================================================================
  // СОЗДАНИЕ СЕССИИ
  // =========================================================================
  function createSession() {
    const R = Number($('rows').value);
    const C = Number($('cols').value);
    const seed = Number($('seed').value);
    const inf = Number($('infectionProb').value);
    const rec = Number($('recoveryProb').value);
    const rem = Number($('removalProb').value);

    if (!pendingSeeds.length) {
      showStatus('Сначала отметьте хотя бы один очаг.', true);
      return;
    }

    const disease = { infection_prob: inf, recovery_prob: rec, removal_prob: rem };

    const mk = () => {
      const g = Array.from({length: R}, () => Array(C).fill(0));
      for (const [r, c] of pendingSeeds) g[r][c] = STATE.INFECTED;
      return {
        rows: R, cols: C, day: 0,
        disease,
        rand: rng(seed),  // одинаковый seed — одинаковый поток случайности
        grid: g,
        isolationMask: Array.from({length: R}, () => Array(C).fill(0)),
        cost: 0,
      };
    };

    baseline = mk();
    intervention = mk();

    // Разблокируем управление
    $('prevBtn').disabled = false;
    $('stepBtn').disabled = false;
    $('playBtn').disabled = false;
    $('resetBtn').disabled = false;
    document.querySelectorAll('.tool-btn').forEach(b => b.disabled = false);
    $('isolateRadius').disabled = false;
    $('startBtn').disabled = true;
    document.querySelectorAll('#rows, #cols, #seed').forEach(el => el.disabled = true);

    renderAll();
    showStatus('Сессия создана. Вмешивайтесь кликом по клеткам.');
  }

  // =========================================================================
  // ШАГ
  // =========================================================================
  function stepOne() {
    if (!baseline) return;
    // ВАЖНО: интервенция должна получить те же случайные числа, что и baseline.
    // Поэтому делаем шаг в baseline, потом в intervention — rand у них независимый,
    // но инициализирован одним seed. Это гарантирует идентичный поток случайности.
    stepScenario(baseline);
    stepScenario(intervention);
    renderAll();
  }

  function startPlay() {
    if (playing) return stopPlay();
    playing = true;
    $('playBtn').textContent = 'Пауза';
    timer = setInterval(() => {
      stepOne();
    }, 500);
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
    $('startBtn').disabled = false;
    $('prevBtn').disabled = true;
    $('stepBtn').disabled = true;
    $('playBtn').disabled = true;
    $('resetBtn').disabled = true;
    document.querySelectorAll('.tool-btn').forEach(b => b.disabled = b.dataset.tool !== 'seed');
    $('isolateRadius').disabled = true;
    document.querySelectorAll('#rows, #cols, #seed').forEach(el => el.disabled = false);
    renderPreview();
    showStatus('Сессия удалена.');
  }

  // =========================================================================
  // UI-СОБЫТИЯ
  // =========================================================================
  function showStatus(msg, err = false) {
    $('status').textContent = msg;
    $('status').classList.toggle('error', err);
  }

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

  // =========================================================================
  // СТАРТ
  // =========================================================================
  renderPreview();
})();