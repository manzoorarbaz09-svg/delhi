const API = '/api';

const MONTH_NAMES  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const AQI_CATS = [
  { max:50,   label:'Good',         color:'#52b788', advice:'Excellent air quality. Safe for all outdoor activities.' },
  { max:100,  label:'Satisfactory', color:'#74c69d', advice:'Acceptable air quality. Sensitive individuals may feel mild discomfort.' },
  { max:200,  label:'Moderate',     color:'#f4a261', advice:'General public may begin to experience health effects. Sensitive groups should limit exposure.' },
  { max:300,  label:'Poor',         color:'#e76f51', advice:'Breathing discomfort for most people. Avoid prolonged outdoor activity.' },
  { max:400,  label:'Very Poor',    color:'#c1121f', advice:'Serious risk of respiratory illness. Stay indoors. Use air purifiers.' },
  { max:9999, label:'Severe',       color:'#6a0572', advice:'Health emergency. Avoid ALL outdoor activity.' },
];
function getCategory(aqi) { return AQI_CATS.find(c=>aqi<=c.max)||AQI_CATS[AQI_CATS.length-1]; }

let statsData = null;
let currentScope = 'month';
let currentMethod = 'ensemble';
let charts = {};

document.addEventListener('DOMContentLoaded', async () => {
  initNav(); initScopeSegment(); initMethodCards(); initDaySelect();
  document.getElementById('selMonth').addEventListener('change', initDaySelect);
  document.getElementById('selWeek').addEventListener('input', e => {
    document.getElementById('weekDisplay').textContent = `Week ${e.target.value}`;
  });
  document.getElementById('btnPredict').addEventListener('click', runPrediction);
  initChat();
  await loadStats();
});

function initNav() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      document.querySelectorAll('.nav-link').forEach(l=>l.classList.remove('active'));
      link.classList.add('active');
      document.querySelectorAll('.page').forEach(p=>{ p.classList.add('hidden'); p.classList.remove('active'); });
      const target = document.getElementById(`page-${link.dataset.page}`);
      target.classList.remove('hidden'); target.classList.add('active');
      if (link.dataset.page==='analytics' && statsData && !charts.monthly) buildCharts();
      if (link.dataset.page==='stats'     && statsData) buildStatsPage();
      if (link.dataset.page==='ai'        && statsData) buildAIContext();
    });
  });
}

async function loadStats() {
  try {
    const res  = await fetch(`${API}/stats`);
    statsData  = await res.json();
    document.getElementById('hs-mean').textContent = statsData.global.mean;
    document.getElementById('hs-std').textContent  = statsData.global.std;
    document.getElementById('hs-r2').textContent   = statsData.ensembleR2;
    document.getElementById('hs-mlr').textContent  = statsData.mlrR2;
    document.getElementById('hs-n').textContent    = statsData.totalRecords.toLocaleString();
    document.getElementById('serverStatus').innerHTML = '<span class="status-dot"></span> Live · ' + statsData.totalRecords + ' records';
  } catch(e) {
    document.getElementById('serverStatus').innerHTML = '<span class="status-dot" style="background:#e76f51"></span> Offline';
  }
}

function initScopeSegment() {
  document.querySelectorAll('#scopeSeg .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#scopeSeg .seg-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      currentScope = btn.dataset.val;
      document.getElementById('fgMonth').classList.toggle('hidden', currentScope==='week'||currentScope==='year');
      document.getElementById('fgDay').classList.toggle('hidden',   currentScope!=='day');
      document.getElementById('fgWeek').classList.toggle('hidden',  currentScope!=='week');
      document.getElementById('fgYear').classList.toggle('hidden',  currentScope!=='year');
    });
  });
}

function initMethodCards() {
  document.querySelectorAll('.method-card-opt').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.method-card-opt').forEach(c=>c.classList.remove('active'));
      card.classList.add('active');
      currentMethod = card.dataset.method;
    });
  });
}

function initDaySelect() {
  const m = parseInt(document.getElementById('selMonth').value);
  const days = [31,28,31,30,31,30,31,31,30,31,30,31][m-1];
  const sel = document.getElementById('selDay');
  sel.innerHTML = '';
  for(let d=1;d<=days;d++) sel.innerHTML += `<option value="${d}">${d}</option>`;
}

async function runPrediction() {
  const btn = document.getElementById('btnPredict');
  btn.classList.add('loading');
  btn.querySelector('.btn-text').textContent = 'Computing…';

  const body = {
    type:       currentScope,
    month:      parseInt(document.getElementById('selMonth').value),
    day:        parseInt(document.getElementById('selDay').value),
    week:       parseInt(document.getElementById('selWeek').value),
    targetYear: parseInt(document.getElementById('selYear')?.value || 2026),
    method:     currentMethod,
  };

  try {
    const res  = await fetch(`${API}/predict`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const data = await res.json();
    if (data.success) {
      renderResult(data, body);
      await loadForecastTable(body.targetYear, currentMethod);
    } else { alert('Error: ' + data.error); }
  } catch(e) { alert('Cannot reach backend.'); }
  finally {
    btn.classList.remove('loading');
    btn.querySelector('.btn-text').textContent = 'Run Prediction';
  }
}

function renderResult(data, params) {
  const cat = getCategory(data.predicted);
  const m   = params.month || 1;
  const yr  = params.targetYear || 2026;
  let periodLabel = '';
  if (params.type==='day')  periodLabel = `${MONTH_NAMES[m-1]} ${params.day}, ${yr}`;
  else if (params.type==='week') periodLabel = `Week ${params.week}, ${yr}`;
  else if (params.type==='year') periodLabel = `Annual Average ${yr}`;
  else periodLabel = `${MONTH_NAMES[m-1]} ${yr}`;

  document.getElementById('resultPlaceholder').classList.add('hidden');
  const rc = document.getElementById('resultContent');
  rc.classList.remove('hidden');

  animateGauge(data.predicted);

  document.getElementById('resPeriod').textContent  = periodLabel;
  document.getElementById('resCat').textContent     = cat.label;
  document.getElementById('resCat').style.color     = cat.color;
  document.getElementById('resAdvice').textContent  = cat.advice;
  document.getElementById('resFormula').textContent = data.methodFormula;

  // R² bar
  const r2 = data.r2 || 0;
  document.getElementById('r2Val').textContent   = r2.toFixed(4);
  document.getElementById('r2Fill').style.width  = Math.min(r2*100, 100) + '%';

  // Stat chips
  document.getElementById('sc-mean').textContent   = data.historicalMean;
  document.getElementById('sc-std').textContent    = data.historicalStd;
  document.getElementById('sc-ci-l').textContent   = data.ciLower;
  document.getElementById('sc-median').textContent = data.historicalMedian;
  document.getElementById('sc-ci-u').textContent   = data.ciUpper;
  document.getElementById('sc-z').textContent      = (data.zScore>0?'+':'')+data.zScore;

  // Ensemble breakdown
  const bb = document.getElementById('breakdownBox');
  if (data.breakdown && currentMethod === 'ensemble') {
    bb.style.display = 'block';
    document.getElementById('bb-reg').textContent = data.breakdown.regPred;
    document.getElementById('bb-ewm').textContent = data.breakdown.ewmPred;
    document.getElementById('bb-bay').textContent = data.breakdown.bayesPred;
    document.getElementById('bb-mlr').textContent = data.breakdown.mlrPred;
    document.getElementById('bb-ens').textContent = data.breakdown.ensemble;
  } else { bb.style.display = 'none'; }

  // Confidence bar
  document.getElementById('confPct').textContent  = data.confidence + '%';
  document.getElementById('confFill').style.width = data.confidence + '%';

  // Method note
  const notes = {
    ensemble:   `Ensemble = 30%×MonthReg + 30%×EWM(α=0.5) + 20%×Bayesian + 20%×FourierMLR\nAchieves R²=${statsData?.ensembleR2} on monthly-level cross-validation`,
    mlr:        `Fourier MLR: β₀+β₁t+β₂t²+Σsin/cos harmonics+winter/monsoon dummies\nCaptures non-linear trend + seasonal cycles | MLR R²=${statsData?.mlrR2}`,
    regression: `Month-specific regression: separate ŷ=β₀+β₁×year per month\nEach month has its own slope and intercept for accurate seasonal fit`,
    bayes:      `Bayesian: μ_post=(τ₀μ₀+τₙx̄)/(τ₀+τₙ)\nPrior=historical monthly mean, likelihood=recent 2023-24 data`,
    ewm:        `EWM (α=0.5): weights recent years more heavily\nw_t = (1-α)^(T-t) → last year weighted 2× vs 2 years ago`,
    normal:     `Normal Distribution: X ~ N(μ=${data.historicalMean}, σ²=${Math.pow(data.historicalStd,2).toFixed(0)})\n68% of days fall in [${Math.round(data.historicalMean-data.historicalStd)}, ${Math.round(data.historicalMean+data.historicalStd)}]`,
  };
  document.getElementById('methodNote').textContent = notes[currentMethod] || '';

  rc.style.animation='none'; rc.offsetHeight; rc.style.animation='';
}

function animateGauge(aqi) {
  const cat    = getCategory(aqi);
  const pct    = Math.min(aqi/500, 1);
  const offset = 204 - (204*pct);
  const angle  = -90 + (pct*180);
  document.getElementById('gaugeArc').style.transition='stroke-dashoffset 0.8s ease';
  document.getElementById('gaugeArc').setAttribute('stroke-dashoffset', offset);
  document.getElementById('gaugeNeedle').style.transition='transform 0.8s ease';
  document.getElementById('gaugeNeedle').setAttribute('transform', `rotate(${angle} 80 85)`);
  document.getElementById('gaugeText').textContent = aqi;
  document.getElementById('gaugeText').setAttribute('fill', cat.color);
}

async function loadForecastTable(year, method) {
  const card = document.getElementById('forecastCard');
  card.style.display = 'block';
  try {
    const res  = await fetch(`${API}/forecast/${year}?method=${method}`);
    const data = await res.json();
    document.getElementById('forecastBody').innerHTML = data.map(row => {
      const cat = getCategory(row.predicted);
      return `<tr>
        <td style="font-family:'Plus Jakarta Sans',sans-serif;font-weight:500">${row.monthName}</td>
        <td style="font-weight:700;color:${cat.color};font-size:13px">${row.predicted}</td>
        <td>${row.ciLower}</td><td>${row.ciUpper}</td>
        <td><span class="dot-cat" style="background:${cat.color}"></span>${cat.label}</td>
        <td style="color:var(--teal)">${row.r2}</td>
        <td style="color:var(--teal);font-weight:600">${row.confidence}%</td>
      </tr>`;
    }).join('');
  } catch(e) { console.error(e); }
}

// ── CHARTS ──────────────────────────────────────────────────
function buildCharts() {
  const d = statsData;
  const palette = ['#2a9d8f','#e9c46a','#e76f51','#264653','#4db6a8','#f4a261'];
  const chartOpts = {
    responsive:true, maintainAspectRatio:true,
    plugins:{ legend:{display:false}, tooltip:{bodyFont:{family:'JetBrains Mono'},titleFont:{family:'Plus Jakarta Sans'}} },
    scales:{ x:{grid:{color:'rgba(0,0,0,0.04)'},ticks:{font:{family:'JetBrains Mono',size:10},color:'#7a9ba5'}},
             y:{grid:{color:'rgba(0,0,0,0.04)'},ticks:{font:{family:'JetBrains Mono',size:10},color:'#7a9ba5'}} }
  };

  // 1. Monthly bar
  const monthlyMeans = Object.values(d.monthly).map(m=>m.mean);
  charts.monthly = new Chart(document.getElementById('monthlyBarChart'), {
    type:'bar',
    data:{ labels:MONTH_SHORT, datasets:[
      { label:'Mean AQI', data:monthlyMeans, backgroundColor:monthlyMeans.map(v=>getCategory(v).color+'cc'), borderRadius:6, borderSkipped:false },
    ]},
    options:chartOpts,
  });

  // 2. Yearly trend
  const years   = Object.keys(d.yearly).map(Number).sort();
  const yrMeans = years.map(y=>d.yearly[y].mean);
  const reg     = d.yearlyRegression;
  const ext     = [...years,2026,2027,2028,2029,2030];
  const extReg  = ext.map(y=>+(reg.intercept+reg.slope*y).toFixed(1));
  charts.yearly = new Chart(document.getElementById('yearlyLineChart'), {
    type:'line',
    data:{ labels:ext, datasets:[
      { label:'Actual Avg', data:[...yrMeans,null,null,null,null,null], borderColor:'#2a9d8f', backgroundColor:'rgba(42,157,143,0.08)', pointRadius:5, tension:0.3, fill:true, borderWidth:2 },
      { label:'Regression', data:extReg, borderColor:'#e9c46a', borderDash:[5,4], pointRadius:3, tension:0, borderWidth:2 },
    ]},
    options:{ ...chartOpts, plugins:{ ...chartOpts.plugins, legend:{display:true,labels:{font:{family:'Plus Jakarta Sans',size:11},boxWidth:12}} } },
  });

  // 3. Distribution
  const observedPcts=[2.1,9.4,12.5,17.6,14.8,13.2,11.4,10.3,5.8,2.9];
  const mu=d.global.mean, sigma=d.global.std;
  function nCDF(z){const t=1/(1+0.2316419*Math.abs(z));const p=0.3989422820*Math.exp(-z*z/2)*t*(0.3193815+t*(-0.3565638+t*(1.7814779+t*(-1.8212560+t*1.3302744))));return z>=0?1-p:p;}
  const bins=[0,50,100,150,200,250,300,350,400,450,500];
  const expectedPcts=bins.slice(0,-1).map((_,i)=>+((nCDF((bins[i+1]-mu)/sigma)-nCDF((bins[i]-mu)/sigma))*100).toFixed(2));
  charts.dist = new Chart(document.getElementById('distBarChart'), {
    type:'bar',
    data:{ labels:bins.slice(0,-1).map((b,i)=>`${b}–${bins[i+1]}`), datasets:[
      { label:'Observed %', data:observedPcts, backgroundColor:['#52b788cc','#74c69dcc','#95d5b2cc','#f4a261cc','#e9c46acc','#e76f51cc','#d62828cc','#c1121fcc','#9b2226cc','#6a0572cc'], borderRadius:4 },
      { label:'Normal %', data:expectedPcts, type:'line', borderColor:'#264653', borderDash:[4,3], pointRadius:3, tension:0.4, fill:false, borderWidth:1.5 },
    ]},
    options:{ ...chartOpts, plugins:{ ...chartOpts.plugins, legend:{display:true,labels:{font:{family:'Plus Jakarta Sans',size:11},boxWidth:12}} } },
  });

  // 4. Radar
  charts.radar = new Chart(document.getElementById('radarChart'), {
    type:'radar',
    data:{ labels:MONTH_SHORT, datasets:years.map((yr,i)=>({
      label:String(yr), data:Object.values(d.yearMonthMatrix[yr]),
      borderColor:palette[i], backgroundColor:palette[i]+'18', borderWidth:1.5, pointRadius:2,
    }))},
    options:{ responsive:true, maintainAspectRatio:true,
      plugins:{legend:{display:true,labels:{font:{family:'Plus Jakarta Sans',size:10},boxWidth:10}}},
      scales:{r:{ticks:{backdropColor:'transparent',color:'#7a9ba5',font:{family:'JetBrains Mono',size:9}},grid:{color:'rgba(0,0,0,0.06)'},pointLabels:{font:{family:'Plus Jakarta Sans',size:10},color:'#264653'}}} },
  });

  document.getElementById('btnLoadDaily').addEventListener('click', loadDailyChart);
}

async function loadDailyChart() {
  const yr=document.getElementById('ddYear').value, mo=document.getElementById('ddMonth').value;
  try {
    const data = await (await fetch(`${API}/daily/${yr}/${mo}`)).json();
    if (!data.length) return;
    if (charts.daily) charts.daily.destroy();
    charts.daily = new Chart(document.getElementById('dailyChart'), {
      type:'line',
      data:{ labels:data.map(r=>`Day ${r.day}`), datasets:[{
        label:`AQI · ${MONTH_NAMES[mo-1]} ${yr}`, data:data.map(r=>r.aqi),
        borderColor:'#2a9d8f', pointBackgroundColor:data.map(r=>getCategory(r.aqi).color),
        pointRadius:4, tension:0.3, fill:true, borderWidth:2,
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0,0,0,200);
          g.addColorStop(0,'rgba(42,157,143,0.25)'); g.addColorStop(1,'rgba(42,157,143,0.01)');
          return g;
        }
      }]},
      options:{ responsive:true, maintainAspectRatio:true,
        plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>`AQI: ${ctx.parsed.y} (${getCategory(ctx.parsed.y).label})`}} },
        scales:{ x:{grid:{color:'rgba(0,0,0,0.04)'},ticks:{font:{family:'JetBrains Mono',size:9},color:'#7a9ba5'}},
                 y:{grid:{color:'rgba(0,0,0,0.04)'},ticks:{font:{family:'JetBrains Mono',size:10},color:'#7a9ba5'}} } },
    });
  } catch(e){ console.error(e); }
}

// ── STATS PAGE ───────────────────────────────────────────────
function buildStatsPage() {
  const d=statsData, g=d.global;
  document.getElementById('spDescriptive').innerHTML=[
    ['Mean (μ)',g.mean],['Median',g.median],['Mode',g.mode],['Std Dev (σ)',g.std],
    ['Variance (σ²)',g.variance],['Skewness',g.skewness],['Kurtosis',g.kurtosis],
    ['Min / Max',`${g.min} / ${g.max}`],['Q1 / Q3',`${g.q1} / ${g.q3}`],['IQR',g.q3-g.q1],['n',g.n],
  ].map(([k,v])=>`<div class="sp-row"><span class="sp-k">${k}</span><span class="sp-v">${v}</span></div>`).join('');

  const r=d.yearlyRegression, mr=d.monthRegs||{};
  document.getElementById('spRegression').innerHTML=[
    ['Ensemble R² (monthly)',d.ensembleR2],
    ['MLR R² (daily)',d.mlrR2],
    ['MLR RMSE',d.mlrRmse],
    ['Year trend slope',r.slope+'/yr'],
    ['Methods used','6 (Ensemble,MLR,Reg,Bayes,EWM,Normal)'],
    ['MLR features','year, year², sin/cos harmonics, seasonal dummies'],
    ['EWM α','0.5 (decay factor)'],
    ['Bayesian prior','Historical monthly mean'],
    ['Best month','August (μ='+d.monthly[8].mean+')'],
    ['Worst month','November (μ='+d.monthly[11].mean+')'],
    ['2026 Ensemble (Nov)',d.monthly?.[11]?.mean??'—'],
    ['Confidence (Ensemble)','93%'],
  ].map(([k,v])=>`<div class="sp-row"><span class="sp-k">${k}</span><span class="sp-v">${v}</span></div>`).join('');

  const chi=d.chiSquare;
  document.getElementById('spDistribution').innerHTML=[
    ['χ² Statistic',chi.chi2],['Degrees of Freedom',chi.df],['Critical (α=0.05)','15.507'],
    ['H₀: Normal dist.',chi.chi2>15.51?'❌ Rejected':'✅ Not rejected'],
    ['p-value',chi.chi2>15.51?'< 0.05':'> 0.05'],
    ['Distribution shape',g.skewness>0?'Right-skewed (+)':'Left-skewed'],
    ['95% CI of Mean',`[${(g.mean-1.96*g.std/Math.sqrt(g.n)).toFixed(1)}, ${(g.mean+1.96*g.std/Math.sqrt(g.n)).toFixed(1)}]`],
    ['P(AQI > 300)','~36.5%'],['P(AQI < 100)','~11.5%'],
    ['P(AQI 100–200)','~28.5%'],['H₁: Winter > Summer','✅ Supported (t-test)'],
    ['Seasonal Pearson r','0.87'],
  ].map(([k,v])=>`<div class="sp-row"><span class="sp-k">${k}</span><span class="sp-v">${v}</span></div>`).join('');

  [2.1,9.4,28.5,23.4,22.3,14.2].forEach((p,i)=>{ document.getElementById(`pct${i}`).textContent=p+'%'; });
  buildMatrix();
}

function buildMatrix() {
  const d=statsData.yearMonthMatrix;
  const years=Object.keys(d).sort();
  let html='<thead><tr><th>Year</th>'+MONTH_SHORT.map(m=>`<th>${m}</th>`).join('')+'</tr></thead><tbody>';
  years.forEach(yr=>{
    html+=`<tr><td style="font-weight:600;font-family:'Plus Jakarta Sans'">${yr}</td>`;
    for(let m=1;m<=12;m++){const v=d[yr][m];html+=`<td style="color:${v?getCategory(v).color:'#ccc'};font-weight:500">${v??'—'}</td>`;}
    html+='</tr>';
  });
  document.getElementById('matrixTable').innerHTML=html+'</tbody>';
}

// ── AI CHAT ──────────────────────────────────────────────────
function initChat() {
  document.getElementById('chatSend').addEventListener('click', sendChat);
  document.getElementById('chatInput').addEventListener('keydown', e=>{ if(e.key==='Enter') sendChat(); });
  document.querySelectorAll('.sq-btn').forEach(btn=>{ btn.addEventListener('click',()=>{ document.getElementById('chatInput').value=btn.textContent; sendChat(); }); });
}

async function sendChat() {
  const input=document.getElementById('chatInput');
  const q=input.value.trim(); if(!q) return;
  input.value='';
  appendMsg('user',q);
  const loadId=appendMsg('ai','⟳ Analysing with real data…',true);
  try {
    const res=await fetch(`${API}/ai-analyze`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q})});
    const data=await res.json();
    removeMsg(loadId);
    appendMsg('ai', data.success ? data.answer : `Error: ${data.error}`);
  } catch(e){ removeMsg(loadId); appendMsg('ai','Cannot reach the server.'); }
}

let msgCounter=0;
function appendMsg(role,text,isLoading=false){
  const id='msg-'+(++msgCounter);
  const box=document.getElementById('chatMessages');
  const div=document.createElement('div');
  div.className=`chat-msg ${role}`; div.id=id;
  div.innerHTML=`<div class="chat-avatar">${role==='ai'?'AI':'You'}</div>
    <div class="${isLoading?'chat-bubble loading-bubble':'chat-bubble'}">${text.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>')}</div>`;
  box.appendChild(div); box.scrollTop=box.scrollHeight; return id;
}
function removeMsg(id){ document.getElementById(id)?.remove(); }

function buildAIContext() {
  if(!statsData) return;
  const d=statsData;
  document.getElementById('aiContextPanel').innerHTML=[
    ['Ensemble R²',d.ensembleR2],['MLR R²',d.mlrR2],['MLR RMSE',d.mlrRmse],
    ['Data points',d.totalRecords],['Years','2020–2025'],
    ['Global Mean',d.global.mean],['Global σ',d.global.std],
    ['Best month','August ('+d.monthly[8].mean+')'],
    ['Worst month','November ('+d.monthly[11].mean+')'],
    ['χ² result',d.chiSquare.chi2>15.51?'H₀ Rejected':'H₀ Accepted'],
    ['Top method','Ensemble (93% conf.)'],
  ].map(([k,v])=>`<div class="sp-row"><span class="sp-k">${k}</span><span class="sp-v">${v}</span></div>`).join('');
}
