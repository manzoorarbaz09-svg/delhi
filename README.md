# Delhi AQI Predictor — Full Stack Website

## Project Structure
```
delhi-aqi/
├── server.js          ← Express backend (API + stat engine)
├── package.json
├── *.xlsx             ← Daily AQI data 2020–2025
├── *.csv              ← Summary AQI data
└── public/
    ├── index.html     ← Frontend UI
    ├── style.css      ← Styling
    └── app.js         ← Frontend JS (charts, API calls)
```

## Setup & Run

### 1. Install dependencies
```bash
npm install
```

### 2. Start the server
```bash
node server.js
```

### 3. Open in browser
```
http://localhost:3000
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/stats | All precomputed statistics |
| POST | /api/predict | Statistical AQI prediction |
| GET | /api/forecast/:year | Full 12-month forecast |
| GET | /api/daily/:year/:month | Daily data for drill-down |
| POST | /api/ai-analyze | Claude AI analysis |

## Statistical Methods
- **Linear Regression** — ŷ = β₀ + β₁·year × seasonal_index
- **Bayesian Inference** — Posterior mean with historical prior
- **Normal Distribution** — N(μ, σ²) per month
- **Seasonal Decomposition** — Trend × Seasonal Index

## Features
- 4-tab UI: Predict, Analytics, Statistics, AI Analyst
- Real data: 2,122 daily observations (2020–2025)
- AI chat powered by Claude API
- 4 live charts with Chart.js
- Full statistical analysis panel
- Chi-square goodness-of-fit test
- Hypothesis testing results
