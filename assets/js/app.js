const DATA_BASE =
  "https://raw.githubusercontent.com/KWYi/Flare_Nowcasting/live_data/data";

const DATA_PATHS = {
  xray: `${DATA_BASE}/latest_X-ray_60m.json`,
  state: `${DATA_BASE}/latest_state.json`,
  latestFlare: `${DATA_BASE}/latest_flare.json`,
  prediction: `${DATA_BASE}/prediction.json`,
};

const REFRESH_INTERVAL_MS = 30_000;
const Y_MIN = 1e-7;
const Y_MAX = 1e-2;
const FUTURE_SPACE_MINUTES = 12;
const PREDICTION_X_OFFSET_MINUTES = 7;

function fetchJson(path) {
  const separator = path.includes("?") ? "&" : "?";
  return fetch(`${path}${separator}v=${Date.now()}`, { cache: "no-store" }).then((response) => {
    if (!response.ok) {
      throw new Error(`${path}: HTTP ${response.status}`);
    }
    return response.json();
  });
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function formatScientific(value) {
  if (!isFiniteNumber(value)) return "—";
  return value.toExponential(2);
}

function parseDate(value) {
  if (!value || typeof value !== "string") return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatUtc(value) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return value && !["none", "pending"].includes(String(value).toLowerCase()) ? String(value) : "—";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

function normalizeState(value) {
  return String(value ?? "none").trim().toLowerCase();
}

function renderState(state, latestFlare) {
  const stateName = normalizeState(state?.flare_state);
  const stateElement = document.getElementById("flare-state");
  const active = stateName === "activate";

  stateElement.textContent = active ? "Activate" : "None";
  stateElement.className = `state-badge ${active ? "state-activate" : "state-none"}`;

  document.getElementById("flare-start-time").textContent = formatUtc(latestFlare?.start_time);
  document.getElementById("flare-peak-time").textContent = formatUtc(latestFlare?.peak_time);
  document.getElementById("flare-end-time").textContent = formatUtc(latestFlare?.end_time);
  document.getElementById("flare-peak-flux").textContent = formatScientific(latestFlare?.peak_flux);
}

function makePredictionTraces(predictionX, predictionData) {
  const predicted = predictionData?.prediction;
  const lower = predictionData?.prediction_interval?.lower;
  const upper = predictionData?.prediction_interval?.upper;

  if (![predicted, lower, upper].every(isFiniteNumber)) return { traces: [], annotations: [] };

  const capMilliseconds = 45_000;
  const xLowerCap = new Date(predictionX.getTime() - capMilliseconds);
  const xUpperCap = new Date(predictionX.getTime() + capMilliseconds);

  const intervalTrace = {
    x: [predictionX, predictionX, null, xLowerCap, xUpperCap, null, xLowerCap, xUpperCap],
    y: [lower, upper, null, lower, lower, null, upper, upper],
    type: "scatter",
    mode: "lines",
    name: "Prediction interval",
    line: { color: "#d62828", width: 3 },
    hoverinfo: "skip",
    showlegend: true,
  };

  const markerTrace = {
    x: [predictionX],
    y: [predicted],
    type: "scatter",
    mode: "markers",
    name: "Peak-flux nowcast",
    marker: {
      symbol: "square",
      size: 16,
      color: "#d62828",
      line: { color: "#8f1010", width: 2 },
    },
    customdata: [[lower, upper]],
    hovertemplate:
      "<b>Peak-flux nowcast</b><br>Prediction: %{y:.2e} W m⁻²" +
      "<br>Lower: %{customdata[0]:.2e} W m⁻²" +
      "<br>Upper: %{customdata[1]:.2e} W m⁻²<extra></extra>",
  };

  const annotationStyle = {
    xref: "x",
    yref: "y",
    showarrow: false,
    xanchor: "left",
    xshift: 12,
    font: { color: "#b71919", size: 12 },
    bgcolor: "rgba(255,255,255,0.86)",
    borderpad: 2,
  };

  const annotations = [
    { ...annotationStyle, x: predictionX, y: upper, text: `Upper ${formatScientific(upper)}`, yanchor: "bottom" },
    { ...annotationStyle, x: predictionX, y: predicted, text: `Prediction ${formatScientific(predicted)}`, yanchor: "middle", font: { color: "#b71919", size: 12, weight: 700 } },
    { ...annotationStyle, x: predictionX, y: lower, text: `Lower ${formatScientific(lower)}`, yanchor: "top" },
  ];

  return { traces: [intervalTrace, markerTrace], annotations };
}

function renderChart(xrayData, state, predictionData) {
  const rows = Array.isArray(xrayData) ? xrayData : [];
  const times = rows.map((row) => parseDate(row.time_tag));
  const fluxes = rows.map((row) => (isFiniteNumber(row.flux) && row.flux > 0 ? row.flux : null));
  const validTimes = times.filter(Boolean);

  if (validTimes.length === 0) {
    throw new Error("No valid time_tag values were found in latest_X-ray_60m.json.");
  }

  const firstTime = validTimes[0];
  const lastTime = validTimes[validTimes.length - 1];
  const xAxisEnd = new Date(lastTime.getTime() + FUTURE_SPACE_MINUTES * 60_000);

  const observedTrace = {
    x: times,
    y: fluxes,
    type: "scatter",
    mode: "lines",
    name: "Observed X-ray flux",
    connectgaps: false,
    line: { color: "#145da0", width: 2.5 },
    hovertemplate: "%{x|%Y-%m-%d %H:%M UTC}<br>Flux: %{y:.2e} W m⁻²<extra></extra>",
  };

  const traces = [observedTrace];
  let annotations = [];

  if (normalizeState(state?.flare_state) === "activate") {
    const predictionX = new Date(lastTime.getTime() + PREDICTION_X_OFFSET_MINUTES * 60_000);
    const predictionPlot = makePredictionTraces(predictionX, predictionData);
    traces.push(...predictionPlot.traces);
    annotations = predictionPlot.annotations;
  }

  const layout = {
    margin: { l: 78, r: 32, t: 22, b: 68 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    hovermode: "closest",
    legend: {
      orientation: "h",
      x: 0,
      y: 1.08,
      font: { size: 12 },
    },
    xaxis: {
      title: { text: "Time (UTC)", standoff: 14 },
      type: "date",
      range: [firstTime, xAxisEnd],
      showgrid: true,
      gridcolor: "#e5eaf0",
      zeroline: false,
      tickformat: "%H:%M",
      hoverformat: "%Y-%m-%d %H:%M UTC",
      rangeslider: { visible: false },
    },
    yaxis: {
      title: { text: "X-ray Flux (W m⁻²)", standoff: 10 },
      type: "log",
      range: [Math.log10(Y_MIN), Math.log10(Y_MAX)],
      tickvals: [1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2],
      ticktext: ["10⁻⁷", "10⁻⁶", "10⁻⁵", "10⁻⁴", "10⁻³", "10⁻²"],
      showgrid: true,
      gridcolor: "#dfe5ec",
      minor: { showgrid: true, gridcolor: "#f0f3f7" },
      zeroline: false,
    },
    annotations,
    shapes: [
      { type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: 1e-6, y1: 1e-6, line: { color: "#aab4c0", width: 1, dash: "dot" } },
      { type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: 1e-5, y1: 1e-5, line: { color: "#aab4c0", width: 1, dash: "dot" } },
      { type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: 1e-4, y1: 1e-4, line: { color: "#aab4c0", width: 1, dash: "dot" } },
    ],
  };

  const config = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d"],
  };

  Plotly.react("xray-chart", traces, layout, config);
  document.getElementById("last-update").textContent = formatUtc(lastTime);
}

async function refreshDashboard() {
  const message = document.getElementById("chart-message");

  try {
    const [xrayData, state, latestFlare, prediction] = await Promise.all([
      fetchJson(DATA_PATHS.xray),
      fetchJson(DATA_PATHS.state),
      fetchJson(DATA_PATHS.latestFlare),
      fetchJson(DATA_PATHS.prediction),
    ]);

    renderChart(xrayData, state, prediction);
    renderState(state, latestFlare);
    message.hidden = true;
  } catch (error) {
    console.error(error);
    message.textContent = `Unable to update the dashboard: ${error.message}`;
    message.hidden = false;
  } finally {
    document.getElementById("page-refresh-time").textContent = `Page refreshed: ${formatUtc(new Date())}`;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  refreshDashboard();
  window.setInterval(refreshDashboard, REFRESH_INTERVAL_MS);
});
