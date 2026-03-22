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

## Daily Auto-Sync (Shortcuts Automation)

Set this up once so your health data syncs every morning without any manual action.

1. Open **Shortcuts** on your iPhone
2. Tap the **Automation** tab at the bottom
3. Tap **+ New Automation** (or the **+** in the top right)
4. Choose **Time of Day**
5. Set time to **7:00 AM**
6. Repeat: **Daily**
7. Tap **Next**
8. Tap **New Blank Automation**
9. Tap **Add Action** → search for **Run Shortcut** → tap it
10. Tap the blue **Shortcut** placeholder → select **Stauffer Health Sync**
11. Tap **Next** (or **Done** in the top right)
12. **Turn OFF "Ask Before Running"** — this is critical. The toggle should be off so it runs silently in the background
13. Tap **Done**

Every morning at 7 AM, your iPhone will:
- Pull the last 60 days of health data from Apple Health
- POST it to the API endpoint
- The data is stored in Edge Config, ready for the tracker

When you open the tracker app from your Home Screen, the Dashboard automatically fetches the latest data — no button tap needed.

## Home Screen Web Clip

When running as a Home Screen app (Add to Home Screen from Safari), the "Sync Apple Health" button shows a modal instead of opening the Shortcuts app — this preserves the app-like experience. The modal has an "Import Latest Data" button that fetches directly from the server.

With the daily automation running, you typically never need to tap this button — data is already current when you open the app.

## Notes

- Manual entries in the Stats tab are **never overwritten** by health sync
- Health-imported entries show a blue "⌚ Health" badge
- The Dashboard auto-fetches latest health data every time it opens
- In standalone (Home Screen) mode, sync shows a modal instead of leaving the app
- All data stays in localStorage on your device — the API endpoint is stateless
