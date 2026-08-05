const DATA_BASE =
  "./data";

const DATA_PATHS = {
  xray: `${DATA_BASE}/latest_X-ray_60m.json`,
  state: `${DATA_BASE}/latest_state.json`,
  prediction: `${DATA_BASE}/prediction.json`,
};

const REFRESH_INTERVAL_MS = 30_000;
const Y_MIN = 1e-7;
const Y_MAX = 1e-2;
const Y_TICKS = [1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2];
const Y_TICK_LABELS = ["10⁻⁷", "10⁻⁶", "10⁻⁵", "10⁻⁴", "10⁻³", "10⁻²"];

let lastRenderKey = null;
let isRefreshing = false;

function fetchJson(path) {
  const separator = path.includes("?") ? "&" : "?";

  return fetch(`${path}${separator}v=${Date.now()}`, {
    cache: "no-store",
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`${path}: HTTP ${response.status}`);
    }

    return response.json();
  });
}

function formatScientific(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "—";
  }

  return numericValue.toExponential(2);
}

function formatMinutes(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? `${numericValue} min` : "—";
}

function parseDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (!value || typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  if (["none", "pending", "-", "—"].includes(text.toLowerCase())) {
    return null;
  }

  let normalized = text.replace(" ", "T");

  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(normalized)) {
    normalized += "Z";
  }

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatPlotlyUtc(value) {
  const date = value instanceof Date ? value : parseDate(value);

  if (!date) {
    return null;
  }

  const pad = (number) => String(number).padStart(2, "0");

  return (
    `${date.getUTCFullYear()}-` +
    `${pad(date.getUTCMonth() + 1)}-` +
    `${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:` +
    `${pad(date.getUTCMinutes())}:` +
    `${pad(date.getUTCSeconds())}`
  );
}

function formatUtc(value) {
  const date = value instanceof Date ? value : parseDate(value);

  if (!date) {
    const text = String(value ?? "").trim().toLowerCase();

    if (value && !["none", "pending", "-", "—"].includes(text)) {
      return String(value);
    }

    return "—";
  }

  const pad = (number) => String(number).padStart(2, "0");

  return (
    `${date.getUTCFullYear()}-` +
    `${pad(date.getUTCMonth() + 1)}-` +
    `${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:` +
    `${pad(date.getUTCMinutes())} UTC`
  );
}

function normalizeState(value) {
  return String(value ?? "UNAVAILABLE").trim().toUpperCase();
}

function stateDisplayName(value) {
  const stateName = normalizeState(value);

  const labels = {
    MONITORING: "Monitoring",
    EVENT_START: "Event Start",
    EVENT_RISE: "Event Rise",
    EVENT_PEAK: "Event Peak",
    EVENT_PEAK_SATURATED: "Event Peak Saturated",
    EVENT_DECLINE: "Event Decline",
    EVENT_END: "Event End",
    POST_EVENT: "Post Event",
    IMPAIRED: "Impaired",
    UNAVAILABLE: "Unavailable",
  };

  return labels[stateName] ?? stateName;
}

function stateClassName(value) {
  const stateName = normalizeState(value);

  if (stateName === "MONITORING") return "state-monitoring";
  if (stateName === "EVENT_START") return "state-start";
  if (stateName === "EVENT_RISE") return "state-rise";
  if (["EVENT_PEAK", "EVENT_PEAK_SATURATED"].includes(stateName)) {
    return "state-peak";
  }
  if (stateName === "EVENT_DECLINE") return "state-decline";
  if (["EVENT_END", "POST_EVENT"].includes(stateName)) {
    return "state-ended";
  }
  if (stateName === "IMPAIRED") return "state-impaired";

  return "state-unavailable";
}

function setText(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = value;
  }
}

function renderCurrentFlare(state) {
  const stateName = normalizeState(state?.state ?? state?.flare_state);
  const stateElement = document.getElementById("flare-state");

  if (stateElement) {
    stateElement.textContent = stateDisplayName(stateName);
    stateElement.className =
      `state-badge ${stateClassName(stateName)}`;
  }

  setText("flare-start-time", formatUtc(state?.start_time));
  setText("flare-start-flux", formatScientific(state?.start_flux));
  setText("flare-peak-time", formatUtc(state?.peak_time));
  setText("flare-peak-flux", formatScientific(state?.peak_flux));
  setText("flare-end-time", formatUtc(state?.end_time));
  setText("flare-end-flux", formatScientific(state?.end_flux));
  setText("flare-detection-time", formatUtc(state?.flare_detection_time));
  setText("minutes-after-onset", formatMinutes(state?.minutes_after_onset));
  setText(
    "minutes-after-detection",
    formatMinutes(state?.minutes_after_detection)
  );
}

function predictionBelongsToCurrentFlare(state, predictionData) {
  if (state?.event_active !== true) {
    return false;
  }

  const stateDetectionTime = parseDate(state?.flare_detection_time);
  const predictionDetectionTime = parseDate(
    predictionData?.flare_detection_time
  );

  if (!stateDetectionTime || !predictionDetectionTime) {
    return false;
  }

  return stateDetectionTime.getTime() === predictionDetectionTime.getTime();
}

function getValidPrediction(state, predictionData) {
  if (!predictionBelongsToCurrentFlare(state, predictionData)) {
    return null;
  }

  const predicted = Number(predictionData?.prediction);
  const lower = Number(predictionData?.prediction_interval?.lower);
  const upper = Number(predictionData?.prediction_interval?.upper);

  if (
    ![predicted, lower, upper].every(Number.isFinite) ||
    predicted <= 0 ||
    lower <= 0 ||
    upper <= 0 ||
    lower > predicted ||
    upper < predicted
  ) {
    return null;
  }

  return { predicted, lower, upper };
}

function makeSharedYAxis() {
  return {
    title: { text: "X-ray Flux (W m⁻²)", standoff: 10 },
    type: "log",
    range: [Math.log10(Y_MIN), Math.log10(Y_MAX)],
    tickvals: Y_TICKS,
    ticktext: Y_TICK_LABELS,
    showgrid: true,
    gridcolor: "#dfe5ec",
    minor: { showgrid: true, gridcolor: "#f0f3f7" },
    zeroline: false,
    fixedrange: true,
  };
}

function makeClassBoundaryShapes() {
  return [1e-6, 1e-5, 1e-4].map((value) => ({
    type: "line",
    xref: "paper",
    x0: 0,
    x1: 1,
    yref: "y",
    y0: value,
    y1: value,
    line: { color: "#aab4c0", width: 1, dash: "dot" },
    layer: "below",
  }));
}

function makePlotConfig() {
  return {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d"],
  };
}

function renderObservationChart(plotTimes, fluxes, firstTime, lastTime) {
  const observedTrace = {
    x: plotTimes,
    y: fluxes,
    type: "scatter",
    mode: "lines",
    name: "Observed X-ray flux",
    connectgaps: false,
    line: { color: "#145da0", width: 2.5 },
    hovertemplate:
      "%{x|%b %d, %Y %H:%M UTC}" +
      "<br>Flux: %{y:.2e} W m⁻²" +
      "<extra></extra>",
  };

  const layout = {
    margin: { l: 78, r: 28, t: 20, b: 78 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    hovermode: "closest",
    showlegend: false,
    xaxis: {
      title: { text: "Time (UTC)", standoff: 14 },
      type: "date",
      range: [formatPlotlyUtc(firstTime), formatPlotlyUtc(lastTime)],
      showgrid: true,
      gridcolor: "#e5eaf0",
      zeroline: false,
      tickformat: "%b %d<br>%H:%M",
      hoverformat: "%b %d, %Y %H:%M UTC",
      rangeslider: { visible: false },
    },
    yaxis: makeSharedYAxis(),
    shapes: makeClassBoundaryShapes(),
  };

  Plotly.react("xray-chart", [observedTrace], layout, makePlotConfig());
}

function renderPredictionSummary(prediction) {
  if (!prediction) {
    setText("prediction-value", "—");
    setText("prediction-range", "—");
    return;
  }

  setText("prediction-value", formatScientific(prediction.predicted));
  setText(
    "prediction-range",
    `${formatScientific(prediction.lower)} – ${formatScientific(prediction.upper)}`
  );
}

function renderPredictionChart(prediction) {
  const traces = [];
  const annotations = [];

  if (prediction) {
    traces.push({
      x: [0],
      y: [prediction.predicted],
      type: "scatter",
      mode: "markers",
      name: "Predicted peak flux",
      marker: {
        color: "#d62828",
        size: 18,
        line: { color: "#ffffff", width: 2 },
      },
      error_y: {
        type: "data",
        symmetric: false,
        array: [prediction.upper - prediction.predicted],
        arrayminus: [prediction.predicted - prediction.lower],
        visible: true,
        color: "#d62828",
        thickness: 2.5,
        width: 12,
      },
      customdata: [[prediction.lower, prediction.upper]],
      hovertemplate:
        "<b>Predicted peak:</b> %{y:.2e} W m⁻²" +
        "<br>Upper: %{customdata[1]:.2e} W m⁻²" +
        "<br>Lower: %{customdata[0]:.2e} W m⁻²" +
        "<extra></extra>",
    });
  } else {
    traces.push({
      x: [0],
      y: [null],
      type: "scatter",
      mode: "markers",
      hoverinfo: "skip",
      showlegend: false,
    });

    annotations.push({
      xref: "paper",
      yref: "paper",
      x: 0.5,
      y: 0.5,
      text: "No active nowcast",
      showarrow: false,
      font: { color: "#637083", size: 14 },
      bgcolor: "rgba(248, 250, 252, 0.92)",
      bordercolor: "#dce3ec",
      borderwidth: 1,
      borderpad: 8,
    });
  }

  const layout = {
    margin: { l: 78, r: 28, t: 20, b: 78 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    hovermode: "closest",
    showlegend: false,
    xaxis: {
      type: "linear",
      range: [-0.75, 0.75],
      tickvals: [0],
      ticktext: ["Nowcast"],
      showgrid: false,
      zeroline: false,
      fixedrange: true,
    },
    yaxis: makeSharedYAxis(),
    shapes: makeClassBoundaryShapes(),
    annotations,
  };

  Plotly.react("prediction-chart", traces, layout, makePlotConfig());
  renderPredictionSummary(prediction);
}

function renderCharts(xrayData, state, predictionData) {
  const rows = Array.isArray(xrayData) ? xrayData : [];
  const timeDates = rows.map((row) => parseDate(row.time_tag));
  const plotTimes = timeDates.map((date) =>
    date ? formatPlotlyUtc(date) : null
  );
  const fluxes = rows.map((row) => {
    const flux = Number(row.flux);
    return Number.isFinite(flux) && flux > 0 ? flux : null;
  });
  const validTimes = timeDates.filter(Boolean);

  if (validTimes.length === 0) {
    throw new Error(
      "No valid time_tag values were found in latest_X-ray_60m.json."
    );
  }

  const firstTime = validTimes[0];
  const lastTime = validTimes[validTimes.length - 1];
  const prediction = getValidPrediction(state, predictionData);

  const renderKey = JSON.stringify({
    rows,
    state: state?.state ?? state?.flare_state ?? null,
    eventActive: state?.event_active ?? null,
    flareDetectionTime: state?.flare_detection_time ?? null,
    predictionDetectionTime: predictionData?.flare_detection_time ?? null,
    prediction: prediction?.predicted ?? null,
    lower: prediction?.lower ?? null,
    upper: prediction?.upper ?? null,
  });

  setText("last-update", formatUtc(lastTime));

  if (renderKey === lastRenderKey) {
    return;
  }

  renderObservationChart(plotTimes, fluxes, firstTime, lastTime);
  renderPredictionChart(prediction);
  lastRenderKey = renderKey;
}

async function refreshDashboard() {
  if (isRefreshing) {
    return;
  }

  isRefreshing = true;
  const message = document.getElementById("chart-message");

  try {
    const [xrayResult, stateResult, predictionResult] =
      await Promise.allSettled([
        fetchJson(DATA_PATHS.xray),
        fetchJson(DATA_PATHS.state),
        fetchJson(DATA_PATHS.prediction),
      ]);

    if (xrayResult.status === "rejected") {
      throw xrayResult.reason;
    }

    const xrayData = xrayResult.value;
    const stateData =
      stateResult.status === "fulfilled" ? stateResult.value : null;
    const predictionData =
      predictionResult.status === "fulfilled"
        ? predictionResult.value
        : null;

    if (stateResult.status === "rejected") {
      console.error("Failed to load latest_state.json:", stateResult.reason);
    }

    if (predictionResult.status === "rejected") {
      console.error(
        "Failed to load prediction.json:",
        predictionResult.reason
      );
    }

    renderCurrentFlare(stateData);
    renderCharts(xrayData, stateData, predictionData);
    message.hidden = true;
  } catch (error) {
    console.error(error);
    message.textContent =
      `Unable to update the dashboard: ${error.message}`;
    message.hidden = false;
  } finally {
    isRefreshing = false;
    setText("page-refresh-time", `Page refreshed: ${formatUtc(new Date())}`);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  refreshDashboard();
  window.setInterval(refreshDashboard, REFRESH_INTERVAL_MS);
});
