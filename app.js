/* =========================================================
   PROGRAM TARGET ANALYZER
   Harry Bougard Tools

   Pipeline:

   Genre
      ↓
   MusicBrainz recording search
      ↓
   AcousticBrainz low-level data
      ↓
   27 Bark bands
      ↓
   per-track spectral normalization
      ↓
   median / mean
      ↓
   PROGRAM TARGET

   This is intentionally an MVP.
========================================================= */


/* =========================================================
   CONFIG
========================================================= */

const MB_API = "https://musicbrainz.org/ws/2";
const AB_API = "https://acousticbrainz.org/api/v1";

const MAX_MB_RESULTS = 100;

const BARK_CENTERS = [
  50,
  100,
  150,
  250,
  350,
  450,
  570,
  700,
  840,
  1000,
  1170,
  1370,
  1600,
  1850,
  2150,
  2500,
  2900,
  3400,
  4000,
  4800,
  5800,
  7000,
  8500,
  10500,
  13000,
  15500,
  19000
];


/*
  Approximate centers for the 27 Bark bands.

  AcousticBrainz exposes the Bark-band feature extracted
  by Essentia. We use the band sequence as the common
  spectral coordinate and map it to practical frequency
  centers for visualization/export.
*/


let programCurve = null;
let programRange = null;
let programTracks = [];
let currentGenre = "";
let currentStats = null;


/* =========================================================
   DOM
========================================================= */

const genreSelect = document.getElementById("genreSelect");
const customGenre = document.getElementById("customGenre");
const trackLimit = document.getElementById("trackLimit");
const statisticSelect = document.getElementById("statistic");
const analyzeBtn = document.getElementById("analyzeBtn");

const systemCurveInput = document.getElementById("systemCurve");
const toleranceInput = document.getElementById("tolerance");

const analysisTitle = document.getElementById("analysisTitle");
const analysisSubtitle = document.getElementById("analysisSubtitle");

const trackCount = document.getElementById("trackCount");
const analyzedCount = document.getElementById("analyzedCount");
const confidence = document.getElementById("confidence");

const lowDelta = document.getElementById("lowDelta");
const midDelta = document.getElementById("midDelta");
const highDelta = document.getElementById("highDelta");

const dataSource = document.getElementById("dataSource");
const methodText = document.getElementById("methodText");

const spectrumCanvas = document.getElementById("spectrumCanvas");
const logOutput = document.getElementById("logOutput");
const statusText = document.getElementById("statusText");
const statusLed = document.getElementById("statusLed");


/* =========================================================
   UI EVENTS
========================================================= */

genreSelect.addEventListener("change", () => {

  if (genreSelect.value === "custom") {
    customGenre.classList.remove("hidden");
    customGenre.focus();
  } else {
    customGenre.classList.add("hidden");
  }

});


analyzeBtn.addEventListener("click", analyzeGenre);

document.getElementById("clearLog").addEventListener("click", () => {
  logOutput.innerHTML = "";
});


document.getElementById("exportTxt").addEventListener("click", exportTXT);
document.getElementById("exportCsv").addEventListener("click", exportCSV);
document.getElementById("exportJson").addEventListener("click", exportJSON);
document.getElementById("exportPng").addEventListener("click", exportPNG);

window.addEventListener("resize", drawGraph);

systemCurveInput.addEventListener("input", () => {
  drawGraph();
  updateComparison();
});


toleranceInput.addEventListener("change", () => {
  updateComparison();
  drawGraph();
});


/* =========================================================
   STATUS / LOG
========================================================= */

function setStatus(state) {

  statusText.textContent = state;

  if (state === "READY") {
    statusLed.style.background = "var(--cyan)";
    statusLed.style.boxShadow = "0 0 7px rgba(41,215,230,.65)";
  }

  if (state === "ANALYZING") {
    statusLed.style.background = "var(--orange)";
    statusLed.style.boxShadow = "0 0 7px rgba(216,161,94,.65)";
  }

  if (state === "COMPLETE") {
    statusLed.style.background = "var(--green)";
    statusLed.style.boxShadow = "0 0 7px rgba(120,214,139,.65)";
  }

  if (state === "ERROR") {
    statusLed.style.background = "var(--red)";
    statusLed.style.boxShadow = "0 0 7px rgba(223,109,109,.65)";
  }
}


function log(message) {

  const line = document.createElement("div");
  line.textContent = `> ${message}`;

  logOutput.appendChild(line);

  while (logOutput.children.length > 30) {
    logOutput.removeChild(logOutput.firstChild);
  }

  logOutput.scrollTop = logOutput.scrollHeight;
}


/* =========================================================
   GENRE
========================================================= */

function getGenre() {

  if (genreSelect.value === "custom") {
    return customGenre.value.trim();
  }

  return genreSelect.value;
}


/* =========================================================
   MUSICBRAINZ
========================================================= */

async function searchMusicBrainz(genre, limit) {

  const query = `tag:"${genre.replaceAll('"', "")}"`;

  const params = new URLSearchParams({
    query,
    limit: Math.min(limit, MAX_MB_RESULTS),
    offset: 0,
    fmt: "json"
  });

  const url = `${MB_API}/recording?${params.toString()}`;

  log(`MusicBrainz query: ${genre}`);

  const response = await fetch(url, {
    headers: {
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`MusicBrainz HTTP ${response.status}`);
  }

  const data = await response.json();

  const recordings = Array.isArray(data.recordings)
    ? data.recordings
    : [];

  /*
    Remove obvious duplicates by MBID.
  */

  const unique = [];
  const seen = new Set();

  for (const recording of recordings) {

    if (!recording.id) continue;

    if (seen.has(recording.id)) continue;

    seen.add(recording.id);

    unique.push({
      id: recording.id,
      title: recording.title || "Unknown",
      artist: getArtistName(recording)
    });
  }

  return unique;
}


function getArtistName(recording) {

  if (!recording["artist-credit"]) {
    return "Unknown Artist";
  }

  return recording["artist-credit"]
    .map(item => item.name || item.artist?.name || "")
    .join("")
    .trim() || "Unknown Artist";
}


/* =========================================================
   ACOUSTICBRAINZ
========================================================= */

async function fetchAcousticBrainz(mbids) {

  if (!mbids.length) {
    return {};
  }

  /*
    AcousticBrainz bulk endpoint accepts up to 25 MBIDs.
  */

  const chunks = chunk(mbids, 25);

  const all = {};

  for (let i = 0; i < chunks.length; i++) {

    const ids = chunks[i].join(";");

    const params = new URLSearchParams({
      recording_ids: ids
    });

    /*
      Ask only for barkbands and metadata.
      This keeps the response considerably smaller.
    */

    params.set(
      "features",
      "metadata.tags;metadata.audio_properties;lowlevel.barkbands"
    );

    const url = `${AB_API}/low-level?${params.toString()}`;

    log(`AcousticBrainz batch ${i + 1}/${chunks.length}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`AcousticBrainz HTTP ${response.status}`);
    }

    const data = await response.json();

    Object.assign(all, data);

    /*
      Small delay between bulk requests.
      This keeps the prototype polite to the public API.
    */

    if (i < chunks.length - 1) {
      await sleep(350);
    }
  }

  return all;
}


/* =========================================================
   ANALYSIS
========================================================= */

async function analyzeGenre() {

  const genre = getGenre();

  if (!genre) {
    log("ERROR: no genre selected.");
    setStatus("ERROR");
    return;
  }

  currentGenre = genre;

  setStatus("ANALYZING");

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "ANALYZING...";

  clearResult();

  try {

    const requestedTracks = Number(trackLimit.value);

    log(`Starting dataset: ${genre}`);
    log(`Requested candidates: ${requestedTracks}`);

    const recordings = await searchMusicBrainz(
      genre,
      Math.max(requestedTracks * 3, 25)
    );

    trackCount.textContent = recordings.length;

    log(`MusicBrainz returned ${recordings.length} candidates.`);

    const mbids = recordings.map(track => track.id);

    const acoustic = await fetchAcousticBrainz(mbids);

    const analyzed = [];

    for (const recording of recordings) {

      const document = findAcousticDocument(
        acoustic,
        recording.id
      );

      if (!document) continue;

      const bands = extractBarkBands(document);

      if (!bands || bands.length < 20) continue;

      const normalized = normalizeSpectralShape(bands);

      analyzed.push({
        ...recording,
        bands: normalized
      });

      if (analyzed.length >= requestedTracks) {
        break;
      }
    }

    if (analyzed.length < 3) {
      throw new Error(
        "Too few tracks with AcousticBrainz spectral data for this genre."
      );
    }

    programTracks = analyzed;

    analyzedCount.textContent = analyzed.length;

    programCurve = calculateStatistic(
      analyzed.map(track => track.bands),
      statisticSelect.value
    );

    programRange = calculatePercentiles(
      analyzed.map(track => track.bands),
      25,
      75
    );

    currentStats = {
      genre,
      tracksFound: recordings.length,
      tracksAnalyzed: analyzed.length,
      statistic: statisticSelect.value,
      frequencies: BARK_CENTERS,
      target: programCurve,
      p25: programRange.p25,
      p75: programRange.p75
    };

    updateResultUI();

    drawGraph();

    updateComparison();

    setStatus("COMPLETE");

    log(
      `Completed: ${analyzed.length} tracks analyzed.`
    );

    log(
      `Statistic: ${statisticSelect.value.toUpperCase()}`
    );

    log(
      `Target generated from normalized Bark-band spectral shape.`
    );

  } catch (error) {

    console.error(error);

    setStatus("ERROR");

    analysisSubtitle.textContent = error.message;

    log(`ERROR: ${error.message}`);

  } finally {

    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "GENERATE PROGRAM TARGET";

  }
}


/* =========================================================
   FIND AB DOCUMENT
========================================================= */

function findAcousticDocument(database, mbid) {

  /*
    AcousticBrainz bulk responses normally look like:

    {
      mbid: {
        "0": {
          lowlevel: {...}
        }
      }
    }

    We also support a direct document just in case.
  */

  const direct = database[mbid];

  if (!direct) return null;

  if (direct.lowlevel) {
    return direct;
  }

  if (direct["0"]) {
    return direct["0"];
  }

  const firstKey = Object.keys(direct)[0];

  if (firstKey && direct[firstKey]) {
    return direct[firstKey];
  }

  return null;
}


/* =========================================================
   BARK EXTRACTION
========================================================= */

function extractBarkBands(document) {

  const lowlevel =
    document.lowlevel ||
    document;

  const bark =
    lowlevel.barkbands;

  if (!bark) {
    return null;
  }

  /*
    "mean" is the overall spectral energy of each
    Bark band across the recording.

    Some documents may expose "dmean" instead.
  */

  const values =
    Array.isArray(bark.mean)
      ? bark.mean
      : Array.isArray(bark.dmean)
        ? bark.dmean
        : null;

  if (!values) {
    return null;
  }

  return values
    .slice(0, 27)
    .map(Number)
    .filter(value => Number.isFinite(value) && value > 0);
}


/* =========================================================
   NORMALIZE SPECTRAL SHAPE
========================================================= */

function normalizeSpectralShape(values) {

  /*
    We deliberately remove absolute level.

    Each track is reduced to spectral SHAPE.

    Geometric mean = 0 dB reference.
  */

  const safe = values.map(value =>
    Math.max(value, 1e-12)
  );

  const logValues = safe.map(value =>
    10 * Math.log10(value)
  );

  const reference =
    median(logValues);

  return logValues.map(value =>
    value - reference
  );
}


/* =========================================================
   STATISTICS
========================================================= */

function calculateStatistic(matrix, statistic) {

  const bands = matrix[0].length;

  const output = [];

  for (let band = 0; band < bands; band++) {

    const values = matrix
      .map(row => row[band])
      .filter(Number.isFinite);

    if (statistic === "mean") {

      const mean =
        values.reduce((a, b) => a + b, 0) /
        values.length;

      output.push(mean);

    } else {

      output.push(median(values));

    }
  }

  return output;
}


function calculatePercentiles(matrix, lowPercent, highPercent) {

  const bands = matrix[0].length;

  const p25 = [];
  const p75 = [];

  for (let band = 0; band < bands; band++) {

    const values = matrix
      .map(row => row[band])
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    p25.push(percentile(values, lowPercent));
    p75.push(percentile(values, highPercent));
  }

  return {
    p25,
    p75
  };
}


function percentile(sorted, percent) {

  if (!sorted.length) {
    return NaN;
  }

  const index =
    (percent / 100) *
    (sorted.length - 1);

  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight = index - lower;

  return (
    sorted[lower] * (1 - weight) +
    sorted[upper] * weight
  );
}


function median(values) {

  if (!values.length) {
    return NaN;
  }

  const sorted = [...values].sort((a, b) => a - b);

  const middle =
    Math.floor(sorted.length / 2);

  if (sorted.length % 2) {
    return sorted[middle];
  }

  return (
    (sorted[middle - 1] +
      sorted[middle]) / 2
  );
}


/* =========================================================
   SYSTEM CURVE
========================================================= */

function parseCurve(text) {

  const points = [];

  const lines = text.split(/\r?\n/);

  for (const line of lines) {

    const clean =
      line
        .replace(/#.*/, "")
        .replace(/,/g, " ")
        .trim();

    if (!clean) continue;

    const parts =
      clean.split(/\s+/);

    if (parts.length < 2) continue;

    const frequency = Number(parts[0]);
    const gain = Number(parts[1]);

    if (
      Number.isFinite(frequency) &&
      Number.isFinite(gain) &&
      frequency > 0
    ) {
      points.push({
        frequency,
        gain
      });
    }
  }

  points.sort(
    (a, b) => a.frequency - b.frequency
  );

  return points;
}


function interpolateCurve(points, frequency) {

  if (!points.length) return 0;

  if (frequency <= points[0].frequency) {
    return points[0].gain;
  }

  if (
    frequency >=
    points[points.length - 1].frequency
  ) {
    return points[points.length - 1].gain;
  }

  for (let i = 0; i < points.length - 1; i++) {

    const a = points[i];
    const b = points[i + 1];

    if (
      frequency >= a.frequency &&
      frequency <= b.frequency
    ) {

      const x =
        (Math.log10(frequency) -
          Math.log10(a.frequency)) /
        (Math.log10(b.frequency) -
          Math.log10(a.frequency));

      return (
        a.gain +
        (b.gain - a.gain) * x
      );
    }
  }

  return 0;
}


/* =========================================================
   COMPARISON
========================================================= */

function updateComparison() {

  if (!programCurve) {

    lowDelta.textContent = "—";
    midDelta.textContent = "—";
    highDelta.textContent = "—";

    return;
  }

  const system =
    parseCurve(systemCurveInput.value);

  if (!system.length) return;

  const differences = BARK_CENTERS.map(
    (frequency, index) => {

      const systemGain =
        interpolateCurve(system, frequency);

      return (
        programCurve[index] -
        systemGain
      );
    }
  );

  /*
    Practical summary regions.

    Low:
    20–160 Hz

    Mid:
    160–2500 Hz

    High:
    2500–20000 Hz
  */

  const low =
    averageRegion(
      differences,
      20,
      160
    );

  const mid =
    averageRegion(
      differences,
      160,
      2500
    );

  const high =
    averageRegion(
      differences,
      2500,
      20000
    );

  lowDelta.textContent = formatDb(low);
  midDelta.textContent = formatDb(mid);
  highDelta.textContent = formatDb(high);
}


function averageRegion(values, minFreq, maxFreq) {

  const selected = [];

  for (let i = 0; i < BARK_CENTERS.length; i++) {

    const frequency = BARK_CENTERS[i];

    if (
      frequency >= minFreq &&
      frequency <= maxFreq
    ) {
      selected.push(values[i]);
    }
  }

  if (!selected.length) return 0;

  return (
    selected.reduce((a, b) => a + b, 0) /
    selected.length
  );
}


function formatDb(value) {

  if (!Number.isFinite(value)) {
    return "—";
  }

  const sign =
    value > 0 ? "+" : "";

  return `${sign}${value.toFixed(1)} dB`;
}


/* =========================================================
   RESULT UI
========================================================= */

function updateResultUI() {

  analysisTitle.textContent =
    currentGenre.toUpperCase();

  analysisSubtitle.textContent =
    `${programTracks.length} analyzed recordings / spectral median`;

  confidence.textContent =
    confidenceLabel(programTracks.length);

  dataSource.textContent =
    "MusicBrainz + AcousticBrainz";

  methodText.textContent =
    `${statisticSelect.value.toUpperCase()} / SHAPE NORMALIZED`;
}


function confidenceLabel(count) {

  if (count >= 25) return "25+";
  if (count >= 15) return "15+";
  if (count >= 8) return "8+";
  return "LOW";
}


function clearResult() {

  programCurve = null;
  programRange = null;
  programTracks = [];
  currentStats = null;

  trackCount.textContent = "0";
  analyzedCount.textContent = "0";
  confidence.textContent = "—";

  analysisTitle.textContent = "ANALYZING";
  analysisSubtitle.textContent =
    "Building spectral dataset...";

  lowDelta.textContent = "—";
  midDelta.textContent = "—";
  highDelta.textContent = "—";

  drawGraph();
}


/* =========================================================
   GRAPH
========================================================= */

function drawGraph() {

  const canvas = spectrumCanvas;

  const rect =
    canvas.getBoundingClientRect();

  const dpr =
    window.devicePixelRatio || 1;

  canvas.width =
    Math.max(1, Math.floor(rect.width * dpr));

  canvas.height =
    Math.max(1, Math.floor(rect.height * dpr));

  const ctx =
    canvas.getContext("2d");

  ctx.setTransform(
    dpr,
    0,
    0,
    dpr,
    0,
    0
  );

  const width = rect.width;
  const height = rect.height;

  ctx.clearRect(
    0,
    0,
    width,
    height
  );

  const margin = {
    left: 43,
    right: 15,
    top: 31,
    bottom: 31
  };

  const x0 = margin.left;
  const x1 = width - margin.right;

  const y0 = margin.top;
  const y1 = height - margin.bottom;

  drawGrid(
    ctx,
    x0,
    x1,
    y0,
    y1
  );

  if (!programCurve) return;

  drawRange(
    ctx,
    x0,
    x1,
    y0,
    y1
  );

  drawSystemCurve(
    ctx,
    x0,
    x1,
    y0,
    y1
  );

  drawProgramCurve(
    ctx,
    x0,
    x1,
    y0,
    y1
  );
}


function drawGrid(ctx, x0, x1, y0, y1) {

  ctx.lineWidth = 1;

  /*
    Horizontal dB grid.
  */

  for (
    let db = -12;
    db <= 12;
    db += 3
  ) {

    const y =
      mapDbToY(
        db,
        y0,
        y1
      );

    ctx.strokeStyle =
      db === 0
        ? "#344044"
        : "#20282b";

    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
  }


  /*
    Log-frequency grid.
  */

  const frequencies = [
    20,
    30,
    40,
    50,
    60,
    80,
    100,
    200,
    300,
    400,
    500,
    700,
    1000,
    2000,
    3000,
    4000,
    5000,
    7000,
    10000,
    15000,
    20000
  ];

  for (const frequency of frequencies) {

    const x =
      mapFrequencyToX(
        frequency,
        x0,
        x1
      );

    const major =
      [
        20,
        100,
        1000,
        10000,
        20000
      ].includes(frequency);

    ctx.strokeStyle =
      major
        ? "#303b3f"
        : "#1b2225";

    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.stroke();
  }
}


function drawRange(ctx, x0, x1, y0, y1) {

  if (!programRange) return;

  ctx.beginPath();

  for (
    let i = 0;
    i < BARK_CENTERS.length;
    i++
  ) {

    const x =
      mapFrequencyToX(
        BARK_CENTERS[i],
        x0,
        x1
      );

    const y =
      mapDbToY(
        programRange.p75[i],
        y0,
        y1
      );

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  for (
    let i = BARK_CENTERS.length - 1;
    i >= 0;
    i--
  ) {

    const x =
      mapFrequencyToX(
        BARK_CENTERS[i],
        x0,
        x1
      );

    const y =
      mapDbToY(
        programRange.p25[i],
        y0,
        y1
      );

    ctx.lineTo(x, y);
  }

  ctx.closePath();

  ctx.fillStyle =
    "rgba(89,107,113,.18)";

  ctx.fill();
}


function drawProgramCurve(ctx, x0, x1, y0, y1) {

  ctx.strokeStyle = "#29d7e6";
  ctx.lineWidth = 2;

  ctx.beginPath();

  for (
    let i = 0;
    i < BARK_CENTERS.length;
    i++
  ) {

    const x =
      mapFrequencyToX(
        BARK_CENTERS[i],
        x0,
        x1
      );

    const y =
      mapDbToY(
        programCurve[i],
        y0,
        y1
      );

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();


  /*
    Small measurement points.
  */

  ctx.fillStyle = "#29d7e6";

  for (
    let i = 0;
    i < BARK_CENTERS.length;
    i++
  ) {

    const x =
      mapFrequencyToX(
        BARK_CENTERS[i],
        x0,
        x1
      );

    const y =
      mapDbToY(
        programCurve[i],
        y0,
        y1
      );

    ctx.beginPath();
    ctx.arc(x, y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}


function drawSystemCurve(ctx, x0, x1, y0, y1) {

  const points =
    parseCurve(
      systemCurveInput.value
    );

  if (!points.length) return;

  ctx.strokeStyle = "#d8a15e";
  ctx.lineWidth = 1.5;

  ctx.setLineDash([6, 4]);

  ctx.beginPath();

  const samples = 220;

  for (let i = 0; i < samples; i++) {

    const ratio =
      i / (samples - 1);

    const logMin = Math.log10(20);
    const logMax = Math.log10(20000);

    const frequency =
      Math.pow(
        10,
        logMin +
        ratio * (logMax - logMin)
      );

    const gain =
      interpolateCurve(
        points,
        frequency
      );

    const x =
      mapFrequencyToX(
        frequency,
        x0,
        x1
      );

    const y =
      mapDbToY(
        gain,
        y0,
        y1
      );

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();

  ctx.setLineDash([]);
}


function mapFrequencyToX(
  frequency,
  x0,
  x1
) {

  const min =
    Math.log10(20);

  const max =
    Math.log10(20000);

  const value =
    (
      Math.log10(
        Math.max(20, Math.min(20000, frequency))
      ) -
      min
    ) /
    (max - min);

  return x0 + value * (x1 - x0);
}


function mapDbToY(
  db,
  y0,
  y1
) {

  const min = -12;
  const max = 12;

  const clamped =
    Math.max(
      min,
      Math.min(max, db)
    );

  const value =
    (clamped - min) /
    (max - min);

  return y1 -
    value * (y1 - y0);
}


/* =========================================================
   EXPORT
========================================================= */

function exportTXT() {

  if (!programCurve) {
    log("No program target to export.");
    return;
  }

  const lines = [];

  lines.push(
    `# Program Target Analyzer`
  );

  lines.push(
    `# Genre: ${currentGenre}`
  );

  lines.push(
    `# Tracks analyzed: ${programTracks.length}`
  );

  lines.push(
    `# Statistic: ${statisticSelect.value}`
  );

  lines.push(
    `# Model: 27 Bark bands`
  );

  lines.push("");

  for (
    let i = 0;
    i < BARK_CENTERS.length;
    i++
  ) {

    lines.push(
      `${BARK_CENTERS[i]} ${programCurve[i].toFixed(3)}`
    );
  }

  downloadText(
    lines.join("\n"),
    `${slugify(currentGenre)}_program_target.txt`,
    "text/plain"
  );

  log("TXT exported.");
}


function exportCSV() {

  if (!programCurve) {
    log("No program target to export.");
    return;
  }

  const lines = [
    "frequency_hz,program_target_db,p25_db,p75_db"
  ];

  for (
    let i = 0;
    i < BARK_CENTERS.length;
    i++
  ) {

    lines.push(
      [
        BARK_CENTERS[i],
        programCurve[i].toFixed(4),
        programRange.p25[i].toFixed(4),
        programRange.p75[i].toFixed(4)
      ].join(",")
    );
  }

  downloadText(
    lines.join("\n"),
    `${slugify(currentGenre)}_program_target.csv`,
    "text/csv"
  );

  log("CSV exported.");
}


function exportJSON() {

  if (!currentStats) {
    log("No dataset to export.");
    return;
  }

  const output = {
    generator: "Harry Bougard Tools / Program Target Analyzer",
    genre: currentStats.genre,
    tracks_found: currentStats.tracksFound,
    tracks_analyzed: currentStats.tracksAnalyzed,
    statistic: currentStats.statistic,
    frequency_model: "Bark 27",
    frequencies_hz: currentStats.frequencies,
    program_target_db: currentStats.target,
    p25_db: currentStats.p25,
    p75_db: currentStats.p75,
    tracks: programTracks.map(track => ({
      artist: track.artist,
      title: track.title,
      musicbrainz_id: track.id
    }))
  };

  downloadText(
    JSON.stringify(output, null, 2),
    `${slugify(currentGenre)}_program_target.json`,
    "application/json"
  );

  log("JSON exported.");
}


function exportPNG() {

  const link =
    document.createElement("a");

  link.download =
    `${slugify(currentGenre)}_program_target.png`;

  link.href =
    spectrumCanvas.toDataURL("image/png");

  link.click();

  log("Graph exported.");
}


function downloadText(
  content,
  filename,
  type
) {

  const blob =
    new Blob(
      [content],
      { type }
    );

  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);

  link.click();

  link.remove();

  URL.revokeObjectURL(url);
}


function slugify(text) {

  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}


/* =========================================================
   HELPERS
========================================================= */

function chunk(array, size) {

  const output = [];

  for (
    let i = 0;
    i < array.length;
    i += size
  ) {
    output.push(
      array.slice(i, i + size)
    );
  }

  return output;
}


function sleep(ms) {

  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}


/* =========================================================
   INITIALIZE
========================================================= */

drawGraph();
setStatus("READY");