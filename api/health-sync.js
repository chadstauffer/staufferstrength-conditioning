module.exports = function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body;

  // Vercel auto-parses JSON bodies, but handle string case
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      console.error("Failed to parse request body as JSON");
      return res.status(400).json({ error: "Invalid data" });
    }
  }

  if (!body || typeof body !== "object") {
    console.error("Empty or malformed request body:", body);
    return res.status(400).json({ error: "Invalid data" });
  }

  console.log(
    "Received health data — keys:",
    Object.keys(body),
    "sample counts:",
    Object.fromEntries(
      Object.entries(body).map(([k, v]) => [k, Array.isArray(v) ? v.length : "not array"])
    )
  );

  // Metric key mapping: incoming key -> output key
  const metricMap = {
    weight: "weight",
    bodyFat: "bodyFat",
    restingHR: "restingHR",
    heartRate: "heartRate",
    activeCalories: "activeCalories",
    sleep: "sleep",
    hrv: "hrv",
    steps: "steps",
    vo2max: "vo2max",
  };

  const result = {};

  for (const [inKey, outKey] of Object.entries(metricMap)) {
    const samples = body[inKey];
    if (!Array.isArray(samples)) continue;

    for (const sample of samples) {
      // Extract date — Shortcuts sends various formats
      let dateStr = null;
      const rawDate =
        sample.date || sample.Date || sample.startDate || sample.Start_Date || sample["Start Date"];

      if (rawDate) {
        // Try to parse and normalize to yyyy-MM-dd
        const parsed = new Date(rawDate);
        if (!isNaN(parsed)) {
          const y = parsed.getFullYear();
          const m = String(parsed.getMonth() + 1).padStart(2, "0");
          const d = String(parsed.getDate()).padStart(2, "0");
          dateStr = `${y}-${m}-${d}`;
        }
      }

      if (!dateStr) continue;

      // Extract value
      let val =
        sample.value ?? sample.Value ?? sample.qty ?? sample.Qty ?? sample.duration ?? sample.Duration;

      if (val === null || val === undefined) continue;
      val = parseFloat(val);
      if (isNaN(val)) continue;

      // Sleep: convert seconds to hours if value > 24 (clearly in seconds)
      if (outKey === "sleep" && val > 24) {
        val = +(val / 3600).toFixed(1);
      }

      // Round to 1 decimal
      val = +val.toFixed(1);

      // Initialize date entry if needed
      if (!result[dateStr]) result[dateStr] = {};

      // For most metrics, keep the latest value per date (last write wins)
      // For activeCalories and steps, sum within a day
      if (outKey === "activeCalories" || outKey === "steps") {
        result[dateStr][outKey] = +(
          (result[dateStr][outKey] || 0) + val
        ).toFixed(1);
      } else {
        result[dateStr][outKey] = val;
      }
    }
  }

  const dateCount = Object.keys(result).length;
  console.log("Processed", dateCount, "dates:", Object.keys(result).sort().slice(0, 5), "...");

  if (dateCount === 0) {
    return res.status(400).json({ error: "No valid samples found in data" });
  }

  // URL-encode the result and redirect
  const encoded = encodeURIComponent(JSON.stringify(result));
  const redirectUrl = `https://staufferstrength-conditioning.vercel.app/?data=${encoded}`;

  // Redirect to tracker with data
  res.writeHead(302, { Location: redirectUrl });
  res.end();
}
