const express = require('express');
const cors = require('cors');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from public/ with correct MIME types
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
    if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
    if (filePath.endsWith('.html')) res.setHeader('Content-Type', 'text/html');
  }
}));

// ─── LOAD & PROCESS ALL DATA ON STARTUP ───
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function loadAllData() {
  let allRecords = [];
  const yearlyRaw = {};

  for (let yr = 2020; yr <= 2025; yr++) {
    const file = path.join(__dirname, `AQI_daily_city_level_delhi_${yr}_delhi_${yr}.xlsx`);
    if (!fs.existsSync(file)) continue;
    const wb = XLSX.readFile(file);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    yearlyRaw[yr] = {};

    rows.forEach(row => {
      MONTHS.forEach((m, mi) => {
        const val = row[m];
        if (val != null && val !== '' && !isNaN(Number(val))) {
          const n = Number(val);
          if (n > 0 && n < 1000) {
            allRecords.push({ year: yr, month: mi + 1, day: Number(row['Date']) || 0, aqi: n });
            if (!yearlyRaw[yr][mi + 1]) yearlyRaw[yr][mi + 1] = [];
            yearlyRaw[yr][mi + 1].push(n);
          }
        }
      });
    });
  }
  return { allRecords, yearlyRaw };
}

function computeStats(values) {
  if (!values || values.length === 0) return null;
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.map(v => (v - mean) ** 2).reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(variance);
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(n / 2)];
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const min = sorted[0];
  const max = sorted[n - 1];
  const skewness = n > 2 ? (3 * (mean - median)) / std : 0;
  const kurtosis = values.map(v => ((v - mean) / std) ** 4).reduce((a, b) => a + b, 0) / n - 3;
  const binSize = 50;
  const bins = {};
  values.forEach(v => {
    const b = Math.floor(v / binSize) * binSize;
    bins[b] = (bins[b] || 0) + 1;
  });
  const mode = Number(Object.entries(bins).sort((a, b) => b[1] - a[1])[0][0]) + binSize / 2;
  return { mean: +mean.toFixed(1), std: +std.toFixed(1), variance: +variance.toFixed(1), median, q1, q3, min, max, n, skewness: +skewness.toFixed(3), kurtosis: +kurtosis.toFixed(3), mode: +mode.toFixed(0) };
}

function linearRegression(xs, ys) {
  const n = xs.length;
  const xm = xs.reduce((a, b) => a + b, 0) / n;
  const ym = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - xm) * (ys[i] - ym); den += (xs[i] - xm) ** 2; }
  const slope = den ? num / den : 0;
  const intercept = ym - slope * xm;
  const yPred = xs.map(x => intercept + slope * x);
  const ssRes = ys.map((y, i) => (y - yPred[i]) ** 2).reduce((a, b) => a + b, 0);
  const ssTot = ys.map(y => (y - ym) ** 2).reduce((a, b) => a + b, 0);
  const r2 = ssTot ? 1 - ssRes / ssTot : 0;
  return { slope: +slope.toFixed(4), intercept: +intercept.toFixed(2), r2: +r2.toFixed(3) };
}

const { allRecords, yearlyRaw } = loadAllData();
const globalStats = computeStats(allRecords.map(r => r.aqi));

const monthlyStats = {};
for (let m = 1; m <= 12; m++) {
  const vals = allRecords.filter(r => r.month === m).map(r => r.aqi);
  monthlyStats[m] = computeStats(vals);
}

const yearlyStats = {};
for (let yr = 2020; yr <= 2025; yr++) {
  const vals = allRecords.filter(r => r.year === yr).map(r => r.aqi);
  yearlyStats[yr] = computeStats(vals);
}

const yearMonthMatrix = {};
for (let yr = 2020; yr <= 2025; yr++) {
  yearMonthMatrix[yr] = {};
  for (let m = 1; m <= 12; m++) {
    const vals = yearlyRaw[yr]?.[m] || [];
    yearMonthMatrix[yr][m] = vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
  }
}

const yrKeys = Object.keys(yearlyStats).map(Number).sort();
const yrMeans = yrKeys.map(y => yearlyStats[y].mean);
const yearlyRegression = linearRegression(yrKeys, yrMeans);

const seasonalIndices = {};
for (let m = 1; m <= 12; m++) {
  seasonalIndices[m] = +(monthlyStats[m].mean / globalStats.mean).toFixed(4);
}

function chiSquareTest(values, bins) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(values.map(v => (v - mean) ** 2).reduce((a, b) => a + b, 0) / n);
  const observed = new Array(bins.length - 1).fill(0);
  values.forEach(v => {
    for (let i = 0; i < bins.length - 1; i++) {
      if (v >= bins[i] && v < bins[i + 1]) { observed[i]++; break; }
    }
  });
  function normalCDF(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989422820 * Math.exp(-x * x / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
    return x >= 0 ? 1 - p : p;
  }
  const expected = [];
  for (let i = 0; i < bins.length - 1; i++) {
    const z1 = (bins[i] - mean) / std;
    const z2 = (bins[i + 1] - mean) / std;
    expected.push(n * (normalCDF(z2) - normalCDF(z1)));
  }
  const chi2 = observed.reduce((acc, o, i) => acc + (expected[i] > 0 ? (o - expected[i]) ** 2 / expected[i] : 0), 0);
  return { chi2: +chi2.toFixed(2), df: bins.length - 2, observed, expected: expected.map(e => +e.toFixed(1)) };
}

const CHI_BINS = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500];
const chiResult = chiSquareTest(allRecords.map(r => r.aqi), CHI_BINS);

// ─── PREDICTION ENGINE ───
function normalCDFApprox(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422820 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return z >= 0 ? 1 - p : p;
}

function predict(type, month, day, week, targetYear, method) {
  const m = month || 1;
  const ms = monthlyStats[m];
  const yr = targetYear || 2026;
  const trendValue = yearlyRegression.intercept + yearlyRegression.slope * yr;
  const seasonIdx = seasonalIndices[m];

  let predicted, ciLower, ciUpper, confidence, methodFormula;

  if (type === 'year') {
    let total = 0;
    for (let mi = 1; mi <= 12; mi++) {
      total += yearlyRegression.intercept + yearlyRegression.slope * yr * seasonalIndices[mi];
    }
    predicted = Math.round(total / 12);
    ciLower = Math.max(0, Math.round(predicted - 1.96 * globalStats.std));
    ciUpper = Math.round(predicted + 1.96 * globalStats.std);
    confidence = 72;
    methodFormula = `ŷ = (1/12) Σᵢ [${yearlyRegression.intercept.toFixed(1)} + ${yearlyRegression.slope.toFixed(3)}·${yr}·sᵢ]`;
  } else {
    switch (method) {
      case 'regression':
        predicted = Math.round(trendValue * seasonIdx);
        ciLower = Math.max(0, Math.round(predicted - 1.96 * ms.std));
        ciUpper = Math.round(predicted + 1.96 * ms.std);
        confidence = 78;
        methodFormula = `ŷ = (${yearlyRegression.intercept} + ${yearlyRegression.slope}·${yr}) × ${seasonIdx}`;
        break;
      case 'bayes': {
        const recentVals = [2023, 2024].map(y => yearMonthMatrix[y]?.[m]).filter(v => v != null);
        const recentMean = recentVals.length ? recentVals.reduce((a, b) => a + b, 0) / recentVals.length : ms.mean;
        const priorPrec = 1 / (ms.std ** 2);
        const likePrec = recentVals.length / (ms.std ** 2);
        const posterior = (priorPrec * ms.mean + likePrec * recentMean) / (priorPrec + likePrec);
        predicted = Math.round(posterior);
        ciLower = Math.max(0, Math.round(predicted - 1.96 * ms.std));
        ciUpper = Math.round(predicted + 1.96 * ms.std);
        confidence = 83;
        methodFormula = `μ_post = (τ₀μ₀ + τ_n·x̄) / (τ₀ + τ_n) = ${predicted}`;
        break;
      }
      case 'normal':
        predicted = Math.round(ms.mean);
        ciLower = Math.max(0, Math.round(ms.mean - 1.96 * ms.std));
        ciUpper = Math.round(ms.mean + 1.96 * ms.std);
        confidence = 71;
        methodFormula = `X ~ N(${ms.mean}, ${ms.std}²) → μ = ${ms.mean}`;
        break;
      case 'seasonal':
        predicted = Math.round(trendValue * seasonIdx);
        ciLower = Math.max(0, Math.round(predicted - 1.96 * ms.std));
        ciUpper = Math.round(predicted + 1.96 * ms.std);
        confidence = 80;
        methodFormula = `AQI = Trend(${yr}) × SI_${m} = ${trendValue.toFixed(1)} × ${seasonIdx}`;
        break;
      default:
        predicted = Math.round(ms.mean);
        ciLower = Math.max(0, Math.round(ms.mean - 1.96 * ms.std));
        ciUpper = Math.round(ms.mean + 1.96 * ms.std);
        confidence = 70;
        methodFormula = `μ = ${ms.mean}`;
    }
  }

  const z = +((predicted - globalStats.mean) / globalStats.std).toFixed(2);
  const percentileAbove = +(100 * (1 - normalCDFApprox(z))).toFixed(1);

  return {
    predicted, ciLower, ciUpper, confidence, methodFormula, zScore: z, percentileAbove,
    historicalMean: ms?.mean ?? globalStats.mean,
    historicalStd: ms?.std ?? globalStats.std,
    historicalMedian: ms?.median ?? globalStats.median,
    historicalMin: ms?.min ?? globalStats.min,
    historicalMax: ms?.max ?? globalStats.max,
  };
}

// ─── API ROUTES ───
app.get('/api/stats', (req, res) => {
  res.json({
    global: globalStats, monthly: monthlyStats, yearly: yearlyStats,
    yearMonthMatrix, yearlyRegression, seasonalIndices, chiSquare: chiResult,
    totalRecords: allRecords.length,
  });
});

app.post('/api/predict', (req, res) => {
  const { type, month, day, week, targetYear, method } = req.body;
  try {
    const result = predict(type, month, day, week, targetYear, method);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/daily/:year/:month', (req, res) => {
  const yr = parseInt(req.params.year);
  const mo = parseInt(req.params.month);
  const vals = allRecords.filter(r => r.year === yr && r.month === mo).sort((a, b) => a.day - b.day);
  res.json(vals);
});

app.post('/api/ai-analyze', async (req, res) => {
  const { question, context } = req.body;
  const dataContext = `
You are an expert Air Quality Index (AQI) analyst and statistician specializing in Delhi's air pollution data.

REAL DATA SUMMARY (2020–2025, n=${allRecords.length} daily observations):
- Global Mean AQI: ${globalStats.mean}, Std Dev: ${globalStats.std}, Median: ${globalStats.median}
- Min: ${globalStats.min}, Max: ${globalStats.max}
- Skewness: ${globalStats.skewness}, Kurtosis: ${globalStats.kurtosis}

MONTHLY AVERAGES (mean ± std):
${Object.entries(monthlyStats).map(([m, s]) => `  Month ${m} (${MONTHS[m - 1]}): μ=${s.mean}, σ=${s.std}, median=${s.median}`).join('\n')}

YEARLY AVERAGES:
${Object.entries(yearlyStats).map(([y, s]) => `  ${y}: μ=${s.mean}, σ=${s.std}`).join('\n')}

LINEAR REGRESSION (yearly trend):
  AQI = ${yearlyRegression.intercept} + ${yearlyRegression.slope} × year, R²=${yearlyRegression.r2}

CHI-SQUARE GOODNESS OF FIT TEST:
  χ²=${chiResult.chi2}, df=${chiResult.df} → ${chiResult.chi2 > 15.51 ? 'Reject H₀ (not normal at α=0.05)' : 'Fail to reject H₀'}

SEASONAL PATTERN:
  Winter (Nov-Jan) avg ~299, Summer (Jun-Aug) avg ~105, Monsoon (Jul-Sep) avg ~91
  Worst month: November (${monthlyStats[11].mean}), Best month: August (${monthlyStats[8].mean})

${context ? 'USER CONTEXT: ' + context : ''}

Answer the user's question with precise statistical reasoning. Reference specific numbers from the data above.
Explain statistical concepts clearly since this is for a 1st-year CSE Statistics & Probability student.
Be concise but thorough. Use bullet points where helpful.
  `.trim();

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: dataContext,
        messages: [{ role: 'user', content: question }]
      })
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ success: false, error: data.error.message });
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    res.json({ success: true, answer: text });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/forecast/:year', (req, res) => {
  const yr = parseInt(req.params.year);
  const method = req.query.method || 'regression';
  const forecast = [];
  for (let m = 1; m <= 12; m++) {
    const result = predict('month', m, null, null, yr, method);
    forecast.push({ month: m, monthName: MONTHS[m - 1], ...result });
  }
  res.json(forecast);
});

// Serve frontend for all other routes
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Delhi AQI Server running on http://localhost:${PORT}`));
