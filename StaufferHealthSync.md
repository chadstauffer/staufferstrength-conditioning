# Stauffer Health Sync — Apple Shortcut Setup

## How It Works
The Apple Shortcut reads health data from Apple Health (fed by your VeSync scale and Garmin watch), packages it as JSON, POSTs it to the `/api/health-sync` endpoint, which processes the data and redirects your browser back to the tracker with the formatted data. The tracker auto-imports it into localStorage.

## Architecture

```
iPhone Shortcuts → POST JSON → /api/health-sync (Vercel)
                                     ↓
                              Process & normalize
                                     ↓
                              302 Redirect → /?data=ENCODED_JSON
                                     ↓
                              Tracker imports to localStorage
                              Shows toast "Synced X entries"
```

## Apple Shortcut Setup

Your shortcut should have:
1. **8 Find Health Samples blocks** (Weight, Body Fat %, Resting HR, Active Energy, Sleep, VO2 Max, HRV, Steps) — last 60 days each
2. **A Dictionary action** that bundles all 8 sample arrays into a single object
3. **A "Get Contents of URL" action** that POSTs to the API endpoint

### Final Actions (after your 8 Find Health Samples blocks):

**Step 9 — Build the payload dictionary**
- Add Action → **Dictionary**
- Add these keys, each set to the corresponding Find Health Samples result:
  - `weight` → Weight samples
  - `bodyFat` → Body Fat % samples
  - `restingHR` → Resting Heart Rate samples
  - `activeCalories` → Active Energy samples
  - `sleep` → Sleep Analysis samples
  - `vo2max` → VO2 Max samples
  - `hrv` → HRV samples
  - `steps` → Steps samples

**Step 10 — POST to the API**
- Add Action → **Get Contents of URL**
- URL: `https://staufferstrength-conditioning.vercel.app/api/health-sync`
- Method: **POST**
- Request Body: **JSON**
- Set the body to the **Dictionary** from Step 9

**Step 11 — Open the redirect URL**
The API returns a 302 redirect. Apple Shortcuts' "Get Contents of URL" follows redirects automatically, which loads the tracker page with the `?data=` parameter. However, to ensure it opens in Safari:

- Add Action → **Open URLs**
- URL: `https://staufferstrength-conditioning.vercel.app`

The data import happens via the redirect, and the tracker page will show the toast notification.

**Alternative (if redirect doesn't auto-open Safari):**
If the redirect from the API doesn't open Safari automatically:
- After "Get Contents of URL", the result will be the HTML page
- Instead, change the flow: use **Get Contents of URL** with "Don't Follow Redirects" and extract the `Location` header, then **Open URLs** with that Location value

## API Endpoint Details

**URL**: `https://staufferstrength-conditioning.vercel.app/api/health-sync`
**Method**: POST
**Content-Type**: application/json

**Request body**:
```json
{
  "weight": [array of health samples],
  "bodyFat": [array of health samples],
  "restingHR": [array of health samples],
  "heartRate": [array of health samples],
  "activeCalories": [array of health samples],
  "sleep": [array of health samples],
  "hrv": [array of health samples],
  "steps": [array of health samples],
  "vo2max": [array of health samples]
}
```

Each health sample from Shortcuts contains a `date` (or `Start Date`) and a `value` (or `Value`/`qty`).

**Response**: 302 redirect to `/?data=ENCODED_JSON`

**Processed output format**:
```json
{
  "2026-03-21": {
    "weight": 185.4,
    "bodyFat": 22.1,
    "restingHR": 58,
    "heartRate": 72,
    "activeCalories": 620,
    "sleep": 7.4,
    "vo2max": 48.2,
    "hrv": 62,
    "steps": 8420
  }
}
```

**Processing notes**:
- Dates normalized to `yyyy-MM-dd` format
- Sleep auto-converts from seconds to hours if value > 24
- Active Calories and Steps are summed per day (multiple samples)
- All other metrics take the latest value per day
- Missing metric arrays are skipped gracefully

## Testing

Test the API directly with curl:
```bash
curl -X POST https://staufferstrength-conditioning.vercel.app/api/health-sync \
  -H "Content-Type: application/json" \
  -d '{"weight":[{"date":"2026-03-21","value":185.4}],"restingHR":[{"date":"2026-03-21","value":58}]}' \
  -v 2>&1 | grep Location
```

You should see a `Location` header with the redirect URL containing `?data=...`

Or test the import directly in your browser:
```
https://staufferstrength-conditioning.vercel.app/?data=%7B%222026-03-21%22%3A%7B%22weight%22%3A185.4%2C%22restingHR%22%3A58%7D%7D
```

## Notes

- Manual entries in the Stats tab are **never overwritten** by health sync
- Health-imported entries show a blue "⌚ Health" badge
- The URL parameter is stripped after import via `history.replaceState`
- The "Sync Apple Health" button in the tracker opens the Shortcut via `shortcuts://` URL scheme
- All data stays in localStorage on your device — the API endpoint is stateless
