(() => {
  const $ = (id) => document.getElementById(id);
  
  // Состояния: 0-обычное, 1-риск, 2-зараженное, 3-выздоровело, 4-выкопали
  const COLORS = ["healthy", "risk", "infected", "recovered", "removed"];
  
  let seeds = [];
  let manualActions = []; // { r, c, type: 'remove' | 'isolate', radius, cost }
  let editing = true;
  let result = null;
  let currentScenario = 'intervention';
  let currentDay = 0;
  let playTimer = null;
  let menuCell = null;

  const rows = () => Number($("rows").value);
  const cols = () => Number($("cols").value);
  const totalDays = () => Number($("days").value);
  const costRemove = () => Number($("costRemove").value) || 0;
  const costIsolate = () => Number($("costIsolate").value) || 0;

  // Инициализация
  function init() {
    renderGrid();
    setupEvents();
  }

  function setupEvents() {
    $("runBtn").closest("form").addEventListener("submit", runSimulation);
    
    $("editSeeds").addEventListener("click", () => {
      editing = !editing;
      $("editSeeds").textContent = editing ? "Завершить выбор очагов" : "Режим очагов";
      $("editSeeds").classList.toggle("active", editing);
      resetTimeline();
      renderGrid();
    });

    $("showBaseline").addEventListener("click", () => switchScenario('baseline'));
    $("showIntervention").addEventListener("click", () => switchScenario('intervention'));
    
    $("prevBtn").addEventListener("click", () => setDay(currentDay - 1));
    $("nextBtn").addEventListener("click", () => setDay(currentDay + 1));
    $("daySlider").addEventListener("input", (e) => setDay(e.target.value));
    
    $("playBtn").addEventListener("click", togglePlay);
    
    // Меню
    $("menuRadius").addEventListener("input", updateMenuCost);
    $("costRemove").addEventListener("input", updateMenuCost);
    $("costIsolate").addEventListener("input", updateMenuCost);
    
    $("menuRemove").addEventListener("click", () => { if(menuCell) applyAction(menuCell.r, menuCell.c, 'remove'); });
    $("menuIsolate").addEventListener("click", () => { if(menuCell) applyAction(menuCell.r, menuCell.c, 'isolate', Number($("menuRadius").value)); });
    $("menuCancel").addEventListener("click", closeMenu);
    
    document.addEventListener("click", (e) => {
      if (!$("cellMenu").classList.contains("hidden") && 
          !$("cellMenu").contains(e.target) && 
          !e.target.classList.contains("cell")) {
        closeMenu();
      }
    });
  }

  // --- Рендер ---
  function renderGrid(customData, customMask) {
    const gridEl = $("grid");
    const R = rows();
    const C = cols();
    
    gridEl.style.gridTemplateColumns = `repeat(${C}, 1fr)`;
    
    let gData = customData;
    let gMask = customMask;
    
    // Если нет данных симуляции — рисуем начальное состояние
    if (!gData) {
      gData = Array.from({ length: R }, () => Array(C).fill(0));
      gMask = Array.from({ length: R }, () => Array(C).fill(0));
      
      // Очаги
      for (const [r, c] of seeds) {
        if (gData[r] && gData[r][c] !== undefined) gData[r][c] = 2;
      }
      
      // Ручные меры
      for (const a of manualActions) {
        if (a.type === 'remove' && gData[a.r]?.[a.c] !== undefined) {
          gData[a.r][a.c] = 4;
        } else if (a.type === 'isolate') {
          for (let dr = -a.radius; dr <= a.radius; dr++) {
            for (let dc = -a.radius; dc <= a.radius; dc++) {
              if (dr*dr + dc*dc <= a.radius*a.radius) {
                const rr = a.r + dr, cc = a.c + dc;
                if (gMask[rr] && gMask[rr][cc] !== undefined) gMask[rr][cc] = 1;
              }
            }
          }
        }
      }
    }

    const seedSet = new Set(seeds.map(([r,c]) => `${r},${c}`));
    const frag = document.createDocumentFragment();
    
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const state = gData[r][c];
        const isIso = gMask[r][c] === 1;
        const isSel = editing && seedSet.has(`${r},${c}`);
        
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `cell ${COLORS[state]}`;
        if (isIso) btn.classList.add("isolated");
        if (isSel) btn.classList.add("selected");
        
        btn.disabled = editing ? false : true;
        
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (editing) {
            toggleSeed(r, c);
          } else {
            openMenu(r, c, e);
          }
        });
        
        frag.appendChild(btn);
      }
    }
    
    gridEl.replaceChildren(frag);
    updateMetricsFromCurrentState(gData, gMask);
  }

  function updateMetricsFromCurrentState(gData, gMask) {
    let h=0, r=0, inf=0, rec=0, rem=0;
    for(let i=0; i<rows(); i++){
      for(let j=0; j<cols(); j++){
        const s = gData[i][j];
        if(s===0) h++;
        else if(s===1) r++;
        else if(s===2) inf++;
        else if(s===3) rec++;
        else if(s===4) rem++;
      }
    }
    $("mHealthy").textContent = h;
    $("mRisk").textContent = r;
    $("mInfected").textContent = inf;
    $("mRecovered").textContent = rec;
    $("mRemoved").textContent = rem;
    
    let cost = 0;
    if (result) {
      const sc = currentScenario === 'baseline' ? result.baseline : result.intervention;
      const frame = sc.frames[Math.min(currentDay, sc.days)];
      cost = frame.metrics.cost;
    } else {
      // Считаем предварительную стоимость ручных мер
      cost = manualActions.reduce((sum, a) => sum + a.cost, 0);
    }
    $("mCost").textContent = cost;
  }

  // --- Логика работы с клетками ---
  function toggleSeed(r, c) {
    const idx = seeds.findIndex(([sr, sc]) => sr === r && sc === c);
    if (idx >= 0) {
      seeds.splice(idx, 1);
    } else {
      if (seeds.length >= 3) {
        showStatus("Максимум 3 очага.", true);
        return;
      }
      seeds.push([r, c]);
    }
    // Удаляем меру с этой клетки, если была
    manualActions = manualActions.filter(a => !(a.r === r && a.c === c));
    resetTimeline();
    renderGrid();
  }

  function openMenu(r, c, event) {
    menuCell = { r, c };
    $("menuCoord").textContent = `(${r}, ${c})`;
    $("menuRadius").value = 1;
    updateMenuCost();
    
    const menu = $("cellMenu");
    menu.classList.remove("hidden");
    
    const x = Math.min(event.clientX, window.innerWidth - 240);
    const y = Math.min(event.clientY, window.innerHeight - 300);
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }

  function closeMenu() {
    $("cellMenu").classList.add("hidden");
    menuCell = null;
  }

  function updateMenuCost() {
    const rad = Number($("menuRadius").value) || 0;
    let count = 0;
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (dr*dr + dc*dc <= rad*rad) count++;
      }
    }
    $("menuRemoveCost").textContent = costRemove();
    $("menuIsolateCost").textContent = count * costIsolate();
  }

  function applyAction(r, c, type, radius = 0) {
    // Удаляем старые действия на этой клетке
    manualActions = manualActions.filter(a => !(a.r === r && a.c === c));
    // Удаляем очаг, если клетку трогаем
    seeds = seeds.filter(([sr, sc]) => !(sr === r && sc === c));
    
    if (type === 'remove') {
      manualActions.push({ r, c, type, cost: costRemove() });
    } else {
      let count = 0;
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (dr*dr + dc*dc <= radius*radius) count++;
        }
      }
      manualActions.push({ r, c, type, radius, cost: count * costIsolate() });
    }
    
    closeMenu();
    resetTimeline();
    renderGrid();
  }

  // --- Симуляция ---
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function runSimulation(e) {
    e.preventDefault();
    resetPlayback();
    
    try {
      const R = rows(), C = cols(), D = totalDays();
      const seed = Number($("seed").value);
      const inf = Number($("infectionProb").value);
      const rec = Number($("recoveryProb").value);
      const rem = Number($("removalProb").value);
      
      if (seeds.length === 0 && manualActions.length === 0) {
        throw new Error("Выберите хотя бы один очаг или примените меру.");
      }
      
      $("status").textContent = "Расчет...";
      
      const params = { rows: R, cols: C, days: D, seed, initial: seeds, disease: { infection_prob: inf, recovery_prob: rec, removal_prob: rem } };
      
      // Базовый сценарий (без мер)
      const baseline = simulate(params, []);
      // С вмешательством (ручные меры)
      const intervention = simulate(params, manualActions);
      
      result = { baseline, intervention };
      
      // Активируем таймлайн
      $("showBaseline").disabled = false;
      $("showIntervention").disabled = false;
      $("prevBtn").disabled = false;
      $("nextBtn").disabled = false;
      $("playBtn").disabled = false;
      $("daySlider").disabled = false;
      $("daySlider").max = D;
      
      switchScenario('intervention');
      setDay(0);
      showStatus(`Seed: ${seed}. Готово.`);
      
    } catch (err) {
      showStatus(err.message, true);
    }
  }

  function simulate(params, actions) {
    const { rows, cols, days, seed, initial, disease } = params;
    const rand = rng(seed);
    
    let grid = Array.from({ length: rows }, () => Array(cols).fill(0));
    let mask = Array.from({ length: rows }, () => Array(cols).fill(0));
    
    for (const [r, c] of initial) {
      if (grid[r] && grid[r][c] !== undefined) grid[r][c] = 2;
    }
    
    const frames = [];
    let totalCost = 0;
    
    // Применяем ручные меры в 0-й день
    for (const a of actions) {
      totalCost += a.cost;
      if (a.type === 'remove') {
        if (grid[a.r]?.[a.c] !== undefined) grid[a.r][a.c] = 4;
      } else if (a.type === 'isolate') {
        for (let dr = -a.radius; dr <= a.radius; dr++) {
          for (let dc = -a.radius; dc <= a.radius; dc++) {
            if (dr*dr + dc*dc <= a.radius*a.radius) {
              const r = a.r + dr, c = a.c + dc;
              if (mask[r] && mask[r][c] !== undefined) mask[r][c] = 1;
            }
          }
        }
      }
    }

    frames.push({ grid: grid.map(r=>[...r]), isolation_mask: mask.map(r=>[...r]), metrics: calcMetrics(grid, mask, totalCost) });

    for (let d = 1; d <= days; d++) {
      const nextGrid = grid.map(r => [...r]);
      
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const state = grid[r][c];
          
          if (state === 2) {
            // Зараженное: шанс выздороветь или умереть
            const roll = rand();
            if (roll < disease.recovery_prob) nextGrid[r][c] = 3;
            else if (roll < disease.recovery_prob + disease.removal_prob) nextGrid[r][c] = 4;
            
          } else if (state === 0 || state === 1) {
            // Обычное или риск
            if (mask[r][c]) continue;
            
            const isInfNeighbor = 
              (grid[r-1]?.[c] === 2) || (grid[r+1]?.[c] === 2) || 
              (grid[r]?.[c-1] === 2) || (grid[r]?.[c+1] === 2);
              
            if (isInfNeighbor) {
              if (state === 0) {
                if (rand() < disease.infection_prob) nextGrid[r][c] = 2;
                else nextGrid[r][c] = 1;
              } else {
                if (rand() < disease.infection_prob * 1.5) nextGrid[r][c] = 2;
              }
            } else if (state === 1) {
              nextGrid[r][c] = 0;
            }
          }
        }
      }
      
      grid = nextGrid;
      frames.push({ grid: grid.map(r=>[...r]), isolation_mask: mask.map(r=>[...r]), metrics: calcMetrics(grid, mask, totalCost) });
    }
    
    return { frames, days };
  }

  function calcMetrics(grid, mask, cost) {
    let healthy = 0, risk = 0, infected = 0, recovered = 0, removed = 0;
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const s = grid[r][c];
        if (s === 0) healthy++;
        else if (s === 1) risk++;
        else if (s === 2) infected++;
        else if (s === 3) recovered++;
        else if (s === 4) removed++;
      }
    }
    return { healthy, risk, infected, recovered, removed, cost };
  }

  // --- Управление таймлайном ---
  function switchScenario(sc) {
    if (!result) return;
    currentScenario = sc;
    $("showBaseline").classList.toggle("active", sc === 'baseline');
    $("showIntervention").classList.toggle("active", sc === 'intervention');
    setDay(currentDay);
  }

  function setDay(val) {
    if (!result) return;
    currentDay = Math.max(0, Math.min(totalDays(), Number(val)));
    $("daySlider").value = currentDay;
    $("dayLabel").textContent = `День ${currentDay} / ${totalDays()}`;
    
    const sc = currentScenario === 'baseline' ? result.baseline : result.intervention;
    const frame = sc.frames[currentDay];
    
    renderGrid(frame.grid, frame.isolation_mask);
    
    $("viewTitle").textContent = `${currentScenario === 'baseline' ? 'Без вмешательства' : 'С вмешательством'} · День ${currentDay}`;
    
    if (currentDay === 0) {
      $("viewSubtitle").textContent = "Начальное состояние.";
    } else {
      $("viewSubtitle").textContent = "Состояние после расчёта дня.";
    }
  }

  function togglePlay() {
    if (playTimer) {
      resetPlayback();
    } else {
      $("playBtn").textContent = "Пауза";
      if (currentDay >= totalDays()) setDay(0);
      
      playTimer = setInterval(() => {
        setDay(currentDay + 1);
        if (currentDay >= totalDays()) resetPlayback();
      }, 500);
    }
  }

  function resetPlayback() {
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
    $("playBtn").textContent = "Play";
  }

  function resetTimeline() {
    resetPlayback();
    result = null;
    currentDay = 0;
    $("showBaseline").disabled = true;
    $("showIntervention").disabled = true;
    $("showBaseline").classList.remove("active");
    $("showIntervention").classList.remove("active");
    $("prevBtn").disabled = true;
    $("nextBtn").disabled = true;
    $("playBtn").disabled = true;
    $("daySlider").disabled = true;
    $("daySlider").value = 0;
    $("dayLabel").textContent = `День 0 / ${totalDays()}`;
    $("viewTitle").textContent = "Начальная сетка";
  }

  function showStatus(msg, isErr = false) {
    const el = $("status");
    el.textContent = msg;
    el.classList.toggle("error", isErr);
  }

  init();
})();