const STATUS_LABEL = { green: "Online", orange: "Admin-läge", red: "Nere" };
const REFRESH_MS = 30000;

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
    el.title = `${inst.name} – ${inst.detail}`;

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

    const dot = document.createElement("span");
    dot.className = `dot ${inst.status}`;
    label.appendChild(dot);

    const name = document.createElement("span");
    name.textContent = inst.name;
    label.appendChild(name);

    el.appendChild(label);
    grid.appendChild(el);
  }
}

loadStatus();
setInterval(loadStatus, REFRESH_MS);
