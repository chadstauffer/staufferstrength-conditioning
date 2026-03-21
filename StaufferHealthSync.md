# Stauffer Health Sync — Apple Shortcut Setup

## How It Works
The Apple Shortcut reads health data from Apple Health (fed by your VeSync scale and Garmin watch), packages it as JSON, and opens the tracker webpage with the data as a URL parameter. The tracker auto-imports it.

## Create the Shortcut

Open **Shortcuts** on your iPhone and create a new shortcut named **Stauffer Health Sync**.

### Actions (in order):

**1. Set Variable: startDate**
- Action: `Date`  →  `Adjust Date` → subtract 60 days from Current Date
- Save to variable `startDate`

**2. Find Health Samples — Weight**
- Type: Weight
- Start Date: is after `startDate`
- Sort by: Start Date (Newest First)
- Group by: Day (take the latest reading per day)
- Unit: lb

**3. Repeat with Each** (weight samples)
- For each sample, extract: Start Date (formatted YYYY-MM-DD) and Value
- Append to `weightDict` dictionary keyed by date

**4. Find Health Samples — Body Fat Percentage**
- Type: Body Fat Percentage
- Start Date: is after `startDate`
- Group by: Day

**5. Find Health Samples — Resting Heart Rate**
- Type: Resting Heart Rate
- Start Date: is after `startDate`
- Group by: Day
- Unit: bpm

**6. Find Health Samples — Active Energy Burned**
- Type: Active Energy
- Start Date: is after `startDate`
- Group by: Day (Sum)
- Unit: kcal

**7. Find Health Samples — Sleep Analysis**
- Type: Sleep Analysis
- Start Date: is after `startDate`
- Category: Asleep
- Group by: Day (Sum duration in hours)

**8. Find Health Samples — VO2 Max**
- Type: VO2 Max
- Start Date: is after `startDate`
- Group by: Day

**9. Find Health Samples — Heart Rate Variability**
- Type: Heart Rate Variability (SDNN)
- Start Date: is after `startDate`
- Group by: Day
- Unit: ms

**10. Build JSON**
- For each unique date across all samples, create an object:
```json
{
  "2026-03-21": {
    "weight": 185.4,
    "bodyFat": 22.1,
    "restingHR": 58,
    "activeCalories": 620,
    "sleep": 7.4,
    "vo2max": 48.2,
    "hrv": 62
  }
}
```
- Use a Dictionary action to merge all metrics by date
- Convert to JSON text

**11. URL Encode the JSON**
- Action: `URL Encode` the JSON text

**12. Open URL**
- Open: `https://YOUR-VERCEL-DOMAIN/?data=[URL Encoded JSON]`
- Replace `YOUR-VERCEL-DOMAIN` with your actual deployment URL

## Simplified Version (Weight + Body Fat Only)

If the full version is too complex, start with just weight and body fat:

1. Find Health Samples: Weight (last 60 days, group by day)
2. Find Health Samples: Body Fat % (last 60 days, group by day)
3. Build dictionary keyed by date with `weight` and `bodyFat`
4. Convert to JSON → URL Encode → Open URL with `?data=` param

## Testing

You can test the import by visiting your tracker URL with a test parameter:
```
https://YOUR-DOMAIN/?data=%7B%222026-03-21%22%3A%7B%22weight%22%3A185.4%2C%22bodyFat%22%3A22.1%2C%22restingHR%22%3A58%7D%7D
```

This should show a toast "Synced 1 entries from Apple Health" and add the entry to your Stats log with a blue "⌚ Health" badge.

## Notes

- Manual entries in the Stats tab are **never overwritten** by health sync
- Health-imported entries are marked with `source: "apple_health"` and show a blue badge
- The URL parameter is stripped after import (no reload needed)
- The "Sync Apple Health" button in the Stats tab opens the Shortcut directly via `shortcuts://` URL scheme
- All data stays in localStorage on your device
