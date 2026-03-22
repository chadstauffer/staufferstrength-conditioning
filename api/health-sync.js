module.exports = function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // ── Get raw body as string ──
  let rawStr = "";
  if (Buffer.isBuffer(req.body)) rawStr = req.body.toString("utf-8");
  else if (typeof req.body === "string") rawStr = req.body;
  else if (typeof req.body === "object" && req.body !== null) rawStr = JSON.stringify(req.body);
  rawStr = rawStr.trim().replace(/^\uFEFF/, "");

  console.log("=== HEALTH-SYNC RAW ===");
  console.log("Content-Type:", req.headers?.["content-type"] || "NOT SET");
  console.log("Body type:", typeof req.body, "| isBuffer:", Buffer.isBuffer(req.body), "| length:", rawStr.length);
  console.log("Body (first 3000):\n" + rawStr.slice(0, 3000));
  if (rawStr.length > 3000) console.log("...(" + (rawStr.length - 3000) + " more)");
  console.log("=======================");

  if (!rawStr) {
    return sendResult(res, {});
  }

  const metricKeys = ["weight", "bodyFat", "restingHR", "heartRate", "activeCalories", "sleep", "hrv", "steps", "vo2max"];
  const result = {};

  // ── ATTEMPT 1: Clean JSON parse ──
  let structured = false;
  try {
    const body = typeof req.body === "object" && !Buffer.isBuffer(req.body)
      ? req.body : JSON.parse(rawStr);
    if (body && typeof body === "object") {
      console.log("JSON parse OK. Keys:", Object.keys(body));
      structured = processStructured(body, result, metricKeys);
    }
  } catch (err) {
    console.log("JSON parse failed:", err.message);
  }

  // ── ATTEMPT 2: Extract from malformed Shortcuts text ──
  if (!structured || Object.keys(result).length === 0) {
    console.log("Falling back to text extraction...");
    extractFromText(rawStr, result, metricKeys);
  }

  return sendResult(res, result);

  // ═══════════════════════════════════════════
  // Send response — always 200 with URL
  // ═══════════════════════════════════════════
  function sendResult(res, result) {
    const dateCount = Object.keys(result).length;
    const sampleCount = Object.values(result).reduce((s, d) => s + Object.keys(d).length, 0);
    console.log("=== RESULT ===");
    console.log("Dates:", dateCount, "| Metrics:", sampleCount);
    console.log("Data:", JSON.stringify(result).slice(0, 1500));
    console.log("==============");

    // Always return 200 — even with empty data, let the tracker handle it
    const payload = dateCount > 0 ? JSON.stringify(result) : "{}";
    const encoded = encodeURIComponent(payload);
    const syncUrl = `https://staufferstrength-conditioning.vercel.app/?data=${encoded}`;
    console.log("URL length:", syncUrl.length);

    res.status(200).setHeader("Content-Type", "text/plain").send(syncUrl);
  }

  // ═══════════════════════════════════════════
  // Process well-formed JSON body
  // ═══════════════════════════════════════════
  function processStructured(body, result, keys) {
    let found = false;
    for (const key of keys) {
      let samples = body[key];
      if (!samples) continue;
      if (!Array.isArray(samples)) {
        if (typeof samples === "string") {
          try { samples = JSON.parse(samples); } catch { continue; }
          if (!Array.isArray(samples)) continue;
        } else if (typeof samples === "object") {
          samples = [samples];
        } else continue;
      }
      if (!samples.length) { console.log(`  ${key}: empty array, skipping`); continue; }
      found = true;

      // Check if samples have dates or are just plain numbers
      const hasDate = samples.some((s) =>
        typeof s === "object" && s !== null &&
        (s.date || s.Date || s.startDate || s["Start Date"] || s.Start_Date)
      );
      const allNumbers = samples.every((s) => typeof s === "number" || (typeof s === "string" && !isNaN(parseFloat(s))));

      if (hasDate) {
        // Samples with dates — normal processing
        let count = 0;
        for (const sample of samples) {
          const d = extractDate(sample);
          if (!d) continue;
          let v = extractValue(sample);
          if (v === null) continue;
          v = normalizeValue(key, v);
          addToResult(result, d, key, v);
          count++;
        }
        console.log(`  ${key}: ${count}/${samples.length} with dates`);
      } else if (allNumbers) {
        // Plain number array — assign dates backwards from today
        const nums = samples.map((s) => typeof s === "number" ? s : parseFloat(s)).filter((n) => !isNaN(n));
        assignDatesBackward(result, key, nums);
        console.log(`  ${key}: ${nums.length} plain numbers, dates assigned backward`);
      } else {
        console.log(`  ${key}: ${samples.length} samples, unrecognized format, first:`, JSON.stringify(samples[0]).slice(0, 200));
      }
    }
    return found;
  }

  // ═══════════════════════════════════════════
  // Extract from malformed Shortcuts text
  // ═══════════════════════════════════════════
  function extractFromText(text, result, keys) {
    for (const key of keys) {
      const keyPat = new RegExp(`"${key}"\\s*:\\s*`, "i");
      const match = keyPat.exec(text);
      if (!match) continue;

      const startIdx = match.index + match[0].length;
      let endIdx = text.length;
      for (const other of keys) {
        if (other === key) continue;
        const otherMatch = new RegExp(`"${other}"\\s*:`, "i").exec(text.slice(startIdx));
        if (otherMatch && otherMatch.index < endIdx - startIdx) endIdx = startIdx + otherMatch.index;
      }
      const section = text.slice(startIdx, endIdx).trim();
      console.log(`  Section "${key}" (${section.length} chars): ${section.slice(0, 300)}`);

      if (!section || section === "[]" || section === "" || section.match(/^\[?\s*\]?$/)) {
        console.log(`    Empty section for ${key}, skipping`);
        continue;
      }

      // Strategy 1: section is a newline/comma-separated list of plain numbers
      const plainNums = extractPlainNumbers(section, key);
      if (plainNums.length > 0) {
        assignDatesBackward(result, key, plainNums);
        console.log(`    Extracted ${plainNums.length} plain numbers for ${key}`);
        continue;
      }

      // Strategy 2: section has "Value:" labels with dates
      const dated = extractDatedValues(section, key);
      if (dated.length > 0) {
        for (const { date, value } of dated) {
          addToResult(result, date, key, normalizeValue(key, value));
        }
        console.log(`    Extracted ${dated.length} dated values for ${key}`);
        continue;
      }

      console.log(`    No usable data found for ${key}`);
    }
  }

  // ═══════════════════════════════════════════
  // Extract plain numbers from a section
  // ═══════════════════════════════════════════
  function extractPlainNumbers(section, metric) {
    // Remove brackets, split by newlines/commas/whitespace
    const cleaned = section.replace(/[\[\]{}]/g, "").trim();
    if (!cleaned) return [];

    const parts = cleaned.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    const nums = [];
    for (const part of parts) {
      // Extract first number from each part (handles "74 bpm", "185.4 lb", etc.)
      const m = part.match(/(\d+\.?\d*)/);
      if (!m) continue;
      const n = parseFloat(m[1]);
      if (isNaN(n) || n === 0) continue;
      // Skip obvious years
      if (n >= 2020 && n <= 2040) continue;
      nums.push(n);
    }
    return nums;
  }

  // ═══════════════════════════════════════════
  // Extract date+value pairs from text
  // ═══════════════════════════════════════════
  function extractDatedValues(section, metric) {
    const results = [];
    // Look for "Value:" patterns near dates
    const isoPat = /(\d{4}-\d{2}-\d{2})/g;
    const localePat = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+\d{4}/gi;

    const dates = [];
    let m;
    while ((m = isoPat.exec(section)) !== null) dates.push({ date: m[1], idx: m.index });
    while ((m = localePat.exec(section)) !== null) {
      const p = new Date(m[0]);
      if (!isNaN(p)) dates.push({ date: fmtDate(p), idx: m.index });
    }

    for (const d of dates) {
      const after = section.slice(d.idx, d.idx + 300);
      const vMatch = after.match(/Value:\s*(\d+\.?\d*)/i);
      if (vMatch) {
        const n = parseFloat(vMatch[1]);
        if (n > 0) results.push({ date: d.date, value: n });
      }
    }
    return results;
  }

  // ═══════════════════════════════════════════
  // Assign dates backward from today
  // ═══════════════════════════════════════════
  function assignDatesBackward(result, metric, nums) {
    if (!nums.length) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Most recent value = today, previous = yesterday, etc.
    // nums[0] is the most recent (Shortcuts returns newest first)
    for (let i = 0; i < nums.length; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = fmtDate(d);
      let val = normalizeValue(metric, nums[i]);
      addToResult(result, dateStr, metric, val);
    }
  }

  // ═══════════════════════════════════════════
  // Add value to result (sum for steps/calories)
  // ═══════════════════════════════════════════
  function addToResult(result, dateStr, metric, val) {
    if (!result[dateStr]) result[dateStr] = {};
    if (metric === "steps" || metric === "activeCalories") {
      result[dateStr][metric] = +((result[dateStr][metric] || 0) + val).toFixed(1);
    } else {
      result[dateStr][metric] = val;
    }
  }

  // ═══════════════════════════════════════════
  // Normalize a value (sleep conversion, rounding)
  // ═══════════════════════════════════════════
  function normalizeValue(metric, val) {
    if (metric === "sleep" && val > 24) val = +(val / 3600).toFixed(1);
    return +val.toFixed(1);
  }

  function extractDate(sample) {
    if (typeof sample === "number") return null;
    if (typeof sample === "string") { const d = new Date(sample); return isNaN(d) ? null : fmtDate(d); }
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
};
