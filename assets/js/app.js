const DATA_BASE =
  "https://raw.githubusercontent.com/KWYi/Flare_Nowcasting/live_data/data";

const DATA_PATHS = {
  xray: `${DATA_BASE}/latest_X-ray_60m.json`,
  state: `${DATA_BASE}/latest_state.json`,
  prediction: `${DATA_BASE}/prediction.json`,
};

const REFRESH_INTERVAL_MS = 30_000;

const Y_MIN = 1e-7;
const Y_MAX = 1e-2;

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

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function formatScientific(value) {
  if (!isFiniteNumber(value)) {
    return "—";
  }

  return value.toExponential(2);
}

/*
 * Converts a UTC time string into a Date object.
 *
 * Example input:
 * 2026-07-14 05:30:00+00:00
 */
function parseDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (!value || typeof value !== "string") {
    return null;
  }

  let normalized = value.trim().replace(" ", "T");

  /*
   * The X-ray data use UTC.
   * If the string does not contain timezone information,
   * append Z so that JavaScript also interprets it as UTC.
   */
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(normalized)) {
    normalized += "Z";
  }

  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? null : date;
}

/*
 * Returns the UTC components as a timezone-free string.
 *
 * This string is passed to Plotly so that the browser does not
 * change the displayed time to the viewer's local timezone.
 */
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
    const text = String(value ?? "").toLowerCase();

    if (value && !["none", "pending"].includes(text)) {
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
  return String(value ?? "none").trim().toLowerCase();
}

function renderState(state) {
  const stateName = normalizeState(state?.flare_state);
  const stateElement = document.getElementById("flare-state");
  const active = stateName === "activate";

  stateElement.textContent = active ? "Activate" : "None";
  stateElement.className =
    `state-badge ${active ? "state-activate" : "state-none"}`;
}

function makePredictionOverlay(predictionData) {
  const predicted = predictionData?.prediction;
  const lower = predictionData?.prediction_interval?.lower;
  const upper = predictionData?.prediction_interval?.upper;

  if (![predicted, lower, upper].every(isFiniteNumber)) {
    return {
      shapes: [],
      annotations: [],
    };
  }

  const shapes = [
    {
      type: "rect",
      xref: "paper",
      x0: 0,
      x1: 1,
      yref: "y",
      y0: lower,
      y1: upper,
      fillcolor: "rgba(120, 130, 140, 0.18)",
      line: {
        width: 0,
      },
      layer: "below",
    },
    {
      type: "line",
      xref: "paper",
      x0: 0,
      x1: 1,
      yref: "y",
      y0: predicted,
      y1: predicted,
      line: {
        color: "#d62828",
        width: 2.5,
        dash: "dash",
      },
    },
  ];

  const annotations = [
    {
      xref: "paper",
      x: 1,
      yref: "y",
      y: predicted,
      text: `Predicted peak: ${formatScientific(predicted)}`,
      showarrow: false,
      xanchor: "right",
      yanchor: "bottom",
      xshift: -8,
      yshift: 5,
      font: {
        color: "#b71919",
        size: 12,
      },
      bgcolor: "rgba(255,255,255,0.88)",
      borderpad: 3,
    },
    {
      xref: "paper",
      x: 1,
      yref: "y",
      y: upper,
      text: `Upper: ${formatScientific(upper)}`,
      showarrow: false,
      xanchor: "right",
      yanchor: "bottom",
      xshift: -8,
      font: {
        color: "#b71919",
        size: 11,
      },
    },
    {
      xref: "paper",
      x: 1,
      yref: "y",
      y: lower,
      text: `Lower: ${formatScientific(lower)}`,
      showarrow: false,
      xanchor: "right",
      yanchor: "top",
      xshift: -8,
      font: {
        color: "#b71919",
        size: 11,
      },
    },
  ];

  return {
    shapes,
    annotations,
  };
}

function renderChart(xrayData, state, predictionData) {
  const rows = Array.isArray(xrayData) ? xrayData : [];

  /*
   * Date objects are used only for time calculations.
   */
  const timeDates = rows.map((row) => parseDate(row.time_tag));

  /*
   * UTC strings are used for the Plotly x-axis.
   */
  const plotTimes = timeDates.map((date) =>
    date ? formatPlotlyUtc(date) : null
  );

  const fluxes = rows.map((row) =>
    isFiniteNumber(row.flux) && row.flux > 0
      ? row.flux
      : null
  );

  const validTimes = timeDates.filter(Boolean);

  if (validTimes.length === 0) {
    throw new Error(
      "No valid time_tag values were found in latest_X-ray_60m.json."
    );
  }

  const firstTime = validTimes[0];
  const lastTime = validTimes[validTimes.length - 1];

  const xAxisStart = formatPlotlyUtc(firstTime);
  const xAxisEnd = formatPlotlyUtc(lastTime);

  const observedTrace = {
    x: plotTimes,
    y: fluxes,
    type: "scatter",
    mode: "lines",
    name: "Observed X-ray flux",
    connectgaps: false,
    line: {
      color: "#145da0",
      width: 2.5,
    },
    hovertemplate:
      "%{x|%b %d, %Y %H:%M UTC}" +
      "<br>Flux: %{y:.2e} W m⁻²" +
      "<extra></extra>",
  };

  const traces = [observedTrace];

  let predictionShapes = [];
  let annotations = [];

  const stateStartTime = parseDate(state?.start_time);
  const predictionStartTime = parseDate(
    predictionData?.flare_start_time
  );

  const predictionMatchesCurrentFlare =
    stateStartTime !== null &&
    predictionStartTime !== null &&
    stateStartTime.getTime() === predictionStartTime.getTime();

  if (
    normalizeState(state?.flare_state) === "activate" &&
    predictionMatchesCurrentFlare
  ) {
    const predictionOverlay =
      makePredictionOverlay(predictionData);

    predictionShapes = predictionOverlay.shapes;
    annotations = predictionOverlay.annotations;
  }

  const layout = {
    margin: {
      l: 78,
      r: 32,
      t: 22,
      b: 78,
    },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    hovermode: "closest",
    legend: {
      orientation: "h",
      x: 0,
      y: 1.08,
      font: {
        size: 12,
      },
    },
    xaxis: {
      title: {
        text: "Time (UTC)",
        standoff: 14,
      },
      type: "date",
      range: [
        xAxisStart,
        xAxisEnd,
      ],
      showgrid: true,
      gridcolor: "#e5eaf0",
      zeroline: false,

      /*
       * Example:
       * Jul 14
       * 05:30
       */
      tickformat: "%b %d<br>%H:%M",

      hoverformat: "%b %d, %Y %H:%M UTC",
      rangeslider: {
        visible: false,
      },
    },
    yaxis: {
      title: {
        text: "X-ray Flux (W m⁻²)",
        standoff: 10,
      },
      type: "log",
      range: [
        Math.log10(Y_MIN),
        Math.log10(Y_MAX),
      ],
      tickvals: [
        1e-7,
        1e-6,
        1e-5,
        1e-4,
        1e-3,
        1e-2,
      ],
      ticktext: [
        "10⁻⁷",
        "10⁻⁶",
        "10⁻⁵",
        "10⁻⁴",
        "10⁻³",
        "10⁻²",
      ],
      showgrid: true,
      gridcolor: "#dfe5ec",
      minor: {
        showgrid: true,
        gridcolor: "#f0f3f7",
      },
      zeroline: false,
    },
    annotations,
    shapes: [
      ...predictionShapes,
      {
        type: "line",
        xref: "paper",
        x0: 0,
        x1: 1,
        yref: "y",
        y0: 1e-6,
        y1: 1e-6,
        line: {
          color: "#aab4c0",
          width: 1,
          dash: "dot",
        },
      },
      {
        type: "line",
        xref: "paper",
        x0: 0,
        x1: 1,
        yref: "y",
        y0: 1e-5,
        y1: 1e-5,
        line: {
          color: "#aab4c0",
          width: 1,
          dash: "dot",
        },
      },
      {
        type: "line",
        xref: "paper",
        x0: 0,
        x1: 1,
        yref: "y",
        y0: 1e-4,
        y1: 1e-4,
        line: {
          color: "#aab4c0",
          width: 1,
          dash: "dot",
        },
      },
    ],
  };

  const config = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: [
      "select2d",
      "lasso2d",
      "autoScale2d",
    ],
  };

  Plotly.react(
    "xray-chart",
    traces,
    layout,
    config
  );

  document.getElementById("last-update").textContent =
    formatUtc(lastTime);
}

async function refreshDashboard() {
  const message = document.getElementById("chart-message");

  try {
    const [
      xrayResult,
      stateResult,
      predictionResult,
    ] = await Promise.allSettled([
      fetchJson(DATA_PATHS.xray),
      fetchJson(DATA_PATHS.state),
      fetchJson(DATA_PATHS.prediction),
    ]);

    // X-ray 데이터가 없으면 그래프를 그릴 수 없으므로 오류 처리
    if (xrayResult.status === "rejected") {
      throw xrayResult.reason;
    }

    const xrayData = xrayResult.value;

    const stateData =
      stateResult.status === "fulfilled"
        ? stateResult.value
        : null;

    const predictionData =
      predictionResult.status === "fulfilled"
        ? predictionResult.value
        : null;

    // 선택적 파일 로딩 실패는 콘솔에만 표시
    if (stateResult.status === "rejected") {
      console.error(
        "Failed to load latest_state.json:",
        stateResult.reason
      );
    }

    if (predictionResult.status === "rejected") {
      console.error(
        "Failed to load prediction.json:",
        predictionResult.reason
      );
    }

    renderChart(
      xrayData,
      stateData,
      predictionData
    );

    renderState(stateData);

    message.hidden = true;
  } catch (error) {
    console.error(error);

    message.textContent =
      `Unable to update the dashboard: ${error.message}`;

    message.hidden = false;
  } finally {
    document.getElementById("page-refresh-time").textContent =
      `Page refreshed: ${formatUtc(new Date())}`;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  refreshDashboard();

  window.setInterval(
    refreshDashboard,
    REFRESH_INTERVAL_MS
  );
});
