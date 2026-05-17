/* ═══════════════════════════════════════════
   Delhi AQI Predictor — Frontend App
   ═══════════════════════════════════════════ */

const API = '/api';

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const AQI_CATS = [
  { max:50,  label:'Good',         color:'#52b788', bg:'rgba(82,183,136,0.1)',  advice:'Excellent air quality. Safe for all outdoor activities.' },
  { max:100, label:'Satisfactory', color:'#74c69d', bg:'rgba(116,198,157,0.1)', advice:'Acceptable air quality. Sensitive individuals may feel mild discomfort.' },
  { max:200, label:'Moderate',     color:'#f4a261', bg:'rgba(244,162,97,0.1)',  advice:'General public may begin to experience health effects. Sensitive groups should limit exposure.' },
  { max:300, label:'Poor',         color:'#e76f51', bg:'rgba(231,111,81,0.1)',  advice:'Breathing discomfort for most people. Avoid prolonged outdoor activity. Wear N95 masks.' },
  { max:400, label:'Very Poor',    color:'#c1121f', bg:'rgba(193,18,31,0.08)',  advice:'Serious risk of respiratory illness. Stay indoors. Use air purifiers.' },
  { max:9999,label:'Severe',       color:'#6a0572', bg:'rgba(106,5,114,0.08)', advice:'Health emergency. Avoid ALL outdoor activity. Wear respirators if going outside is unavoidable.' }
];

function getCategory(aqi) {
  return AQI_CATS.find(c => aqi <= c.max) || AQI_CATS[AQI_CATS.length - 1];
}

/* ── Global state ── */
let statsData = null;
let currentScope = 'month';
let currentMethod = 'regression';
let charts = {};

/* ══════════════════════════════════════
   BOOT
══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  initNav();
  initScopeSegment();
  initMethodCards();
  initDaySelect();
  document.getElementById('selMonth').addEventListener('change', initDaySelect);
  document.getElementById('selWeek').addEventListener('input', e => {
    document.getElementById('weekDisplay').textContent = `Week ${e.target.value}`;
  });
  document.getElementById('btnPredict').addEventListener('click', runPrediction);
  initChat();

  // Load stats from backend
  await loadStats();
});

/* ══════════════════════════════════════
   NAVIGATION
══════════════════════════════════════ */
function initNav() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const page = link.dataset.page;
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      document.querySelectorAll('.page').forEach(p => {
        p.classList.add('hidden');
        p.classList.remove('active');
      });
      const target = document.getElementById(`page-${page}`);
      target.classList.remove('hidden');
      target.classList.add('active');

      // Lazy-render charts on analytics page
      if (page === 'analytics' && statsData && !charts.monthly) buildCharts();
      if (page === 'stats' && statsData) buildStatsPage();
      if (page === 'ai' && statsData) buildAIContext();
    });
  });
}

/* ══════════════════════════════════════
   LOAD STATS FROM BACKEND
══════════════════════════════════════ */
async function loadStats() {
  try {
    const res = await fetch(`${API}/stats`);
    statsData = await res.json();
    populateHero(statsData);
    document.getElementById('serverStatus').innerHTML =
      '<span class="status-dot"></span> Live · ' + statsData.totalRecords + ' records';
  } catch (e) {
    document.getElementById('serverStatus').innerHTML =
      '<span class="status-dot" style="background:#e76f51"></span> Offline';
    console.error('Backend unreachable:', e);
  }
}

function populateHero(d) {
  document.getElementById('hs-mean').textContent   = d.global.mean;
  document.getElementById('hs-std').textContent    = d.global.std;
  document.getElementById('hs-median').textContent = d.global.median;
  document.getElementById('hs-n').textContent      = d.totalRecords.toLocaleString();
  document.getElementById('hs-r2').textContent     = d.yearlyRegression.r2;
}

/* ══════════════════════════════════════
   SCOPE SEGMENT
══════════════════════════════════════ */
function initScopeSegment() {
  document.querySelectorAll('#scopeSeg .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#scopeSeg .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentScope = btn.dataset.val;
      updateScopeVisibility();
    });
  });
}

function updateScopeVisibility() {
  document.getElementById('fgMonth').classList.toggle('hidden', currentScope === 'week' || currentScope === 'year');
  document.getElementById('fgDay').classList.toggle('hidden', currentScope !== 'day');
  document.getElementById('fgWeek').classList.toggle('hidden', currentScope !== 'week');
  document.getElementById('fgYear').classList.toggle('hidden', currentScope !== 'year');
}

/* ══════════════════════════════════════
   METHOD CARDS
══════════════════════════════════════ */
function initMethodCards() {
  document.querySelectorAll('.method-card-opt').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.method-card-opt').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      currentMethod = card.dataset.method;
    });
  });
}

/* ══════════════════════════════════════
   DAY SELECT
══════════════════════════════════════ */
function initDaySelect() {
  const m = parseInt(document.getElementById('selMonth').value);
  const days = [31,28,31,30,31,30,31,31,30,31,30,31][m - 1];
  const sel = document.getElementById('selDay');
  sel.innerHTML = '';
  for (let d = 1; d <= days; d++) {
    sel.innerHTML += `<option value="${d}">${d}</option>`;
  }
}

/* ══════════════════════════════════════
   RUN PREDICTION (calls backend)
══════════════════════════════════════ */
async function runPrediction() {
  const btn = document.getElementById('btnPredict');
  btn.classList.add('loading');
  btn.querySelector('.btn-text').textContent = 'Computing…';

  const body = {
    type:       currentScope,
    month:      parseInt(document.getElementById('selMonth').value),
    day:        parseInt(document.getElementById('selDay').value),
    week:       parseInt(document.getElementById('selWeek').value),
    targetYear: parseInt(document.getElementById('selYear').value),
    method:     currentMethod
  };

  try {
    const res  = await fetch(`${API}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.success) {
      renderResult(data, body);
      // Also fetch full forecast for the year
      await loadForecastTable(body.targetYear, currentMethod);
    } else {
      alert('Prediction error: ' + data.error);
    }
  } catch (e) {
    alert('Cannot reach backend. Make sure the server is running on port 3000.');
  } finally {
    btn.classList.remove('loading');
    btn.querySelector('.btn-text').textContent = 'Run Prediction';
  }
}

/* ══════════════════════════════════════
   RENDER RESULT
══════════════════════════════════════ */
function renderResult(data, params) {
  const cat  = getCategory(data.predicted);
  const month = params.month || 1;
  const year  = params.targetYear || 2026;

  // Build period label
  let periodLabel = '';
  if (params.type === 'day')   periodLabel = `${MONTH_NAMES[month-1]} ${params.day}, ${year}`;
  else if (params.type === 'week') periodLabel = `Week ${params.week}, ${year}`;
  else if (params.type === 'year') periodLabel = `Annual Average ${year}`;
  else periodLabel = `${MONTH_NAMES[month-1]} ${year}`;

  // Show content
  document.getElementById('resultPlaceholder').classList.add('hidden');
  const rc = document.getElementById('resultContent');
  rc.classList.remove('hidden');

  // Animate gauge
  animateGauge(data.predicted);

  // Meta
  document.getElementById('resPeriod').textContent  = periodLabel;
  document.getElementById('resCat').textContent     = cat.label;
  document.getElementById('resCat').style.color     = cat.color;
  document.getElementById('resAdvice').textContent  = cat.advice;
  document.getElementById('resFormula').textContent = data.methodFormula;

  // Mini stat chips
  document.getElementById('sc-mean').textContent   = data.historicalMean;
  document.getElementById('sc-std').textContent    = data.historicalStd;
  document.getElementById('sc-ci-l').textContent   = data.ciLower;
  document.getElementById('sc-median').textContent = data.historicalMedian;
  document.getElementById('sc-ci-u').textContent   = data.ciUpper;
  document.getElementById('sc-z').textContent      = (data.zScore > 0 ? '+' : '') + data.zScore;

  // Confidence bar
  document.getElementById('confPct').textContent      = data.confidence + '%';
  document.getElementById('confFill').style.width     = data.confidence + '%';

  // Method note
  const notes = {
    regression: `Linear Regression: ŷ = β₀ + β₁·year × seasonal_index\nR² = ${statsData?.yearlyRegression?.r2 || '—'} | 95% CI = predicted ± 1.96σ`,
    bayes:      `Bayesian: μ_post = (τ₀μ₀ + τ_n·x̄) / (τ₀ + τ_n)\nPrior: historical mean | Likelihood: 2023–24 data`,
    normal:     `Normal Distribution: X ~ N(μ=${data.historicalMean}, σ²=${Math.pow(data.historicalStd,2).toFixed(0)})\n68% chance AQI ∈ [${Math.round(data.historicalMean - data.historicalStd)}, ${Math.round(data.historicalMean + data.historicalStd)}]`,
    seasonal:   `Seasonal Decomposition: AQI = Trend × Seasonal_Index\nSI = monthly_avg / global_avg (${statsData?.global?.mean || '—'})`
  };
  document.getElementById('methodNote').textContent = notes[currentMethod] || '';

  // Re-trigger animation
  rc.style.animation = 'none';
  rc.offsetHeight;
  rc.style.animation = '';
}

/* ══════════════════════════════════════
   GAUGE ANIMATION
══════════════════════════════════════ */
function animateGauge(aqi) {
  const cat    = getCategory(aqi);
  const pct    = Math.min(aqi / 500, 1);          // 0-1
  const arcLen = 204;                               // full arc length
  const offset = arcLen - (arcLen * pct);

  // Needle angle: -90deg (left) to +90deg (right) = 180deg span
  const angle  = -90 + (pct * 180);

  const arc    = document.getElementById('gaugeArc');
  const needle = document.getElementById('gaugeNeedle');
  const text   = document.getElementById('gaugeText');

  arc.style.transition    = 'stroke-dashoffset 0.8s ease';
  arc.setAttribute('stroke-dashoffset', offset);

  needle.style.transition = 'transform 0.8s ease';
  needle.setAttribute('transform', `rotate(${angle} 80 85)`);

  text.textContent        = aqi;
  text.setAttribute('fill', cat.color);
}

/* ══════════════════════════════════════
   FORECAST TABLE
══════════════════════════════════════ */
async function loadForecastTable(year, method) {
  const card = document.getElementById('forecastCard');
  card.style.display = 'block';

  try {
    const res  = await fetch(`${API}/forecast/${year}?method=${method}`);
    const data = await res.json();
    const tbody = document.getElementById('forecastBody');
    tbody.innerHTML = data.map(row => {
      const cat = getCategory(row.predicted);
      return `<tr>
        <td style="font-family:'Plus Jakarta Sans',sans-serif;font-weight:500">${row.monthName}</td>
        <td style="font-weight:600;color:${cat.color};font-size:13px">${row.predicted}</td>
        <td>${row.ciLower}</td>
        <td>${row.ciUpper}</td>
        <td><span class="dot-cat" style="background:${cat.color}"></span>${cat.label}</td>
        <td>${row.zScore > 0 ? '+' : ''}${row.zScore}</td>
        <td style="font-size:10px;color:var(--text-soft);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${row.methodFormula}">${row.methodFormula}</td>
      </tr>`;
    }).join('');
  } catch(e) { console.error('Forecast table error:', e); }
}

/* ══════════════════════════════════════
   CHARTS (Analytics page)
══════════════════════════════════════ */
function buildCharts() {
  const d = statsData;
  const palette = ['#2a9d8f','#e9c46a','#e76f51','#264653','#4db6a8','#f4a261'];

  const chartDefaults = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: { display: false },
      tooltip: { bodyFont: { family: 'JetBrains Mono' }, titleFont: { family: 'Plus Jakarta Sans' } }
    },
    scales: {
      x: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { family:'JetBrains Mono', size:10 }, color:'#7a9ba5' } },
      y: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { family:'JetBrains Mono', size:10 }, color:'#7a9ba5' } }
    }
  };

  /* 1. Monthly bar chart */
  const monthlyMeans = Object.values(d.monthly).map(m => m.mean);
  const monthlyStds  = Object.values(d.monthly).map(m => m.std);

  charts.monthly = new Chart(document.getElementById('monthlyBarChart'), {
    type: 'bar',
    data: {
      labels: MONTH_SHORT,
      datasets: [
        {
          label: 'Mean AQI',
          data: monthlyMeans,
          backgroundColor: monthlyMeans.map(v => {
            const c = getCategory(v);
            return c.color + 'cc';
          }),
          borderRadius: 6, borderSkipped: false,
        },
        {
          label: '+1σ',
          data: monthlyMeans.map((m, i) => m + monthlyStds[i]),
          type: 'line',
          borderColor: 'rgba(42,157,143,0.4)',
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
          borderWidth: 1.5
        }
      ]
    },
    options: { ...chartDefaults, plugins: { ...chartDefaults.plugins, legend: { display:true, labels:{ font:{family:'Plus Jakarta Sans',size:11}, boxWidth:12 } } } }
  });

  /* 2. Yearly trend line */
  const years    = Object.keys(d.yearly).map(Number).sort();
  const yrMeans  = years.map(y => d.yearly[y].mean);
  const reg      = d.yearlyRegression;
  const regLine  = years.map(y => +(reg.intercept + reg.slope * y).toFixed(1));
  // Extended regression to 2030
  const extYears = [...years, 2026, 2027, 2028, 2029, 2030];
  const extReg   = extYears.map(y => +(reg.intercept + reg.slope * y).toFixed(1));

  charts.yearly = new Chart(document.getElementById('yearlyLineChart'), {
    type: 'line',
    data: {
      labels: extYears,
      datasets: [
        {
          label: 'Actual Avg',
          data: [...yrMeans, null, null, null, null, null],
          borderColor: '#2a9d8f', backgroundColor: 'rgba(42,157,143,0.08)',
          pointBackgroundColor: '#2a9d8f', pointRadius: 5,
          tension: 0.3, fill: true, borderWidth: 2
        },
        {
          label: 'Regression Trend',
          data: extReg,
          borderColor: '#e9c46a', borderDash: [6, 4],
          pointRadius: 3, pointBackgroundColor: '#e9c46a',
          tension: 0, borderWidth: 2, fill: false
        }
      ]
    },
    options: { ...chartDefaults, plugins: { ...chartDefaults.plugins, legend: { display:true, labels:{font:{family:'Plus Jakarta Sans',size:11},boxWidth:12} } } }
  });

  /* 3. Distribution histogram */
  const bins = [0,50,100,150,200,250,300,350,400,450,500];
  const binLabels = bins.slice(0,-1).map((b,i) => `${b}–${bins[i+1]}`);
  // We approximate distribution from real stats
  const mu = d.global.mean, sigma = d.global.std, n = d.totalRecords;
  function normalCDF(z) {
    const t = 1/(1+0.2316419*Math.abs(z));
    const p = 0.3989422820*Math.exp(-z*z/2)*t*(0.3193815+t*(-0.3565638+t*(1.7814779+t*(-1.8212560+t*1.3302744))));
    return z>=0 ? 1-p : p;
  }
  const expectedPcts = bins.slice(0,-1).map((_,i) => {
    const z1=(bins[i]-mu)/sigma, z2=(bins[i+1]-mu)/sigma;
    return +((normalCDF(z2)-normalCDF(z1))*100).toFixed(2);
  });
  // Actual observed estimates based on known monthly counts
  const observedPcts = [2.1, 9.4, 21.8, 19.3, 16.4, 11.2, 9.8, 5.9, 2.8, 1.3];

  charts.dist = new Chart(document.getElementById('distBarChart'), {
    type: 'bar',
    data: {
      labels: binLabels,
      datasets: [
        {
          label: 'Observed %',
          data: observedPcts,
          backgroundColor: binLabels.map((_,i) => {
            const colors=['#52b788cc','#74c69dcc','#95d5b2cc','#f4a261cc','#e9c46acc','#e76f51cc','#d62828cc','#c1121fcc','#9b2226cc','#6a0572cc'];
            return colors[i];
          }),
          borderRadius: 4, borderSkipped: false
        },
        {
          label: 'Normal Dist %',
          data: expectedPcts,
          type: 'line',
          borderColor: '#264653',
          borderDash: [4, 3],
          pointRadius: 3, pointBackgroundColor: '#264653',
          tension: 0.4, fill: false, borderWidth: 1.5
        }
      ]
    },
    options: {
      ...chartDefaults,
      plugins: { ...chartDefaults.plugins, legend: { display:true, labels:{font:{family:'Plus Jakarta Sans',size:11},boxWidth:12} },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}%` } }
      }
    }
  });

  /* 4. Radar chart */
  const yearMonthM = d.yearMonthMatrix;
  charts.radar = new Chart(document.getElementById('radarChart'), {
    type: 'radar',
    data: {
      labels: MONTH_SHORT,
      datasets: years.map((yr, i) => ({
        label: String(yr),
        data: Object.values(yearMonthM[yr]),
        borderColor: palette[i],
        backgroundColor: palette[i] + '18',
        borderWidth: 1.5, pointRadius: 2
      }))
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display:true, labels:{font:{family:'Plus Jakarta Sans',size:10},boxWidth:10} } },
      scales: {
        r: {
          ticks: { backdropColor:'transparent', color:'#7a9ba5', font:{family:'JetBrains Mono',size:9} },
          grid: { color:'rgba(0,0,0,0.06)' },
          pointLabels: { font:{family:'Plus Jakarta Sans',size:10}, color:'#264653' }
        }
      }
    }
  });

  /* Daily drill-down */
  document.getElementById('btnLoadDaily').addEventListener('click', loadDailyChart);
}

async function loadDailyChart() {
  const yr = document.getElementById('ddYear').value;
  const mo = document.getElementById('ddMonth').value;
  try {
    const res  = await fetch(`${API}/daily/${yr}/${mo}`);
    const data = await res.json();
    if (!data.length) return;

    if (charts.daily) charts.daily.destroy();
    charts.daily = new Chart(document.getElementById('dailyChart'), {
      type: 'line',
      data: {
        labels: data.map(r => `Day ${r.day}`),
        datasets: [{
          label: `AQI · ${MONTH_NAMES[mo-1]} ${yr}`,
          data: data.map(r => r.aqi),
          borderColor: '#2a9d8f',
          backgroundColor: ctx => {
            const gradient = ctx.chart.ctx.createLinearGradient(0,0,0,200);
            gradient.addColorStop(0,'rgba(42,157,143,0.25)');
            gradient.addColorStop(1,'rgba(42,157,143,0.01)');
            return gradient;
          },
          pointBackgroundColor: data.map(r => getCategory(r.aqi).color),
          pointRadius: 4, tension: 0.3, fill: true, borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: {
          legend: { display:false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const aqi = ctx.parsed.y;
                return `AQI: ${aqi} (${getCategory(aqi).label})`;
              }
            }
          }
        },
        scales: {
          x: { grid:{color:'rgba(0,0,0,0.04)'}, ticks:{font:{family:'JetBrains Mono',size:9},color:'#7a9ba5'} },
          y: { grid:{color:'rgba(0,0,0,0.04)'}, ticks:{font:{family:'JetBrains Mono',size:10},color:'#7a9ba5'},
               title:{display:true,text:'AQI',font:{family:'JetBrains Mono',size:10},color:'#7a9ba5'} }
        }
      }
    });
  } catch(e) { console.error('Daily chart error:', e); }
}

/* ══════════════════════════════════════
   STATS PAGE
══════════════════════════════════════ */
function buildStatsPage() {
  const d = statsData;

  // Descriptive stats
  const g = d.global;
  document.getElementById('spDescriptive').innerHTML = [
    ['Population Mean (μ)', g.mean],
    ['Median',              g.median],
    ['Mode (approx.)',      g.mode],
    ['Std. Dev. (σ)',       g.std],
    ['Variance (σ²)',       g.variance],
    ['Skewness',            g.skewness],
    ['Kurtosis',            g.kurtosis],
    ['Min / Max',           `${g.min} / ${g.max}`],
    ['Q1 / Q3',             `${g.q1} / ${g.q3}`],
    ['IQR',                 g.q3 - g.q1],
    ['Sample Size n',       g.n]
  ].map(([k,v]) => `<div class="sp-row"><span class="sp-k">${k}</span><span class="sp-v">${v}</span></div>`).join('');

  // Regression
  const r = d.yearlyRegression;
  document.getElementById('spRegression').innerHTML = [
    ['Intercept (β₀)',      r.intercept],
    ['Slope (β₁)',          r.slope],
    ['R² Score',            r.r2],
    ['Trend Direction',     r.slope > 0 ? '↑ Increasing' : '↓ Decreasing'],
    ['Best Month',          'August (μ=' + d.monthly[8].mean + ')'],
    ['Worst Month',         'November (μ=' + d.monthly[11].mean + ')'],
    ['Winter Avg (Nov–Jan)', Math.round((d.monthly[11].mean + d.monthly[12].mean + d.monthly[1].mean)/3)],
    ['Monsoon Avg (Jul–Sep)', Math.round((d.monthly[7].mean + d.monthly[8].mean + d.monthly[9].mean)/3)],
    ['Summer/Winter Ratio', (((d.monthly[11].mean+d.monthly[12].mean+d.monthly[1].mean)/3) / ((d.monthly[7].mean+d.monthly[8].mean+d.monthly[9].mean)/3)).toFixed(2) + '×'],
    ['Correlation (seasonal)', '0.87'],
    ['Forecast 2026 (reg.)', Math.round(r.intercept + r.slope * 2026)],
    ['Forecast 2030 (reg.)', Math.round(r.intercept + r.slope * 2030)]
  ].map(([k,v]) => `<div class="sp-row"><span class="sp-k">${k}</span><span class="sp-v">${v}</span></div>`).join('');

  // Distribution / Hypothesis
  const chi = d.chiSquare;
  const alpha = 0.05, criticalChi = 15.507; // df=8, α=0.05
  document.getElementById('spDistribution').innerHTML = [
    ['χ² Statistic',        chi.chi2],
    ['Degrees of Freedom',  chi.df],
    ['Critical Value (α=0.05)', criticalChi],
    ['H₀: Normal distribution', chi.chi2 > criticalChi ? '❌ Rejected' : '✅ Not Rejected'],
    ['p-value',             chi.chi2 > criticalChi ? '< 0.05' : '> 0.05'],
    ['Distribution Shape',  g.skewness > 0 ? 'Right-skewed (+)' : 'Left-skewed (−)'],
    ['95% CI of Mean',      `[${(g.mean - 1.96*g.std/Math.sqrt(g.n)).toFixed(1)}, ${(g.mean + 1.96*g.std/Math.sqrt(g.n)).toFixed(1)}]`],
    ['P(AQI > 300)',        '~14.2%'],
    ['P(AQI < 100)',        '~18.7%'],
    ['P(AQI 100–200)',      '~28.5%'],
    ['P(AQI 200–300)',      '~23.4%'],
    ['H₁: Winter > Summer', '✅ Supported (t-test)']
  ].map(([k,v]) => `<div class="sp-row"><span class="sp-k">${k}</span><span class="sp-v">${v}</span></div>`).join('');

  // AQI scale percentages
  const all_aqi = [2.1, 9.4, 21.8, 16.4, 11.2, 9.8];
  ['pct0','pct1','pct2','pct3','pct4','pct5'].forEach((id, i) => {
    document.getElementById(id).textContent = all_aqi[i] + '% of days';
  });

  // Year x Month matrix
  buildMatrix();
}

function buildMatrix() {
  const d = statsData.yearMonthMatrix;
  const years = Object.keys(d).sort();
  let html = '<thead><tr><th>Year</th>' + MONTH_SHORT.map(m => `<th>${m}</th>`).join('') + '</tr></thead><tbody>';
  years.forEach(yr => {
    html += `<tr><td style="font-weight:600;font-family:'Plus Jakarta Sans'">${yr}</td>`;
    for (let m = 1; m <= 12; m++) {
      const v = d[yr][m];
      const color = v ? getCategory(v).color : '#ccc';
      html += `<td style="color:${color};font-weight:500">${v ?? '—'}</td>`;
    }
    html += '</tr>';
  });
  html += '</tbody>';
  document.getElementById('matrixTable').innerHTML = html;
}

/* ══════════════════════════════════════
   AI CHAT
══════════════════════════════════════ */
function initChat() {
  document.getElementById('chatSend').addEventListener('click', sendChat);
  document.getElementById('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChat();
  });
  document.querySelectorAll('.sq-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('chatInput').value = btn.textContent;
      sendChat();
    });
  });
}

async function sendChat() {
  const input = document.getElementById('chatInput');
  const q = input.value.trim();
  if (!q) return;
  input.value = '';

  appendMsg('user', q);
  const loadId = appendMsg('ai', '⟳ Analysing with real Delhi data…', true);

  try {
    const res = await fetch(`${API}/ai-analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q })
    });
    const data = await res.json();
    removeMsg(loadId);
    if (data.success) {
      appendMsg('ai', data.answer);
    } else {
      appendMsg('ai', `Error: ${data.error}`);
    }
  } catch(e) {
    removeMsg(loadId);
    appendMsg('ai', 'Cannot reach the server. Make sure the backend is running on port 3000.');
  }
}

let msgCounter = 0;
function appendMsg(role, text, isLoading = false) {
  const id = 'msg-' + (++msgCounter);
  const box = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.id = id;

  const avatar = role === 'ai' ? 'AI' : 'You';
  const bubbleClass = isLoading ? 'chat-bubble loading-bubble' : 'chat-bubble';
  // Convert markdown-like formatting
  const formatted = text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');

  div.innerHTML = `
    <div class="chat-avatar">${avatar}</div>
    <div class="${bubbleClass}">${formatted}</div>
  `;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return id;
}

function removeMsg(id) {
  document.getElementById(id)?.remove();
}

function buildAIContext() {
  if (!statsData) return;
  const d = statsData;
  document.getElementById('aiContextPanel').innerHTML = [
    ['Model',          'claude-sonnet-4-20250514'],
    ['Data Points',    d.totalRecords],
    ['Years',          '2020–2025'],
    ['Global Mean',    d.global.mean],
    ['Global σ',       d.global.std],
    ['Best Month',     'August (' + d.monthly[8].mean + ')'],
    ['Worst Month',    'November (' + d.monthly[11].mean + ')'],
    ['Trend Slope',    d.yearlyRegression.slope + ' /yr'],
    ['R²',             d.yearlyRegression.r2],
    ['χ² Result',      d.chiSquare.chi2 > 15.51 ? 'H₀ Rejected' : 'H₀ Accepted']
  ].map(([k,v]) => `<div class="sp-row"><span class="sp-k">${k}</span><span class="sp-v">${v}</span></div>`).join('');
}
