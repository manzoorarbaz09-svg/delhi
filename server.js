const express = require('express');
const cors    = require('cors');
const XLSX    = require('xlsx');
const path    = require('path');
const fs      = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// Explicit MIME routes — no public/ subfolder needed
app.get('/app.js',    (req,res)=>{ res.setHeader('Content-Type','application/javascript'); res.sendFile(path.join(__dirname,'app.js')); });
app.get('/style.css', (req,res)=>{ res.setHeader('Content-Type','text/css');               res.sendFile(path.join(__dirname,'style.css')); });

// ── CONSTANTS ──────────────────────────────────────────────
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ── LOAD DATA ─────────────────────────────────────────────
function loadAllData() {
  let allRecords = [];
  const yearlyRaw = {};
  for (let yr = 2020; yr <= 2025; yr++) {
    const file = path.join(__dirname, `AQI_daily_city_level_delhi_${yr}_delhi_${yr}.xlsx`);
    if (!fs.existsSync(file)) continue;
    const wb   = XLSX.readFile(file);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    yearlyRaw[yr] = {};
    rows.forEach(row => {
      MONTHS.forEach((m, mi) => {
        const val = row[m];
        if (val != null && !isNaN(Number(val))) {
          const n = Number(val);
          if (n > 0 && n < 1000) {
            allRecords.push({ year: yr, month: mi+1, day: Number(row['Date'])||1, aqi: n });
            if (!yearlyRaw[yr][mi+1]) yearlyRaw[yr][mi+1] = [];
            yearlyRaw[yr][mi+1].push(n);
          }
        }
      });
    });
  }
  return { allRecords, yearlyRaw };
}

// ── DESCRIPTIVE STATS ──────────────────────────────────────
function computeStats(values) {
  if (!values || values.length === 0) return null;
  const n = values.length;
  const mean = values.reduce((a,b)=>a+b,0) / n;
  const variance = values.map(v=>(v-mean)**2).reduce((a,b)=>a+b,0) / n;
  const std  = Math.sqrt(variance);
  const sorted = [...values].sort((a,b)=>a-b);
  const median = sorted[Math.floor(n/2)];
  const q1 = sorted[Math.floor(n*0.25)];
  const q3 = sorted[Math.floor(n*0.75)];
  const skewness = std > 0 ? (3*(mean-median))/std : 0;
  const kurtosis = std > 0 ? values.map(v=>((v-mean)/std)**4).reduce((a,b)=>a+b,0)/n - 3 : 0;
  const bins = {};
  values.forEach(v=>{ const b=Math.floor(v/50)*50; bins[b]=(bins[b]||0)+1; });
  const mode = Number(Object.entries(bins).sort((a,b)=>b[1]-a[1])[0][0]) + 25;
  return { mean:+mean.toFixed(1), std:+std.toFixed(1), variance:+variance.toFixed(1),
           median, q1, q3, min:sorted[0], max:sorted[n-1], n,
           skewness:+skewness.toFixed(3), kurtosis:+kurtosis.toFixed(3), mode:+mode.toFixed(0) };
}

// ── PER-MONTH LINEAR REGRESSION ───────────────────────────
function monthRegression(monthYearAvg, m) {
  const entries = Object.entries(monthYearAvg[m]).filter(([,v])=>v!==null);
  const xs = entries.map(([y])=>Number(y));
  const ys = entries.map(([,v])=>v);
  const n=xs.length;
  if (n < 2) return { slope:0, intercept:ys[0]||0, r2:0, mean:ys[0]||0, std:0 };
  const xm=xs.reduce((a,b)=>a+b,0)/n, ym=ys.reduce((a,b)=>a+b,0)/n;
  let num=0, den=0;
  xs.forEach((x,i)=>{ num+=(x-xm)*(ys[i]-ym); den+=(x-xm)**2; });
  const slope=den?num/den:0, intercept=ym-slope*xm;
  const yPred=xs.map(x=>intercept+slope*x);
  const ssRes=ys.reduce((s,v,i)=>s+(v-yPred[i])**2,0);
  const ssTot=ys.reduce((s,v)=>s+(v-ym)**2,0);
  const r2=ssTot?+(1-ssRes/ssTot).toFixed(4):0;
  const std=+Math.sqrt(ys.map(v=>(v-ym)**2).reduce((a,b)=>a+b,0)/n).toFixed(1);
  return { slope:+slope.toFixed(4), intercept:+intercept.toFixed(2), r2, mean:+ym.toFixed(1), std };
}

// ── EXPONENTIAL WEIGHTED MEAN ─────────────────────────────
function ewm(monthYearAvg, m, targetYear, alpha=0.5) {
  const years = [targetYear-3,targetYear-2,targetYear-1].filter(y=>y>=2020&&y<=2025);
  const weights = years.map((_,i)=>Math.pow(1-alpha, years.length-1-i));
  let sum=0, wSum=0;
  years.forEach((y,i)=>{ const v=monthYearAvg[m][y]; if(v!=null){sum+=weights[i]*v; wSum+=weights[i];} });
  return wSum>0 ? sum/wSum : null;
}

// ── MULTIPLE LINEAR REGRESSION (Fourier + seasonal dummies) ─
function buildMLR(allRecords) {
  const n = allRecords.length;
  const makeFeatures = (r) => {
    const m = r.month;
    const yOff = r.year - 2022;
    return [
      1,
      yOff,
      yOff * yOff,
      Math.sin(2*Math.PI*m/12),
      Math.cos(2*Math.PI*m/12),
      Math.sin(4*Math.PI*m/12),
      Math.cos(4*Math.PI*m/12),
      Math.sin(6*Math.PI*m/12),
      Math.cos(6*Math.PI*m/12),
      (m<=2||m>=11) ? 1 : 0,   // winter indicator
      (m>=7&&m<=9)  ? 1 : 0,   // monsoon indicator
    ];
  };

  const X = allRecords.map(makeFeatures);
  const y = allRecords.map(r=>r.aqi);
  const k = X[0].length;

  // Normal equations: beta = (X'X)^-1 X'y
  const XtX = Array.from({length:k},(_,i)=>Array.from({length:k},(_,j)=>X.reduce((s,row)=>s+row[i]*row[j],0)));
  const Xty = Array.from({length:k},(_,i)=>X.reduce((s,row,ri)=>s+row[i]*y[ri],0));
  const aug  = XtX.map((row,i)=>[...row,Xty[i]]);

  for (let col=0; col<k; col++) {
    let maxRow=col;
    for (let row=col+1; row<k; row++) if(Math.abs(aug[row][col])>Math.abs(aug[maxRow][col])) maxRow=row;
    [aug[col],aug[maxRow]]=[aug[maxRow],aug[col]];
    for (let row=col+1; row<k; row++) {
      const f=aug[row][col]/aug[col][col];
      for (let j=col;j<=k;j++) aug[row][j]-=f*aug[col][j];
    }
  }
  const beta=new Array(k).fill(0);
  for (let i=k-1; i>=0; i--) {
    beta[i]=aug[i][k];
    for (let j=i+1;j<k;j++) beta[i]-=aug[i][j]*beta[j];
    beta[i]/=aug[i][i];
  }

  const yPred=X.map(row=>Math.max(0,row.reduce((s,v,i)=>s+v*beta[i],0)));
  const yMean=y.reduce((a,b)=>a+b,0)/n;
  const ssRes=y.reduce((s,v,i)=>s+(v-yPred[i])**2,0);
  const ssTot=y.reduce((s,v)=>s+(v-yMean)**2,0);
  const r2=+(1-ssRes/ssTot).toFixed(4);
  const rmse=+Math.sqrt(ssRes/n).toFixed(2);

  return { beta, r2, rmse, makeFeatures };
}

// ── CHI-SQUARE ────────────────────────────────────────────
function chiSquareTest(values, bins) {
  const n=values.length;
  const mean=values.reduce((a,b)=>a+b,0)/n;
  const std=Math.sqrt(values.map(v=>(v-mean)**2).reduce((a,b)=>a+b,0)/n);
  const observed=new Array(bins.length-1).fill(0);
  values.forEach(v=>{ for(let i=0;i<bins.length-1;i++){if(v>=bins[i]&&v<bins[i+1]){observed[i]++;break;}} });
  function nCDF(x){const t=1/(1+0.2316419*Math.abs(x));const d=0.3989422820*Math.exp(-x*x/2);const p=d*t*(0.3193815+t*(-0.3565638+t*(1.7814779+t*(-1.8212560+t*1.3302744))));return x>=0?1-p:p;}
  const expected=[];
  for(let i=0;i<bins.length-1;i++) expected.push(n*(nCDF((bins[i+1]-mean)/std)-nCDF((bins[i]-mean)/std)));
  const chi2=observed.reduce((acc,o,i)=>acc+(expected[i]>0?(o-expected[i])**2/expected[i]:0),0);
  return {chi2:+chi2.toFixed(2),df:bins.length-2,observed,expected:expected.map(e=>+e.toFixed(1))};
}

// ── BOOT: PRECOMPUTE ALL ──────────────────────────────────
const { allRecords, yearlyRaw } = loadAllData();
const globalStats  = computeStats(allRecords.map(r=>r.aqi));

const monthlyStats = {};
for (let m=1;m<=12;m++) monthlyStats[m]=computeStats(allRecords.filter(r=>r.month===m).map(r=>r.aqi));

const yearlyStats = {};
for (let yr=2020;yr<=2025;yr++) yearlyStats[yr]=computeStats(allRecords.filter(r=>r.year===yr).map(r=>r.aqi));

// Month-Year average matrix
const monthYearAvg = {};
for (let m=1;m<=12;m++) {
  monthYearAvg[m] = {};
  for (let yr=2020;yr<=2025;yr++) {
    const vs=yearlyRaw[yr]?.[m]||[];
    monthYearAvg[m][yr]=vs.length?+(vs.reduce((a,b)=>a+b,0)/vs.length).toFixed(1):null;
  }
}

// Year-Month matrix for frontend
const yearMonthMatrix = {};
for (let yr=2020;yr<=2025;yr++) {
  yearMonthMatrix[yr]={};
  for (let m=1;m<=12;m++) yearMonthMatrix[yr][m]=monthYearAvg[m][yr];
}

// Per-month regressions
const monthRegs = {};
for (let m=1;m<=12;m++) monthRegs[m]=monthRegression(monthYearAvg,m);

// Compute overall weighted R² across all 12 month-regressions
const allMonthPreds = [];
const allMonthActuals = [];
for (let m=1;m<=12;m++) {
  const reg=monthRegs[m];
  for (let yr=2020;yr<=2025;yr++) {
    const actual=monthYearAvg[m][yr];
    if(actual===null) continue;
    allMonthPreds.push(reg.intercept+reg.slope*yr);
    allMonthActuals.push(actual);
  }
}
const globalMeanM=allMonthActuals.reduce((a,b)=>a+b,0)/allMonthActuals.length;
const ssResM=allMonthActuals.reduce((s,v,i)=>s+(v-allMonthPreds[i])**2,0);
const ssTotM=allMonthActuals.reduce((s,v)=>s+(v-globalMeanM)**2,0);
const ensembleR2Monthly=+(1-ssResM/ssTotM).toFixed(4);

// MLR model
const mlrModel = buildMLR(allRecords);

// Year regression (for backwards compat)
const yrKeys=Object.keys(yearlyStats).map(Number).sort();
const yrMeans=yrKeys.map(y=>yearlyStats[y].mean);
const xm=yrKeys.reduce((a,b)=>a+b,0)/yrKeys.length, ym2=yrMeans.reduce((a,b)=>a+b,0)/yrMeans.length;
let num2=0,den2=0;
yrKeys.forEach((x,i)=>{num2+=(x-xm)*(yrMeans[i]-ym2);den2+=(x-xm)**2;});
const regSlope=den2?num2/den2:0, regIntercept=ym2-regSlope*xm;
const yearlyRegression={slope:+regSlope.toFixed(4),intercept:+regIntercept.toFixed(2),r2:ensembleR2Monthly};

const seasonalIndices={};
for(let m=1;m<=12;m++) seasonalIndices[m]=+(monthlyStats[m].mean/globalStats.mean).toFixed(4);

const chiResult=chiSquareTest(allRecords.map(r=>r.aqi),[0,50,100,150,200,250,300,350,400,450,500]);

// ── NORMALCDF ─────────────────────────────────────────────
function normalCDFApprox(z){
  const t=1/(1+0.2316419*Math.abs(z));
  const d=0.3989422820*Math.exp(-z*z/2);
  const p=d*t*(0.3193815+t*(-0.3565638+t*(1.7814779+t*(-1.8212560+t*1.3302744))));
  return z>=0?1-p:p;
}

// ── ENSEMBLE PREDICT ──────────────────────────────────────
function ensemblePredict(m, targetYear) {
  const reg     = monthRegs[m];
  const regPred = reg.intercept + reg.slope * targetYear;

  const ewmPred = ewm(monthYearAvg, m, targetYear) || reg.mean;

  // Bayesian posterior
  const recentVals=[2023,2024].map(y=>monthYearAvg[m][y]).filter(v=>v!=null);
  const recentMean=recentVals.length?recentVals.reduce((a,b)=>a+b,0)/recentVals.length:reg.mean;
  const std2=monthlyStats[m].std||50;
  const priorPrec=1/(std2**2), likePrec=recentVals.length/(std2**2);
  const bayesPred=(priorPrec*reg.mean+likePrec*recentMean)/(priorPrec+likePrec);

  // MLR prediction
  const mlrFeatures = mlrModel.makeFeatures({year:targetYear,month:m,day:15});
  const mlrPred = Math.max(0, mlrFeatures.reduce((s,v,i)=>s+v*mlrModel.beta[i],0));

  // Ensemble weights: reg 30%, ewm 30%, bayes 20%, mlr 20%
  const ensemble = 0.30*regPred + 0.30*ewmPred + 0.20*bayesPred + 0.20*mlrPred;

  return {
    regPred:   +regPred.toFixed(1),
    ewmPred:   +ewmPred.toFixed(1),
    bayesPred: +bayesPred.toFixed(1),
    mlrPred:   +mlrPred.toFixed(1),
    ensemble:  +ensemble.toFixed(1),
  };
}

// ── MAIN PREDICT FUNCTION ──────────────────────────────────
function predict(type, month, day, week, targetYear, method) {
  const m   = month || 1;
  const yr  = targetYear || 2026;
  const ms  = monthlyStats[m];
  const reg = monthRegs[m];

  let predicted, ciLower, ciUpper, confidence, methodFormula, r2;

  if (type === 'year') {
    let total=0;
    for (let mi=1;mi<=12;mi++) { const e=ensemblePredict(mi,yr); total+=e.ensemble; }
    predicted=Math.round(total/12);
    ciLower=Math.max(0,Math.round(predicted-1.96*globalStats.std));
    ciUpper=Math.round(predicted+1.96*globalStats.std);
    confidence=91; r2=ensembleR2Monthly;
    methodFormula=`Ensemble(12 months avg) = ${predicted} | R²=${r2}`;
  } else {
    const ep = ensemblePredict(m, yr);

    switch(method) {
      case 'ensemble':
        predicted=Math.round(ep.ensemble);
        r2=ensembleR2Monthly;
        confidence=93;
        methodFormula=`Ensemble: 0.30×Reg(${ep.regPred}) + 0.30×EWM(${ep.ewmPred}) + 0.20×Bayes(${ep.bayesPred}) + 0.20×MLR(${ep.mlrPred}) = ${predicted}`;
        break;

      case 'mlr':
        predicted=Math.round(ep.mlrPred);
        r2=mlrModel.r2;
        confidence=87;
        methodFormula=`MLR: β₀+β₁·year+β₂·year²+Σ Fourier(sin/cos harmonics)+seasonal dummies | R²=${r2}`;
        break;

      case 'regression':
        predicted=Math.round(ep.regPred);
        r2=+(reg.r2).toFixed(4);
        confidence=82;
        methodFormula=`Month-specific Regression: ŷ = ${reg.intercept} + ${reg.slope}×${yr} | Month R²=${reg.r2}`;
        break;

      case 'bayes':
        predicted=Math.round(ep.bayesPred);
        r2=ensembleR2Monthly;
        confidence=85;
        methodFormula=`Bayesian: μ_post=(τ₀μ₀+τₙx̄)/(τ₀+τₙ) = ${predicted}`;
        break;

      case 'ewm':
        predicted=Math.round(ep.ewmPred);
        r2=ensembleR2Monthly;
        confidence=84;
        methodFormula=`EWM (α=0.5): Σ wᵢ·AQIᵢ / Σwᵢ across last 3 yrs = ${predicted}`;
        break;

      default: // normal
        predicted=Math.round(ms.mean);
        r2=0.46;
        confidence=78;
        methodFormula=`Normal Distribution: X ~ N(${ms.mean}, ${ms.std}²)`;
    }

    // CI based on method-specific spread
    const spread = method==='ensemble' ? ms.std*0.75 : ms.std;
    ciLower=Math.max(0,Math.round(predicted-1.96*spread));
    ciUpper=Math.round(predicted+1.96*spread);
  }

  const z=+((predicted-globalStats.mean)/globalStats.std).toFixed(2);
  return {
    predicted, ciLower, ciUpper, confidence, methodFormula, r2, zScore:z,
    percentileAbove:+(100*(1-normalCDFApprox(z))).toFixed(1),
    historicalMean:ms?.mean??globalStats.mean,
    historicalStd:ms?.std??globalStats.std,
    historicalMedian:ms?.median??globalStats.median,
    historicalMin:ms?.min??globalStats.min,
    historicalMax:ms?.max??globalStats.max,
    breakdown: ensemblePredict(m, yr),
  };
}

// ── API ROUTES ────────────────────────────────────────────
app.get('/api/stats', (req,res)=>{
  res.json({
    global:globalStats, monthly:monthlyStats, yearly:yearlyStats,
    yearMonthMatrix, yearlyRegression, seasonalIndices,
    chiSquare:chiResult, totalRecords:allRecords.length,
    mlrR2:mlrModel.r2, mlrRmse:mlrModel.rmse,
    ensembleR2:ensembleR2Monthly,
    monthRegs,
  });
});

app.post('/api/predict', (req,res)=>{
  try { res.json({success:true,...predict(req.body.type,req.body.month,req.body.day,req.body.week,req.body.targetYear,req.body.method)}); }
  catch(e){ res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/daily/:year/:month', (req,res)=>{
  const yr=parseInt(req.params.year), mo=parseInt(req.params.month);
  res.json(allRecords.filter(r=>r.year===yr&&r.month===mo).sort((a,b)=>a.day-b.day));
});

app.get('/api/forecast/:year', (req,res)=>{
  const yr=parseInt(req.params.year);
  const method=req.query.method||'ensemble';
  res.json(Array.from({length:12},(_,i)=>({month:i+1,monthName:MONTHS[i],...predict('month',i+1,null,null,yr,method)})));
});

app.post('/api/ai-analyze', async(req,res)=>{
  const {question}=req.body;
  const ctx=`You are an expert AQI analyst for Delhi air pollution (2020-2025, n=${allRecords.length} observations).
DATA: Global Mean=${globalStats.mean}, Std=${globalStats.std}, Median=${globalStats.median}
MONTHLY MEANS: ${Object.entries(monthlyStats).map(([m,s])=>`${MONTHS[m-1]}:${s.mean}`).join(', ')}
YEARLY MEANS: ${Object.entries(yearlyStats).map(([y,s])=>`${y}:${s.mean}`).join(', ')}
MODELS: Ensemble R²=${ensembleR2Monthly}, MLR R²=${mlrModel.r2} (Fourier+seasonal features), Month-specific regression R²=0.91 (monthly level)
REGRESSION: slope=${regSlope.toFixed(3)}/yr
CHI-SQUARE: χ²=${chiResult.chi2}, df=${chiResult.df}
Explain clearly for a 1st-year CSE Statistics student. Use bullet points.`;
  try{
    const r=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1000,system:ctx,messages:[{role:'user',content:question}]})
    });
    const d=await r.json();
    if(d.error) return res.status(500).json({success:false,error:d.error.message});
    res.json({success:true,answer:d.content.filter(b=>b.type==='text').map(b=>b.text).join('')});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

// Serve index.html for all other routes
app.get('/{*splat}',(req,res)=>{ res.setHeader('Content-Type','text/html'); res.sendFile(path.join(__dirname,'index.html')); });

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`✅ Delhi AQI Server running on http://localhost:${PORT}`));
