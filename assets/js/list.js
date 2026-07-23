const FLARE_LIST_PATH = "data/flare_list.json";
const REFRESH_INTERVAL_MS = 60_000;

const PRIORITY_COLUMNS = [
  "processing_mode",
  "start_time",
  "flare_detection_time",
  "peak_time",
  "end_time",
  "start_flux",
  "peak_flux",
  "end_flux",
];

// 예전 flare_list.json에 남아 있어도 웹 표에는 표시하지 않음.
const HIDDEN_COLUMNS = new Set([
  "state",
  "prediction_reference",
]);

const COLUMN_LABELS = {
  processing_mode: "Mode",
  start_time: "Start Time",
  flare_detection_time: "Detection Time",
  peak_time: "Peak Time",
  end_time: "End Time",
  start_flux: "Start Flux",
  peak_flux: "Peak Flux",
  end_flux: "End Flux",
};

function fetchJson(path) {
  const separator = path.includes("?") ? "&" : "?";
  return fetch(`${path}${separator}v=${Date.now()}`, { cache: "no-store" }).then((response) => {
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  });
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function parseDate(value) {
  if (!value || typeof value !== "string") return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatUtc(value) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return String(value ?? "—");
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

function predictionMinute(column) {
  const match = column.match(/^prediction_(\d+)m$/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function columnLabel(column) {
  if (COLUMN_LABELS[column]) return COLUMN_LABELS[column];

  const minute = predictionMinute(column);
  if (Number.isFinite(minute)) {
    return minute === 0 ? "At Detection" : `+${minute} min`;
  }

  return column
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function collectColumns(rows) {
  const allColumns = new Set(
    rows.flatMap((row) => Object.keys(row))
      .filter((column) => !HIDDEN_COLUMNS.has(column))
  );

  const priority = PRIORITY_COLUMNS.filter((column) => allColumns.has(column));
  const predictionColumns = [...allColumns]
    .filter((column) => /^prediction_\d+m$/.test(column))
    .sort((a, b) => predictionMinute(a) - predictionMinute(b));
  const remaining = [...allColumns]
    .filter((column) => !priority.includes(column) && !predictionColumns.includes(column))
    .sort();

  // 예측 열을 마지막에 모아 두어 그룹 헤더를 만들기 쉽게 함.
  return [...priority, ...remaining, ...predictionColumns];
}

function isTimeColumn(column) {
  return column.endsWith("_time") || column === "save_time";
}

function isFluxOrPredictionColumn(column) {
  return column.includes("flux") || column.startsWith("prediction_");
}

function formatCell(column, value) {
  if (value === null || value === undefined || value === "") {
    return { text: "—", className: "empty-value" };
  }

  if (column === "processing_mode") {
    const mode = String(value).toLowerCase();
    const text = mode === "retrospective" ? "Retrospective" :
      mode === "operational" ? "Operational" : String(value);
    return { text, className: `mode-${mode}` };
  }

  if (isFiniteNumber(value) && isFluxOrPredictionColumn(column)) {
    return { text: value.toExponential(2), className: "numeric" };
  }

  if (isTimeColumn(column)) {
    const lower = String(value).toLowerCase();
    if (["pending", "none", "-"].includes(lower)) {
      return { text: value, className: lower === "pending" ? "pending" : "empty-value" };
    }
    return { text: formatUtc(value), className: "" };
  }

  const text = String(value);
  return {
    text,
    className: text.toLowerCase() === "pending" ? "pending" : text === "-" ? "empty-value" : "",
  };
}

function renderTable(data) {
  const rows = Array.isArray(data) ? [...data] : [];
  rows.sort((a, b) => {
    const aDate = parseDate(a.start_time)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const bDate = parseDate(b.start_time)?.getTime() ?? Number.NEGATIVE_INFINITY;
    return bDate - aDate;
  });

  const table = document.getElementById("flare-table");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.replaceChildren();
  tbody.replaceChildren();

  if (rows.length === 0) {
    table.hidden = true;
    document.getElementById("record-count").textContent = "0";
    return;
  }

  table.hidden = false;
  const columns = collectColumns(rows);
  const predictionColumns = columns.filter((column) => /^prediction_\d+m$/.test(column));
  const eventColumns = columns.filter((column) => !predictionColumns.includes(column));

  const groupHeaderRow = document.createElement("tr");

  eventColumns.forEach((column) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.rowSpan = predictionColumns.length > 0 ? 2 : 1;
    th.textContent = columnLabel(column);
    groupHeaderRow.appendChild(th);
  });

  if (predictionColumns.length > 0) {
    const predictionGroup = document.createElement("th");
    predictionGroup.scope = "colgroup";
    predictionGroup.colSpan = predictionColumns.length;
    predictionGroup.className = "prediction-group-header";
    predictionGroup.textContent = "Predicted Peak Flux (Time After Flare Detection)";
    groupHeaderRow.appendChild(predictionGroup);
  }

  thead.appendChild(groupHeaderRow);

  if (predictionColumns.length > 0) {
    const predictionHeaderRow = document.createElement("tr");
    predictionColumns.forEach((column) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = columnLabel(column);
      predictionHeaderRow.appendChild(th);
    });
    thead.appendChild(predictionHeaderRow);
  }

  const displayColumns = [...eventColumns, ...predictionColumns];

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    displayColumns.forEach((column) => {
      const td = document.createElement("td");
      const formatted = formatCell(column, row[column]);
      td.textContent = formatted.text;
      if (formatted.className) td.className = formatted.className;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  document.getElementById("record-count").textContent = String(rows.length);
}

async function refreshList() {
  const message = document.getElementById("table-message");
  try {
    const data = await fetchJson(FLARE_LIST_PATH);
    renderTable(data);
    message.hidden = true;
  } catch (error) {
    console.error(error);
    message.textContent = `Unable to update the nowcasting list: ${error.message}`;
    message.hidden = false;
  } finally {
    document.getElementById("page-refresh-time").textContent = `Page refreshed: ${formatUtc(new Date())}`;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  refreshList();
  window.setInterval(refreshList, REFRESH_INTERVAL_MS);
});
