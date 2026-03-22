module.exports = function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Get raw body as string ──
  let rawStr = "";
  if (Buffer.isBuffer(req.body)) {
    rawStr = req.body.toString("utf-8");
  } else if (typeof req.body === "string") {
    rawStr = req.body;
  } else if (typeof req.body === "object" && req.body !== null) {
    rawStr = JSON.stringify(req.body);
  }

  rawStr = rawStr.trim().replace(/^\uFEFF/, "");

  // ── LOG RAW BODY ──
  console.log("=== HEALTH-SYNC RAW BODY ===");
  console.log("Content-Type:", req.headers?.["content-type"] || "NOT SET");
  console.log("Body type:", typeof req.body, "| isBuffer:", Buffer.isBuffer(req.body));
  console.log("Raw string length:", rawStr.length);
  console.log("Raw body (first 2000 chars):");
  console.log(rawStr.slice(0, 2000));
  if (rawStr.length > 2000) console.log("... (" + (rawStr.length - 2000) + " more chars)");
  console.log("============================");

  if (!rawStr) {
    return res.status(400).json({ error: "Empty request body" });
  }

  // ── Metric keys we're looking for ──
  const metricKeys = ["weight", "bodyFat", "restingHR", "heartRate", "activeCalories", "sleep", "hrv", "steps", "vo2max"];
  const result = {};

  // ── ATTEMPT 1: Standard JSON parse ──
  let jsonParsed = false;
  try {
    let body = typeof req.body === "object" && !Buffer.isBuffer(req.body) ? req.body : JSON.parse(rawStr);
    if (body && typeof body === "object") {
      console.log("JSON parse succeeded. Keys:", Object.keys(body));
      jsonParsed = processStructuredBody(body, result);
    }
  } catch (err) {
    console.log("JSON parse failed:", err.message);
  }

  // ── ATTEMPT 2: Regex extraction from malformed text ──
  if (!jsonParsed || Object.keys(result).length === 0) {
    console.log("Falling back to regex extraction...");
    extractWithRegex(rawStr, result);
  }

  const dateCount = Object.keys(result).length;
  const sampleCount = Object.values(result).reduce((s, day) => s + Object.keys(day).length, 0);

  console.log("=== PARSED RESULT ===");
  console.log("Dates:", dateCount, "| Samples:", sampleCount);
  console.log("Result (first 1000):", JSON.stringify(result).slice(0, 1000));
  console.log("=====================");

  if (dateCount === 0) {
    return res.status(400).json({
      error: "No valid samples found",
      bodyPreview: rawStr.slice(0, 500),
    });
  }

  const encoded = encodeURIComponent(JSON.stringify(result));
  const syncUrl = `https://staufferstrength-conditioning.vercel.app/?data=${encoded}`;
  console.log("Returning URL, length:", syncUrl.length);

  res.status(200).setHeader("Content-Type", "text/plain").send(syncUrl);

  // ────────────────────────────────────────────
  // Helper: process a properly parsed JSON body
  // ────────────────────────────────────────────
  function processStructuredBody(body, result) {
    let found = false;
    const metricMap = {
      weight: "weight", bodyFat: "bodyFat", restingHR: "restingHR",
      heartRate: "heartRate", activeCalories: "activeCalories",
      sleep: "sleep", hrv: "hrv", steps: "steps", vo2max: "vo2max",
    };

    for (const [inKey, outKey] of Object.entries(metricMap)) {
      const samples = toSampleArray(body[inKey]);
      if (!samples.length) continue;
      found = true;
      let count = 0;
      for (const sample of samples) {
        const dateStr = extractDate(sample);
        if (!dateStr) continue;
        let val = extractValue(sample);
        if (val === null) continue;
        if (outKey === "sleep" && val > 24) val = +(val / 3600).toFixed(1);
        val = +val.toFixed(1);
        if (!result[dateStr]) result[dateStr] = {};
        if (outKey === "activeCalories" || outKey === "steps") {
          result[dateStr][outKey] = +((result[dateStr][outKey] || 0) + val).toFixed(1);
        } else {
          result[dateStr][outKey] = val;
        }
        count++;
      }
      console.log(`  Structured ${inKey}: ${count}/${samples.length}`);
    }
    return found;
  }

  function toSampleArray(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      const t = raw.trim();
      if (t.startsWith("[") || t.startsWith("{")) {
        try { const p = JSON.parse(t); return Array.isArray(p) ? p : [p]; } catch {}
      }
      return [];
    }
    if (typeof raw === "object") return [raw];
    return [];
  }

  function extractDate(sample) {
    if (typeof sample === "string") {
      const d = new Date(sample);
      if (!isNaN(d)) return fmtDate(d);
      return null;
    }
    if (typeof sample !== "object" || !sample) return null;
    const raw = sample.date || sample.Date || sample.startDate || sample.Start_Date
      || sample["Start Date"] || sample.start_date || sample.timestamp || sample.Timestamp;
    if (!raw) return null;
    const p = new Date(raw);
    return isNaN(p) ? null : fmtDate(p);
  }

  function extractValue(sample) {
    if (typeof sample === "number") return sample;
    if (typeof sample === "string") { const n = parseFloat(sample); return isNaN(n) ? null : n; }
    if (typeof sample !== "object" || !sample) return null;
    const raw = sample.value ?? sample.Value ?? sample.qty ?? sample.Qty
      ?? sample.quantity ?? sample.Quantity ?? sample.duration ?? sample.Duration;
    if (raw == null) return null;
    const n = parseFloat(raw);
    return isNaN(n) ? null : n;
  }

  function fmtDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // ────────────────────────────────────────────
  // Helper: regex extraction from malformed body
  // ────────────────────────────────────────────
  function extractWithRegex(text, result) {
    console.log("Regex extraction starting...");

    // Strategy: split the body by metric key names, then extract date-value pairs from each section
    for (const key of metricKeys) {
      // Find the section for this key — look for "key": or "key" : followed by content until the next key or end
      const keyPattern = new RegExp(`"${key}"\\s*:\\s*`, "i");
      const match = keyPattern.exec(text);
      if (!match) continue;

      // Get text from this key to the next metric key or end
      const startIdx = match.index + match[0].length;
      let endIdx = text.length;
      for (const otherKey of metricKeys) {
        if (otherKey === key) continue;
        const otherPattern = new RegExp(`"${otherKey}"\\s*:`, "i");
        const otherMatch = otherPattern.exec(text.slice(startIdx));
        if (otherMatch && otherMatch.index < (endIdx - startIdx)) {
          endIdx = startIdx + otherMatch.index;
        }
      }
      const section = text.slice(startIdx, endIdx);
      console.log(`  Regex section "${key}" (${section.length} chars): ${section.slice(0, 200)}`);

      const outKey = key;

      // Extract date-value pairs using multiple patterns

      // Pattern 1: ISO dates like 2026-03-21
      const isoDatePat = /(\d{4}-\d{2}-\d{2})/g;
      // Pattern 2: values — numbers that look like health values
      const valuePat = /(\d+\.?\d*)/g;

      // Try to find date+value pairs in proximity
      // Look for patterns like: date ... value or value ... date
      // Strategy: find all dates, find all numbers near them

      // Approach: split section into "records" — look for date patterns and grab the nearest number
      const dates = [];
      let dm;
      while ((dm = isoDatePat.exec(section)) !== null) {
        dates.push({ date: dm[1], idx: dm.index });
      }

      // Also try common Shortcuts date formats: "Mar 21, 2026" or "March 21, 2026" etc
      const localeDatePat = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2}),?\s+(\d{4})/gi;
      while ((dm = localeDatePat.exec(section)) !== null) {
        const parsed = new Date(dm[0]);
        if (!isNaN(parsed)) {
          dates.push({ date: fmtDate(parsed), idx: dm.index });
        }
      }

      if (dates.length === 0) {
        console.log(`    No dates found for ${key}`);
        continue;
      }

      // For each date, find the closest value in the section
      let extracted = 0;
      for (const dateInfo of dates) {
        const afterDate = section.slice(dateInfo.idx, dateInfo.idx + 300);

        // Priority 1: Look for explicit "Value: 123.4" pattern (Shortcuts format)
        let val = null;
        const valueLabelMatch = afterDate.match(/Value:\s*(\d+\.?\d*)/i);
        if (valueLabelMatch) {
          const n = parseFloat(valueLabelMatch[1]);
          if (n > 0 && isReasonableValue(outKey, n)) {
            val = n;
          }
        }

        // Priority 2: General number extraction if no Value: label found
        if (val === null) {
          const nums = [];
          const numPat = /(?:^|[^0-9.])(\d{1,6}\.?\d{0,2})(?=[^0-9.]|$)/g;
          let nm;
          while ((nm = numPat.exec(afterDate)) !== null) {
            const n = parseFloat(nm[1]);
            if (n >= 2020 && n <= 2035) continue; // likely a year
            if (n === 0) continue;
            // Skip date components: numbers 1-31 that appear right after a date
            if (n <= 31 && afterDate.indexOf(nm[0]) < 25) continue;
            if (isReasonableValue(outKey, n)) {
              nums.push(n);
            }
          }
          if (nums.length > 0) val = nums[0];
        }

        if (val !== null) {
          if (outKey === "sleep" && val > 24) val = +(val / 3600).toFixed(1);
          val = +val.toFixed(1);
          if (!result[dateInfo.date]) result[dateInfo.date] = {};
          if (outKey === "activeCalories" || outKey === "steps") {
            result[dateInfo.date][outKey] = +((result[dateInfo.date][outKey] || 0) + val).toFixed(1);
          } else {
            result[dateInfo.date][outKey] = val;
          }
          extracted++;
        }
      }
      console.log(`    Regex extracted ${extracted} values for ${key}`);
    }
  }

  function isReasonableValue(metric, val) {
    switch (metric) {
      case "weight": return val >= 50 && val <= 500;
      case "bodyFat": return val >= 1 && val <= 60;
      case "restingHR": return val >= 30 && val <= 120;
      case "heartRate": return val >= 30 && val <= 220;
      case "hrv": return val >= 5 && val <= 200;
      case "steps": return val >= 10 && val <= 100000;
      case "sleep": return val >= 60 || (val >= 1 && val <= 24); // seconds or hours
      case "activeCalories": return val >= 1 && val <= 10000;
      case "vo2max": return val >= 10 && val <= 90;
      default: return val > 0 && val < 100000;
    }
  }
};
