import { geocode, reverseGeocode, searchBusinesses, googleMapsUrl, googleSearchUrl, whatsappUrl } from "./osm.js";
import { estimatePrice, euro } from "./pricing.js";
import { analyzeBusiness, testKey, MODELS } from "./ai.js";

// ---------- Estado y almacenamiento local ----------
const STORE_KEY = "webradar.v1";
const CATEGORIES = [
  { id: "hosteleria", label: "🍽️ Hostelería" },
  { id: "comercio", label: "🛍️ Comercios" },
  { id: "salud", label: "🩺 Salud y estética" },
  { id: "oficios", label: "🔧 Oficios y talleres" },
  { id: "profesionales", label: "💼 Profesionales" },
  { id: "alojamiento", label: "🏨 Alojamiento" },
  { id: "ocio", label: "🏋️ Ocio y deporte" },
  { id: "servicios", label: "🧩 Otros servicios" },
];
const STATUSES = ["Pendiente", "Contactado", "Interesado", "Presupuesto enviado", "Cliente", "Descartado"];

function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    return { settings: {}, saved: {}, analyses: {}, last: null, ...s };
  } catch {
    return { settings: {}, saved: {}, analyses: {}, last: null };
  }
}
const store = loadStore();
function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
  catch { toast("No se pudo guardar en este dispositivo"); }
}

const state = {
  results: store.last?.results || [],
  zoneLabel: store.last?.label || "",
  view: "sinweb",
  selectedId: null,
  analyzing: new Set(),
  categories: new Set(store.settings.categories || CATEGORIES.map((c) => c.id)),
  center: store.settings.center || null, // { lat, lon, label }
  radiusKm: store.settings.radiusKm || 2,
  truncated: store.last?.truncated || false,
  onlyNoWebUsed: store.last?.onlyNoWeb || false,
  pageSize: 200,
  shown: 200,
};

// ---------- Utilidades ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^(https?:|tel:|mailto:)/i.test(u || "") ? u : "");
const link = (href, text, cls = "btn secondary small") =>
  safeUrl(href) ? `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener">${text}</a>` : "";

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}
function setStatus(msg, isError = false) {
  const s = $("#status");
  s.textContent = msg;
  s.classList.toggle("error", isError);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Copiado"); }
  catch { toast("No se pudo copiar"); }
}

function findBusiness(id) {
  return state.results.find((b) => b.id === id) || store.saved[id]?.business;
}

function webStatus(b) {
  const a = store.analyses[b.id];
  if (a) {
    const map = {
      sin_web: ["Sin web", "bad"], solo_redes: ["Solo redes", "bad"], anticuada: ["Web anticuada", "warn"],
      mejorable: ["Web mejorable", "warn"], moderna: ["Web moderna", "ok"],
    };
    const [label, cls] = map[a.estado_web] || ["Analizado", "info"];
    return { label, cls };
  }
  return b.website ? { label: "Tiene web · sin analizar", cls: "info" } : { label: "Sin web", cls: "bad" };
}

// ---------- Zona y radio de búsqueda ----------
function radiusMeters() { return Math.round(state.radiusKm * 1000); }

function updateRadiusUi() {
  $("#radius").value = state.radiusKm;
  $("#radiusOut").textContent = state.radiusKm < 1 ? `${state.radiusKm * 1000} m` : `${state.radiusKm} km`;
}

function updateZoneLabel() {
  const c = state.center;
  $("#zoneLabel").innerHTML = c
    ? `Zona: <b>${esc(c.label || `${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`)}</b> · radio ${esc($("#radiusOut").textContent)}.`
    : `Escribe un lugar de España o pulsa <b>📍 Aquí</b>, ajusta el radio (hasta 60 km) y pulsa <b>Buscar negocios</b>.`;
}

async function setCenter(lat, lon, label = null) {
  state.center = { lat, lon, label };
  updateZoneLabel();
  if (!label) {
    const name = await reverseGeocode(lat, lon);
    if (name && state.center?.lat === lat && state.center?.lon === lon) state.center.label = name;
    updateZoneLabel();
  }
  store.settings.center = state.center;
  persist();
}

$("#radius").addEventListener("input", () => {
  const prev = state.radiusKm;
  state.radiusKm = parseFloat($("#radius").value);
  // En zonas grandes, por defecto traemos solo los negocios sin web (mucho más rápido).
  if (prev <= 15 && state.radiusKm > 15) $("#onlyNoWeb").checked = true;
  updateRadiusUi();
  updateZoneLabel();
  store.settings.radiusKm = state.radiusKm;
  persist();
});

// ---------- Búsqueda ----------
function renderCategories() {
  $("#categories").innerHTML = CATEGORIES.map(
    (c) => `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${state.categories.has(c.id)}">${c.label}</button>`
  ).join("");
}

async function runSearch() {
  const c = state.center;
  if (!c) return setStatus("Escribe primero un lugar o pulsa 📍 Aquí.", true);
  const radius = radiusMeters();
  const categories = [...state.categories];
  if (!categories.length) return setStatus("Elige al menos un sector.", true);
  const onlyNoWeb = $("#onlyNoWeb").checked;
  const label = c.label || `${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`;
  $("#btnSearch").disabled = true;
  setStatus(`Buscando negocios en ${label} (radio ${$("#radiusOut").textContent})…${radius > 15000 ? " En zonas grandes puede tardar hasta un par de minutos." : ""}`);
  try {
    const { list, truncated } = await searchBusinesses({
      lat: c.lat, lon: c.lon, radius, categories, onlyNoWeb,
      excludeChains: radius > 15000 && $("#hideChains").checked,
    });
    state.results = list;
    state.zoneLabel = label;
    state.truncated = truncated;
    state.onlyNoWebUsed = onlyNoWeb;
    state.selectedId = null;
    state.shown = state.pageSize;
    store.last = { label, results: list, truncated, onlyNoWeb, at: Date.now() };
    // localStorage tiene ~5 MB: no guardamos búsquedas enormes para no perder los guardados.
    if (JSON.stringify(list).length > 2_500_000) store.last = null;
    persist();
    if (onlyNoWeb && state.view === "conweb") $('[data-view="sinweb"]').click();
    renderList();
    renderDetail();
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    $("#btnSearch").disabled = false;
  }
}

$("#searchForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const zone = $("#zone").value.trim();
  if (zone && zone !== state.center?.label) {
    setStatus(`Localizando "${zone}"…`);
    try {
      const [place] = await geocode(zone);
      await setCenter(place.lat, place.lon, place.label.split(",").slice(0, 3).join(","));
      $("#zone").value = state.center.label;
    } catch (e) {
      return setStatus(e.message, true);
    }
  }
  runSearch();
});

$("#btnLocate").addEventListener("click", () => {
  if (!navigator.geolocation) return setStatus("Este dispositivo no permite obtener la ubicación.", true);
  setStatus("Obteniendo tu ubicación…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $("#zone").value = "";
      setCenter(pos.coords.latitude, pos.coords.longitude);
      setStatus("Ubicación obtenida. Ajusta el radio y pulsa Buscar negocios.");
    },
    () => setStatus("No se pudo obtener la ubicación. Revisa los permisos de Safari.", true),
    { enableHighAccuracy: true, timeout: 15000 }
  );
});

$("#categories").addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-cat]");
  if (!btn) return;
  const id = btn.dataset.cat;
  state.categories.has(id) ? state.categories.delete(id) : state.categories.add(id);
  store.settings.categories = [...state.categories];
  persist();
  renderCategories();
});

// ---------- Lista ----------
function visibleList() {
  const q = $("#textFilter").value.trim().toLowerCase();
  const hideChains = $("#hideChains").checked;
  const onlyPhone = $("#onlyPhone").checked;
  let list = state.view === "guardados"
    ? Object.values(store.saved).sort((a, b) => b.savedAt - a.savedAt).map((s) => s.business)
    : state.results;
  if (state.view !== "guardados") list = list.filter((b) => state.categories.has(b.category));
  if (state.view === "sinweb") list = list.filter((b) => {
    const a = store.analyses[b.id];
    return a ? ["sin_web", "solo_redes"].includes(a.estado_web) : !b.website;
  });
  if (state.view === "conweb") list = list.filter((b) => {
    const a = store.analyses[b.id];
    return a ? !["sin_web", "solo_redes"].includes(a.estado_web) : !!b.website;
  });
  if (hideChains && state.view !== "guardados") list = list.filter((b) => !b.isChain);
  if (onlyPhone) list = list.filter((b) => b.phones?.length || store.analyses[b.id]?.contacto_extra?.telefono);
  if (q) list = list.filter((b) => (b.name + " " + b.type + " " + b.address).toLowerCase().includes(q));
  return list;
}

function renderList() {
  const list = visibleList();
  const base = state.results.filter((b) => state.categories.has(b.category) && !($("#hideChains").checked && b.isChain));
  const noWeb = base.filter((b) => !b.website).length;
  if (state.view === "guardados") {
    setStatus(`${list.length} negocio(s) guardado(s).`);
  } else if (state.results.length) {
    setStatus(`${state.zoneLabel}: ${base.length} negocios · ${noWeb} sin web registrada` +
      (state.onlyNoWebUsed ? " (búsqueda solo sin web)" : ` · ${base.length - noWeb} con web`) +
      `. Mostrando ${list.length}.` +
      (state.truncated ? " ⚠️ Hay más negocios de los que caben en una búsqueda: reduce el radio o los sectores para verlos todos." : ""));
  }
  const page = list.slice(0, state.shown);
  $("#results").innerHTML = list.length
    ? page.map((b) => {
        const ws = webStatus(b);
        const saved = store.saved[b.id];
        const a = store.analyses[b.id];
        return `<li class="card ${b.id === state.selectedId ? "selected" : ""}" data-id="${esc(b.id)}" tabindex="0">
          <div class="card-top">
            <h3>${esc(b.name)}</h3>
            <span class="badge ${ws.cls}">${esc(ws.label)}</span>
          </div>
          <div class="meta">${esc(b.type)}${b.distance != null ? ` · ${b.distance < 1 ? Math.round(b.distance * 1000) + " m" : b.distance.toFixed(1) + " km"}` : ""}${b.address ? " · " + esc(b.address) : ""}</div>
          <div class="icons">
            ${b.phones?.length ? `<span class="badge neutral">📞 Teléfono</span>` : ""}
            ${b.email ? `<span class="badge neutral">✉️ Email</span>` : ""}
            ${b.instagram || b.facebook ? `<span class="badge neutral">📱 Redes</span>` : ""}
            ${a ? `<span class="badge info">🤖 ${euro(a.precio_venta?.recomendado)} + ${euro(a.mantenimiento_mensual?.recomendado)}/mes</span>` : ""}
            ${saved ? `<span class="badge ok">★ ${esc(saved.status)}</span>` : ""}
          </div>
        </li>`;
      }).join("") +
      (list.length > page.length ? `<li class="more-btn"><button class="btn secondary" data-more>Mostrar ${Math.min(state.pageSize, list.length - page.length)} más (quedan ${list.length - page.length})</button></li>` : "")
    : `<li class="empty-detail">${state.results.length || state.view === "guardados" ? "No hay negocios con estos filtros." : ""}</li>`;
}

function selectBusiness(id) {
  state.selectedId = id;
  renderList();
  renderDetail();
  $("#detail").classList.add("open");
  $("#detail").scrollTop = 0;
}

$("#results").addEventListener("click", (ev) => {
  if (ev.target.closest("[data-more]")) {
    state.shown += state.pageSize;
    renderList();
    return;
  }
  const card = ev.target.closest(".card");
  if (card) selectBusiness(card.dataset.id);
});
$("#results").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") ev.target.closest(".card")?.click();
});

$("#viewFilter").addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-view]");
  if (!btn) return;
  state.view = btn.dataset.view;
  state.shown = state.pageSize;
  document.querySelectorAll("#viewFilter button").forEach((b) => b.classList.toggle("active", b === btn));
  renderList();
});
["#textFilter", "#hideChains", "#onlyPhone"].forEach((s) => $(s).addEventListener("input", () => { state.shown = state.pageSize; renderList(); }));

// ---------- Ficha del negocio ----------
function contactRows(b, a) {
  const rows = [];
  const phones = [...(b.phones || [])];
  const extraPhone = a?.contacto_extra?.telefono;
  if (extraPhone && !phones.some((p) => p.replace(/\D/g, "").endsWith(extraPhone.replace(/\D/g, "").slice(-9)))) phones.push(extraPhone);
  for (const p of phones) {
    const wa = whatsappUrl(p, a?.mensaje_contacto || "");
    rows.push(`<li><span class="label">Teléfono</span><span class="value">${esc(p)}</span>
      <span class="actions">${link("tel:" + p.replace(/\s/g, ""), "Llamar")}${wa ? link(wa, "WhatsApp") : ""}<button class="btn secondary small" data-copy="${esc(p)}">Copiar</button></span></li>`);
  }
  const email = b.email || a?.contacto_extra?.email;
  if (email) {
    const subject = encodeURIComponent(`Propuesta de página web para ${b.name}`);
    const body = encodeURIComponent(a?.mensaje_contacto || "");
    rows.push(`<li><span class="label">Email</span><span class="value">${esc(email)}</span>
      <span class="actions">${link(`mailto:${email}?subject=${subject}&body=${body}`, "Escribir")}<button class="btn secondary small" data-copy="${esc(email)}">Copiar</button></span></li>`);
  }
  const ig = b.instagram || a?.contacto_extra?.instagram;
  const igUrl = ig && (/^https?:/.test(ig) ? ig : "https://www.instagram.com/" + ig.replace(/^@/, ""));
  if (ig) rows.push(`<li><span class="label">Instagram</span><span class="value">${esc(ig)}</span>${link(igUrl, "Abrir")}</li>`);
  const fb = b.facebook || a?.contacto_extra?.facebook;
  const fbUrl = fb && (/^https?:/.test(fb) ? fb : "https://www.facebook.com/" + fb);
  if (fb) rows.push(`<li><span class="label">Facebook</span><span class="value">${esc(fb)}</span>${link(fbUrl, "Abrir")}</li>`);
  const web = b.website || a?.url_web;
  if (web) rows.push(`<li><span class="label">Web</span><span class="value">${esc(web)}</span>${link(/^https?:/.test(web) ? web : "http://" + web, "Visitar")}</li>`);
  if (b.address) rows.push(`<li><span class="label">Dirección</span><span class="value">${esc(b.address)}</span></li>`);
  if (b.hours) rows.push(`<li><span class="label">Horario</span><span class="value">${esc(b.hours)}</span></li>`);
  if (a?.contacto_extra?.otros) rows.push(`<li><span class="label">Otros</span><span class="value">${esc(a.contacto_extra.otros)}</span></li>`);
  if (!phones.length && !email && !ig && !fb) {
    rows.push(`<li><span class="value">El mapa no tiene teléfono ni email de este negocio. Pulsa <b>Ver en Google Maps</b> (suele aparecer el teléfono) o usa <b>Analizar con IA</b> para buscarlo en internet.</span></li>`);
  }
  return rows.join("");
}

function priceBlock(venta, mant) {
  return `<div class="price-grid">
    <div class="price-box"><div class="k">Precio de venta</div><div class="v">${euro(venta?.recomendado)}</div><div class="r">Rango ${euro(venta?.min)} – ${euro(venta?.max)}</div></div>
    <div class="price-box"><div class="k">Mantenimiento</div><div class="v">${euro(mant?.recomendado)}<small>/mes</small></div><div class="r">Rango ${euro(mant?.min)} – ${euro(mant?.max)}</div></div>
  </div>`;
}

function aiBlock(b) {
  const a = store.analyses[b.id];
  const busy = state.analyzing.has(b.id);
  const btn = `<button class="btn ai" data-analyze="${esc(b.id)}" ${busy ? "disabled" : ""}>${busy ? `<span class="spinner"></span> Analizando (hasta 1–2 min)…` : a ? "🔄 Volver a analizar con IA" : "✨ Analizar con IA"}</button>`;
  if (!a) {
    return `${btn}<p class="note">La IA revisa ${b.website ? "su web y valora lo anticuada que está" : "si de verdad no tiene web"}, busca más datos de contacto y calcula precio de venta y mantenimiento ajustados a este negocio.</p>`;
  }
  const score = a.puntuacion_modernidad;
  const scoreCls = score == null ? "bad" : score <= 4 ? "bad" : score <= 6 ? "warn" : "ok";
  const prio = { alta: "bad", media: "warn", baja: "neutral" }[a.prioridad] || "neutral";
  return `<div class="ai-box">
    <div class="row wrap">
      <span class="badge ${webStatus(b).cls}">${esc(webStatus(b).label)}</span>
      <span class="badge ${prio}">Prioridad ${esc(a.prioridad || "—")}</span>
      ${score != null ? `<span class="score" style="color:var(--${scoreCls})">${esc(score)}<small>/10 modernidad</small></span>` : ""}
    </div>
    ${a.motivo_prioridad ? `<p class="note">${esc(a.motivo_prioridad)}</p>` : ""}
    ${a.problemas_detectados?.length ? `<h4>Problemas detectados</h4><ul>${a.problemas_detectados.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
    <h4>Propuesta</h4><p>${esc(a.propuesta)}</p>
    ${a.funcionalidades?.length ? `<ul>${a.funcionalidades.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
    <h4>Precio recomendado por la IA (sin IVA)</h4>
    ${priceBlock(a.precio_venta, a.mantenimiento_mensual)}
    ${a.justificacion_precio ? `<p class="note">${esc(a.justificacion_precio)}</p>` : ""}
    ${a.mensaje_contacto ? `<h4>Mensaje sugerido para contactar</h4>
      <div class="message-box">${esc(a.mensaje_contacto)}</div>
      <button class="btn secondary small" data-copy-msg="${esc(b.id)}">Copiar mensaje</button>` : ""}
    <p class="note">Analizado el ${new Date(a.analizado).toLocaleString("es-ES")} · ${esc(a.modelo || "")}</p>
  </div>
  <div style="margin-top:10px">${btn}</div>`;
}

function renderDetail() {
  const el = $("#detail");
  const b = state.selectedId && findBusiness(state.selectedId);
  if (!b) {
    el.classList.remove("open");
    el.innerHTML = `<div class="empty-detail"><p>Selecciona un negocio para ver sus datos de contacto, enlaces de Google y el presupuesto estimado.</p></div>`;
    return;
  }
  const a = store.analyses[b.id];
  const est = estimatePrice(b);
  const saved = store.saved[b.id];
  const ws = webStatus(b);
  el.innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${esc(b.name)}</h2>
        <p class="sub">${esc(b.type)}${b.city ? " · " + esc(b.city) : ""}</p>
        <span class="badge ${ws.cls}">${esc(ws.label)}</span>
        ${b.isChain ? `<span class="badge neutral">Cadena / franquicia</span>` : ""}
      </div>
      <button class="btn secondary small close-detail" data-close>✕ Cerrar</button>
    </div>

    <h4>Ver en Google</h4>
    <div class="actions">
      ${link(googleMapsUrl(b), "🗺️ Ver en Google Maps", "btn primary small")}
      ${link(googleSearchUrl(b), "🔎 Buscar en Google", "btn secondary small")}
      <button class="btn secondary small" data-copy="${esc(googleMapsUrl(b))}">Copiar enlace</button>
    </div>
    <p class="note">En Google Maps verás reseñas, fotos, teléfono y si aparece alguna web que no está en el mapa.</p>

    <h4>Contacto</h4>
    <ul class="contact-list">${contactRows(b, a)}</ul>

    <h4>Presupuesto orientativo</h4>
    ${a ? `<p class="note">Estimación rápida por sector: ${euro(est.venta.recomendado)} + ${euro(est.mantenimiento.recomendado)}/mes. Abajo tienes la valoración de la IA para este negocio.</p>` : `${priceBlock(est.venta, est.mantenimiento)}<p class="note">${esc(est.propuesta)}. Estimación por sector; analiza con IA para afinarla.</p>`}

    <h4>Análisis con IA</h4>
    ${aiBlock(b)}

    <h4>Seguimiento</h4>
    <div class="status-select">
      ${saved
        ? `<select data-status>${STATUSES.map((s) => `<option ${s === saved.status ? "selected" : ""}>${s}</option>`).join("")}</select>
           <button class="btn secondary small" data-unsave>Quitar de guardados</button>`
        : `<button class="btn secondary" data-save>★ Guardar en mi lista</button>`}
    </div>
    ${saved ? `<textarea data-notes placeholder="Notas: con quién hablaste, qué te dijo, cuándo volver a llamar…">${esc(saved.notes || "")}</textarea>` : ""}
    <p class="note">${link(b.osmUrl, "Ver ficha en OpenStreetMap", "")}</p>
  `;
}

$("#detail").addEventListener("click", async (ev) => {
  const t = ev.target.closest("button");
  if (!t) return;
  const b = findBusiness(state.selectedId);
  if (t.dataset.close !== undefined) { $("#detail").classList.remove("open"); return; }
  if (t.dataset.copy) return copy(t.dataset.copy);
  if (t.dataset.copyMsg) return copy(store.analyses[t.dataset.copyMsg]?.mensaje_contacto || "");
  if (t.dataset.save !== undefined && b) {
    store.saved[b.id] = { business: b, status: "Pendiente", notes: "", savedAt: Date.now() };
    persist(); renderDetail(); renderList(); toast("Guardado en tu lista");
  }
  if (t.dataset.unsave !== undefined && b) {
    delete store.saved[b.id];
    persist(); renderDetail(); renderList();
  }
  if (t.dataset.analyze) runAnalysis(t.dataset.analyze);
});
$("#detail").addEventListener("change", (ev) => {
  const saved = store.saved[state.selectedId];
  if (!saved) return;
  if (ev.target.matches("[data-status]")) { saved.status = ev.target.value; persist(); renderList(); }
});
$("#detail").addEventListener("input", (ev) => {
  const saved = store.saved[state.selectedId];
  if (saved && ev.target.matches("[data-notes]")) { saved.notes = ev.target.value; persist(); }
});

async function runAnalysis(id) {
  const b = findBusiness(id);
  if (!b || state.analyzing.has(id)) return;
  if (!store.settings.apiKey) {
    toast("Primero añade tu clave de la API de Claude");
    openSettings();
    return;
  }
  state.analyzing.add(id);
  if (state.selectedId === id) renderDetail();
  try {
    const result = await analyzeBusiness(b, { apiKey: store.settings.apiKey, model: store.settings.model || MODELS[0].id });
    store.analyses[id] = result;
    if (store.saved[id]) store.saved[id].business = b;
    persist();
    toast(`Análisis listo: ${b.name}`);
  } catch (e) {
    toast(e.message);
    setStatus(e.message, true);
  } finally {
    state.analyzing.delete(id);
    if (state.selectedId === id) renderDetail();
    renderList();
  }
}

// ---------- Ajustes y exportación ----------
function openSettings() {
  $("#apiKey").value = store.settings.apiKey || "";
  $("#model").innerHTML = MODELS.map((m) => `<option value="${m.id}" ${m.id === (store.settings.model || MODELS[0].id) ? "selected" : ""}>${m.label}</option>`).join("");
  $("#keyStatus").textContent = "";
  $("#settings").showModal();
}
function saveSettings() {
  store.settings.apiKey = $("#apiKey").value.trim();
  store.settings.model = $("#model").value;
  persist();
}
$("#btnSettings").addEventListener("click", openSettings);
$("#settings").addEventListener("close", saveSettings);
$("#btnTestKey").addEventListener("click", async () => {
  saveSettings();
  $("#keyStatus").textContent = "Probando…";
  try {
    await testKey({ apiKey: store.settings.apiKey, model: store.settings.model });
    $("#keyStatus").textContent = "✅ La clave funciona";
  } catch (e) {
    $("#keyStatus").textContent = "❌ " + (e.status === 401 ? "Clave no válida" : e.message);
  }
});

function toCsv(list) {
  const cols = ["Nombre", "Tipo", "Dirección", "Teléfono", "Email", "Web", "Instagram", "Facebook", "Estado web", "Precio venta (€)", "Mantenimiento (€/mes)", "Seguimiento", "Notas", "Google Maps"];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = list.map((b) => {
    const a = store.analyses[b.id];
    const est = estimatePrice(b);
    const s = store.saved[b.id];
    return [
      b.name, b.type, b.address, (b.phones || []).join(" / ") || a?.contacto_extra?.telefono, b.email || a?.contacto_extra?.email,
      b.website || a?.url_web, b.instagram || a?.contacto_extra?.instagram, b.facebook || a?.contacto_extra?.facebook,
      webStatus(b).label, a?.precio_venta?.recomendado ?? est.venta.recomendado,
      a?.mantenimiento_mensual?.recomendado ?? est.mantenimiento.recomendado, s?.status, s?.notes, googleMapsUrl(b),
    ].map(cell).join(";");
  });
  return "﻿" + [cols.map(cell).join(";"), ...rows].join("\n");
}
function download(name, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$("#btnExportSaved").addEventListener("click", () => download("negocios-guardados.csv", toCsv(Object.values(store.saved).map((s) => s.business))));
$("#btnExportResults").addEventListener("click", () => download("negocios-resultados.csv", toCsv(visibleList())));

// ---------- Inicio ----------
renderCategories();
updateRadiusUi();
$("#onlyNoWeb").checked = state.radiusKm > 15;
if (state.center) {
  const { lat, lon, label } = state.center;
  setCenter(lat, lon, label);
  if (label) $("#zone").value = label;
}
if (state.results.length) {
  renderList();
} else if (!store.settings.apiKey) {
  setStatus("Escribe una zona de España y pulsa Buscar. Para el análisis con IA, añade tu clave en ⚙️ Ajustes.");
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
