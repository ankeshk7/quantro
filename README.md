# TradeSense

Personal NIFTY/F&O trading intelligence dashboard.

## Stack
- **Frontend**: React + Vite
- **Backend**: Python FastAPI
- **Data**: jugaad-data, yfinance, feedparser, NSE APIs
- **AI layer**: Claude API (OI interpretation, news scoring)
- **Persistence**: `data/trades.json` (flat file, no database)

## Project structure
```
tradesense/
├── backend/
│   ├── main.py               # FastAPI app + all routes
│   ├── requirements.txt
│   ├── data/
│   │   ├── nse_data.py       # jugaad-data — options chain, FII/DII, OI
│   │   ├── market_data.py    # yfinance — S&P, crude, USD/INR, VIX
│   │   └── news.py           # RSS feeds — ET, Mint, Reuters
│   ├── analysis/
│   │   ├── oi_analysis.py    # max pain, OI walls, PCR, IVR
│   │   └── strategy_fit.py   # range → strategy recommendation
│   └── sentiment/
│       └── scorer.py         # Claude API news scoring
├── frontend/
│   ├── package.json
│   └── src/
│       ├── App.jsx
│       ├── components/
│       │   ├── tabs/         # Home, Expiry, Scanner, Ticker, Positions, Journal, Calc
│       │   └── ui/           # Shared components
│       ├── hooks/            # useTickerData, useOIAnalysis, useTrades
│       └── utils/            # formatters, constants
└── data/
    └── trades.json           # Trade journal (flat file)
```

## Setup

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev                     # Runs on localhost:5173
```

### Environment variables
Create `backend/.env`:
```
ANTHROPIC_API_KEY=your_key_here
```

## Usage
- Open `http://localhost:5173`
- Backend API at `http://localhost:8000`
- API docs at `http://localhost:8000/docs`
