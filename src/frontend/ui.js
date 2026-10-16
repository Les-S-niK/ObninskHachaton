// Состояние интерфейса
let history = [];
let dailyStats = [];
let currentFrame = 0;
let chart = null;
let currentMode = 'none'; // 'none' | 'measure'

// Запуск при загрузке
window.onload = () => {
    createGrid();
    initChart();
    resetUI();
};

// Установка режима (клик по одной из двух кнопок)
function setMode(mode) {
    currentMode = mode;
    const btnNone = document.getElementById('btn-none');
    const btnMeasure = document.getElementById('btn-measure');

    if (mode === 'measure') {
        btnMeasure.classList.add('active');
        btnNone.classList.remove('active');
    } else {
        btnNone.classList.add('active');
        btnMeasure.classList.remove('active');
    }
}

// Создание 100 клеток
function createGrid() {
    const gridEl = document.getElementById('grid');
    gridEl.innerHTML = '';
    for (let i = 0; i < 100; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell healthy';
        cell.id = `cell-${i}`;
        gridEl.appendChild(cell);
    }
}

// Покраска клеток
function renderGrid(states) {
    for (let i = 0; i < states.length; i++) {
        document.getElementById(`cell-${i}`).className = `cell ${states[i]}`;
    }
}

// Обновление цифр
function updateStats(stats) {
    document.getElementById('stat-healthy').textContent = stats.healthy;
    document.getElementById('stat-risk').textContent = stats.risk;
    document.getElementById('stat-infected').textContent = stats.infected;
    document.getElementById('stat-recovered').textContent = stats.recovered;
    document.getElementById('stat-removed').textContent = stats.removed;
    document.getElementById('stat-cost').textContent = stats.cost;
}

// Сброс
function resetUI() {
    currentFrame = 0;
    history = [];
    dailyStats = [];
    createGrid();
    updateStats({ healthy: 100, risk: 0, infected: 0, recovered: 0, removed: 0, cost: 0 });
    document.getElementById('current-day').textContent = 0;
    document.getElementById('day-slider').value = 0;
    document.getElementById('day-slider').disabled = true;
    document.getElementById('btn-prev').disabled = true;
    document.getElementById('btn-next').disabled = true;
    document.getElementById('status-text').textContent = 'Ожидание';

    if (chart) {
        chart.data.labels = [];
        chart.data.datasets.forEach(ds => ds.data = []);
        chart.update();
    }
}

function resetSimulation() { resetUI(); }

// Запуск симуляции
function runSimulation() {
    document.getElementById('status-text').textContent = 'Расчёт...';

    // Вызов функции коллеги из logic.js
    const result = runSimulationLogic(currentMode);
    history = result.history;
    dailyStats = result.stats;

    document.getElementById('day-slider').disabled = false;
    document.getElementById('btn-prev').disabled = false;
    document.getElementById('btn-next').disabled = false;
    document.getElementById('status-text').textContent = 'Готово! Листайте дни.';

    buildChart();
    goToDay(20);
}

// Переключение дня
function goToDay(day) {
    day = parseInt(day);
    if (!history[day]) return;
    currentFrame = day;
    renderGrid(history[day]);
    updateStats(dailyStats[day]);
    document.getElementById('current-day').textContent = day;
    document.getElementById('day-slider').value = day;
    document.getElementById('btn-prev').disabled = (day === 0);
    document.getElementById('btn-next').disabled = (day === 20);
}

function prevDay() { goToDay(currentFrame - 1); }
function nextDay() { goToDay(currentFrame + 1); }

// График
function initChart() {
    const ctx = document.getElementById('infectionChart').getContext('2d');
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                { label: 'Обычные', borderColor: '#9E9E9E', data: [], tension: 0.3 },
                { label: 'В зоне риска', borderColor: '#FFC107', data: [], tension: 0.3 },
                { label: 'Заразные', borderColor: '#F44336', data: [], tension: 0.3 },
                { label: 'Выздоровело', borderColor: '#4CAF50', data: [], tension: 0.3 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            plugins: { legend: { position: 'bottom' } }
        }
    });
}

function buildChart() {
    chart.data.labels = [];
    chart.data.datasets.forEach(ds => ds.data = []);
    for (let i = 0; i <= 20; i++) {
        chart.data.labels.push(`Д${i}`);
        chart.data.datasets[0].data.push(dailyStats[i].healthy);
        chart.data.datasets[1].data.push(dailyStats[i].risk);
        chart.data.datasets[2].data.push(dailyStats[i].infected);
        chart.data.datasets[3].data.push(dailyStats[i].recovered);
    }
    chart.update();
}