const DATA_BASE =
  "https://raw.githubusercontent.com/KWYi/Flare_Nowcasting/live_data/data";

const FLARE_LIST_PATH =
  `${DATA_BASE}/flare_list.json`;

const REFRESH_INTERVAL_MS = 30_000;

const PRIORITY_COLUMNS = [
  "start_time",
  "peak_time",
  "end_time",
  "start_flux",
  "peak_flux",
  "end_flux",
];

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

function humanizeColumn(column) {
  return column
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function predictionMinute(column) {
  const match = column.match(/^prediction_(\d+)m$/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function collectColumns(rows) {
  const allColumns = new Set(rows.flatMap((row) => Object.keys(row)));
  const priority = PRIORITY_COLUMNS.filter((column) => allColumns.has(column));
  const predictionColumns = [...allColumns]
    .filter((column) => /^prediction_\d+m$/.test(column))
    .sort((a, b) => predictionMinute(a) - predictionMinute(b));
  const remaining = [...allColumns]
    .filter((column) => !priority.includes(column) && !predictionColumns.includes(column))
    .sort();
  return [...priority, ...predictionColumns, ...remaining];
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
  const headerRow = document.createElement("tr");
  columns.forEach((column) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = humanizeColumn(column);
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((column) => {
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
