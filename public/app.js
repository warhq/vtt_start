const STATUS_LABEL = { green: "Online", orange: "Admin-läge", red: "Nere" };
const REFRESH_MS = 30000;

function formatUptime(uptimeMs) {
  if (uptimeMs == null) return null;
  const days = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
  if (days < 1) return "<1 dag";
  return `${days} ${days === 1 ? "dag" : "dagar"}`;
}

async function loadStatus() {
  const grid = document.getElementById("grid");
  try {
    const resp = await fetch("/api/status", { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    render(data.instances);
    const updatedAt = document.getElementById("updated-at");
    updatedAt.textContent = new Date(data.generatedAt).toLocaleTimeString("sv-SE");
  } catch (err) {
    grid.innerHTML = `<p class="loading">Kunde inte hämta status just nu.</p>`;
    console.error(err);
  }
}

function render(instances) {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";

  for (const inst of instances) {
    const offline = inst.status === "red";
    const el = document.createElement(offline ? "div" : "a");
    el.className = `card ${offline ? "offline" : ""}`.trim();
    if (!offline) {
      el.href = inst.url;
      el.target = "_blank";
      el.rel = "noopener";
    } else {
      el.setAttribute("aria-disabled", "true");
      el.setAttribute("role", "img");
    }
    const metaParts = [];
    if (inst.world) metaParts.push(inst.world);
    if (inst.system) metaParts.push(inst.system);
    if (inst.players != null) metaParts.push(`${inst.players} spelare`);
    const uptime = formatUptime(inst.uptimeMs);
    if (uptime) metaParts.push(`upptid ${uptime}`);

    el.title = metaParts.length
      ? `${inst.name} – ${inst.detail} (${metaParts.join(", ")})`
      : `${inst.name} – ${inst.detail}`;

    const img = document.createElement("img");
    img.className = "image";
    img.loading = "lazy";
    img.alt = inst.name;
    img.src = inst.imageUrl || "/placeholder.svg";
    img.onerror = () => {
      img.src = "/placeholder.svg";
    };
    el.appendChild(img);

    const overlay = document.createElement("div");
    overlay.className = "overlay";
    el.appendChild(overlay);

    const detail = document.createElement("span");
    detail.className = "detail";
    detail.textContent = STATUS_LABEL[inst.status] ?? inst.status;
    el.appendChild(detail);

    const label = document.createElement("div");
    label.className = "label";

    const titleRow = document.createElement("div");
    titleRow.className = "title-row";

    const dot = document.createElement("span");
    dot.className = `dot ${inst.status}`;
    titleRow.appendChild(dot);

    const name = document.createElement("span");
    name.textContent = inst.name;
    titleRow.appendChild(name);

    label.appendChild(titleRow);

    if (metaParts.length) {
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = metaParts.join(" · ");
      label.appendChild(meta);
    }

    el.appendChild(label);
    grid.appendChild(el);
  }
}

loadStatus();
setInterval(loadStatus, REFRESH_MS);
