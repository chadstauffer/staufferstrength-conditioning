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

  // ── Parse the body from multiple possible formats ──
  let body = req.body;

  // Case 1: Vercel gave us a Buffer (raw body, no Content-Type: application/json)
  if (Buffer.isBuffer(body)) {
    body = body.toString("utf-8");
  }

  // Case 2: Body is a string — try JSON.parse
  if (typeof body === "string") {
    // Trim whitespace and BOM
    body = body.trim().replace(/^\uFEFF/, "");
    if (!body) {
      console.error("Empty request body string");
      return res.status(400).json({ error: "Invalid data" });
    }
    try {
      body = JSON.parse(body);
    } catch (err) {
      console.error("Failed to JSON.parse body:", err.message, "| First 200 chars:", body.slice(0, 200));
      return res.status(400).json({ error: "Invalid JSON in request body" });
    }
  }

  // Case 3: Body is already an object (Vercel auto-parsed)
  if (!body || typeof body !== "object") {
    console.error("Body is not an object after parsing. Type:", typeof body);
    return res.status(400).json({ error: "Invalid data" });
  }

  console.log("Received health data — keys:", Object.keys(body));
  for (const [k, v] of Object.entries(body)) {
    const desc = Array.isArray(v)
      ? `array[${v.length}]`
      : typeof v === "string"
        ? `string(${v.length} chars)`
        : typeof v;
    console.log(`  ${k}: ${desc}`);
  }

  // ── Normalize each metric value into an array of sample objects ──
  // Shortcuts may send: an array of objects, a single object, a string
  // representation of the array, or other formats
  function toSampleArray(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    // If it's a string, try to parse it as JSON array
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmed);
          return Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          return [];
        }
      }
      return [];
    }
    // Single object
    if (typeof raw === "object") return [raw];
    return [];
  }

  // ── Extract a date string from a sample ──
  function extractDate(sample) {
    if (typeof sample === "string") {
      // The sample itself might be a date string
      const d = new Date(sample);
      if (!isNaN(d)) return formatDate(d);
      return null;
    }
    if (typeof sample !== "object" || !sample) return null;

    // Try many possible date field names from Shortcuts
    const rawDate =
      sample.date ||
      sample.Date ||
      sample.startDate ||
      sample.Start_Date ||
      sample["Start Date"] ||
      sample.start_date ||
      sample.timestamp ||
      sample.Timestamp;

    if (!rawDate) return null;
    const parsed = new Date(rawDate);
    if (isNaN(parsed)) return null;
    return formatDate(parsed);
  }

  function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // ── Extract a numeric value from a sample ──
  function extractValue(sample) {
    if (typeof sample === "number") return sample;
    if (typeof sample === "string") {
      const n = parseFloat(sample);
      return isNaN(n) ? null : n;
    }
    if (typeof sample !== "object" || !sample) return null;

    const raw =
      sample.value ??
      sample.Value ??
      sample.qty ??
      sample.Qty ??
      sample.quantity ??
      sample.Quantity ??
      sample.duration ??
      sample.Duration;

    if (raw === null || raw === undefined) return null;
    const n = parseFloat(raw);
    return isNaN(n) ? null : n;
  }

  // ── Process all metrics ──
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
  let totalSamples = 0;

  for (const [inKey, outKey] of Object.entries(metricMap)) {
    const samples = toSampleArray(body[inKey]);
    if (!samples.length) continue;

    let processedCount = 0;
    for (const sample of samples) {
      const dateStr = extractDate(sample);
      if (!dateStr) continue;

      let val = extractValue(sample);
      if (val === null) continue;

      // Sleep: convert seconds to hours if value > 24
      if (outKey === "sleep" && val > 24) {
        val = +(val / 3600).toFixed(1);
      }

      // Round to 1 decimal
      val = +val.toFixed(1);

      if (!result[dateStr]) result[dateStr] = {};

      // Sum for cumulative metrics, last-write-wins for others
      if (outKey === "activeCalories" || outKey === "steps") {
        result[dateStr][outKey] = +((result[dateStr][outKey] || 0) + val).toFixed(1);
      } else {
        result[dateStr][outKey] = val;
      }
      processedCount++;
    }
    totalSamples += processedCount;
    console.log(`  Processed ${inKey}: ${processedCount}/${samples.length} samples`);
  }

  const dateCount = Object.keys(result).length;
  console.log(`Total: ${totalSamples} samples across ${dateCount} dates`);

  if (dateCount === 0) {
    console.error("No valid samples found. Body keys:", Object.keys(body));
    return res.status(400).json({
      error: "No valid samples found in data",
      receivedKeys: Object.keys(body),
      hint: "Each metric should be an array of objects with date and value fields",
    });
  }

  // Return plain text URL for Shortcuts "Open URLs" action
  const encoded = encodeURIComponent(JSON.stringify(result));
  const syncUrl = `https://staufferstrength-conditioning.vercel.app/?data=${encoded}`;

  console.log("Returning sync URL with", dateCount, "dates of data");

  res.status(200)
    .setHeader("Content-Type", "text/plain")
    .send(syncUrl);
};
