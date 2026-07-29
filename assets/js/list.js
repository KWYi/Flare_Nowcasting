const DATA_BASE =
  "https://raw.githubusercontent.com/KWYi/Flare_Nowcasting/live_data/data";
const FLARE_LIST_PATH = `${DATA_BASE}/flare_list.json`;
const REFRESH_INTERVAL_MS = 60_000;

const RECORDS_PER_PAGE = 100;
let allRows = [];
let currentPage = 1;
let displayColumns = [];

const PRIORITY_COLUMNS = [
  "start_time",
  "start_flux",
  "peak_time",
  "peak_flux",
  "end_time",  
  "end_flux",
  "flare_detection_time",
  "processing_mode",
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
    const modeClass = mode.replace(/\s+/g, "-");
    const text = mode === "retrospective" ? "Retrospective" :
      mode === "real time" ? "Real Time" : String(value);
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

function updatePaginationControls() {
  const controls = document.querySelector(".pagination-controls");
  const prevButton = document.getElementById("prev-page");
  const nextButton = document.getElementById("next-page");
  const pageInfo = document.getElementById("page-info");

  if (!controls || !prevButton || !nextButton || !pageInfo) {
    return;
  }

  if (allRows.length === 0) {
    controls.hidden = true;
    pageInfo.textContent = "0 / 0";
    prevButton.disabled = true;
    nextButton.disabled = true;
    return;
  }

  controls.hidden = false;

  const totalPages = Math.ceil(allRows.length / RECORDS_PER_PAGE);

  pageInfo.textContent = `${currentPage} / ${totalPages}`;
  prevButton.disabled = currentPage <= 1;
  nextButton.disabled = currentPage >= totalPages;
}

function renderCurrentPage() {
  const table = document.getElementById("flare-table");
  const tbody = table.querySelector("tbody");

  tbody.replaceChildren();

  if (allRows.length === 0) {
    updatePaginationControls();
    return;
  }

  const totalPages = Math.ceil(allRows.length / RECORDS_PER_PAGE);

  // 데이터 수가 줄어들어 현재 페이지가 없어졌을 경우 마지막 페이지로 이동
  currentPage = Math.min(Math.max(currentPage, 1), totalPages);

  const startIndex = (currentPage - 1) * RECORDS_PER_PAGE;
  const endIndex = startIndex + RECORDS_PER_PAGE;
  const pageRows = allRows.slice(startIndex, endIndex);

  pageRows.forEach((row) => {
    const tr = document.createElement("tr");

    displayColumns.forEach((column) => {
      const td = document.createElement("td");
      const formatted = formatCell(column, row[column]);

      td.textContent = formatted.text;

      if (formatted.className) {
        td.className = formatted.className;
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  updatePaginationControls();
}

function renderTable(data) {
  allRows = Array.isArray(data) ? [...data] : [];

  allRows.sort((a, b) => {
    const aDate =
      parseDate(a.start_time)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const bDate =
      parseDate(b.start_time)?.getTime() ?? Number.NEGATIVE_INFINITY;

    return bDate - aDate;
  });

  const table = document.getElementById("flare-table");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");

  thead.replaceChildren();
  tbody.replaceChildren();

  if (allRows.length === 0) {
    table.hidden = true;
    currentPage = 1;
    displayColumns = [];

    document.getElementById("record-count").textContent = "0";
    updatePaginationControls();
    return;
  }

  table.hidden = false;

  const columns = collectColumns(allRows);

  const predictionColumns = columns.filter((column) =>
    /^prediction_\d+m$/.test(column)
  );

  const eventColumns = columns.filter(
    (column) => !predictionColumns.includes(column)
  );

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
    predictionGroup.textContent =
      "Predicted Peak Flux (Time After Flare Detection)";

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

  displayColumns = [...eventColumns, ...predictionColumns];

  const totalPages = Math.ceil(allRows.length / RECORDS_PER_PAGE);

  // 새로고침할 때 현재 페이지를 유지하되 범위를 벗어나면 조정
  currentPage = Math.min(Math.max(currentPage, 1), totalPages);

  document.getElementById("record-count").textContent =
    String(allRows.length);

  renderCurrentPage();
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
  const prevButton = document.getElementById("prev-page");
  const nextButton = document.getElementById("next-page");

  prevButton.addEventListener("click", () => {
    if (currentPage <= 1) {
      return;
    }

    currentPage -= 1;
    renderCurrentPage();
  });

  nextButton.addEventListener("click", () => {
    const totalPages = Math.ceil(
      allRows.length / RECORDS_PER_PAGE
    );

    if (currentPage >= totalPages) {
      return;
    }

    currentPage += 1;
    renderCurrentPage();
  });

  refreshList();
  window.setInterval(refreshList, REFRESH_INTERVAL_MS);
});
