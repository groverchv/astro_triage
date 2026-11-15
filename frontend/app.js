/* Orquestación — Hubzy Astro-Triage */
"use strict";

// Estado global compartido entre camera.js / game.js / app.js
const AppState = { bio: null, game: null, psych_answers: [], symptoms: new Set() };
const AppEvents = {
  _ls: {},
  on(ev, fn) { (this._ls[ev] = this._ls[ev] || []).push(fn); },
  emit(ev, data) { (this._ls[ev] || []).forEach(fn => fn(data)); },
};

const $ = id => document.getElementById(id);

async function fetchStatus() {
  try {
    const r = await fetch("/api/status");
    const s = await r.json();
    AppState.sysinfo = s;
    const el = $("localProof");
    if (el) {
      el.classList.remove("hidden");
      el.textContent = `⚡ Generado 100% a bordo — vector: ${s.vector_store} (${s.protocols_indexed} protocolos) · ` +
        `llm: ${s.llm} · ${s.earth_link === "offline-autonomous" ? "sin enlace Tierra (T-20min)" : s.earth_link}`;
    }
  } catch {
    AppState.sysinfo = null;
    const el = $("localProof");
    if (el) { el.classList.remove("hidden"); el.textContent = "⚠ Backend sin respuesta"; }
  }
}

/* ---------- Stepper ---------- */
function setStep(n) {
  const steps = [$("stJugar"), $("stSenales"), $("stVeredicto")];
  steps.forEach((s, i) => {
    s?.classList.toggle("active", i === n);
    s?.classList.toggle("done", i < n);
  });
}

/* ---------- NPC Hubzy: check-in emocional (FASE 1) ---------- */
let _audioCtx = null;
function playBabble() {
  // Pitido 8-bits muy corto a tono aleatorio — voz de Hubzy estilo NPC
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = _audioCtx.createOscillator(), g = _audioCtx.createGain();
    o.type = "square";
    o.frequency.value = 520 + Math.random() * 880;
    g.gain.setValueAtTime(0.024, _audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, _audioCtx.currentTime + 0.05);
    o.connect(g); g.connect(_audioCtx.destination);
    o.start(); o.stop(_audioCtx.currentTime + 0.05);
  } catch { /* sin audio no pasa nada */ }
}

function typeText(el, text, done) {
  // respuesta directa — sin animación de transcripción
  el.textContent = text;
  if (done) done();
}

const PSYCH_QUESTIONS = [
  {
    q: "¿Cómo te sientes hoy?",
    key: "mood",
    opts: [["Con energía", "ok"], ["Cansado", "bajo"], ["Muy bajo de ánimo", "malo"]],
  },
  {
    q: "¿Cómo dormiste anoche?",
    key: "sleep",
    opts: [["Bien, dormí completo", "ok"], ["Me desperté varias veces", "regular"], ["Casi no dormí", "mal"]],
  },
  {
    q: "Última: ¿cómo va tu ánimo con el equipo?",
    key: "social",
    opts: [["Bien, conectado", "ok"], ["Algo distante", "distante"], ["Me siento aislado", "aislado"]],
  },
];

function showHubzyCheckin(onDone) {
  const modal = $("hubzyModal");
  if (!modal) { if (onDone) onDone(); return; }
  AppState.psych_answers = [];
  modal.classList.remove("hidden");
  const txt = $("npcText"), ans = $("npcAnswers");
  let qi = 0;

  function ask() {
    const Q = PSYCH_QUESTIONS[qi];
    ans.innerHTML = "";
    typeText(txt, Q.q, () => {
      for (const [label, val] of Q.opts) {
        const b = document.createElement("button");
        b.className = "npc-btn";
        b.textContent = label;
        b.onclick = () => {
          AppState.psych_answers.push(`${Q.key}:${val}`);
          qi++;
          if (qi < PSYCH_QUESTIONS.length) ask(); else close_();
        };
        ans.appendChild(b);
      }
    });
  }
  function close_() {
    ans.innerHTML = "";
    typeText(txt, "Anotado, comandante. Generando tu veredicto con esto en cuenta…", () => {
      setTimeout(() => { modal.classList.add("hidden"); if (onDone) onDone(); }, 1000);
    });
  }
  ask();
}

/* ---------- Respiración 4-7-8 (FASE 3) ---------- */
let breathTimer = null;
function startBreathing() {
  const modal = $("breathModal"), circ = $("breathCircle"),
        phase = $("breathPhase"), count = $("breathCount");
  if (!modal) return;
  modal.classList.remove("hidden");
  const phases = [["INHALA", 4, 1.5], ["SOSTÉN", 7, 1.5], ["EXHALA", 8, 1]];
  let i = 0, cycles = 0;
  function run() {
    if (modal.classList.contains("hidden")) return;
    const [name, secs, scale] = phases[i % 3];
    phase.textContent = name;
    circ.style.transition = `transform ${name === "SOSTÉN" ? 0.5 : secs}s ease-in-out`;
    circ.style.transform = `scale(${scale})`;
    let left = secs;
    count.textContent = left;
    breathTimer = setInterval(() => {
      left--;
      if (left <= 0) {
        clearInterval(breathTimer);
        if (name === "EXHALA") {
          if (++cycles >= 3) {
            phase.textContent = "LISTO"; count.textContent = "✓";
            circ.style.transform = "scale(1)"; return;
          }
        }
        i++; run();
      } else count.textContent = left;
    }, 1000);
  }
  run();
}
function stopBreathing() {
  clearInterval(breathTimer);
  $("breathModal")?.classList.add("hidden");
}

/* ---------- Señales en lenguaje humano ---------- */
const CLS = { ok: "ok", warn: "warn", bad: "bad", na: "na" };
const sig = (icon, name, value, status, cls, sub) => ({ icon, name, value, status, cls, sub });

function buildSignals() {
  const bio = AppState.bio || {};
  const g = AppState.game || {};
  const hrManual = parseFloat($("hrInput")?.value);
  const hrBase = 68;
  const out = [];

  // 👁 Parpadeo (+ PERCLOS y duración en el sub)
  if (bio.blink_rate == null) out.push(sig("👁", "PARPADEO", "—", "sin lectura", CLS.na, "basal 12-20/min"));
  else {
    const v = bio.blink_rate;
    const [st, cls] = v >= 12 ? ["normal", CLS.ok] : v >= 8 ? ["algo bajo — fatiga", CLS.warn] : ["muy bajo — fatiga ocular", CLS.bad];
    const extra = [
      bio.perclos != null ? `ojos cerrados ${Math.round(bio.perclos * 100)}% del tiempo` : null,
      bio.blink_duration_ms ? `parpadeo ${bio.blink_duration_ms} ms` : null,
      bio.sclera_redness != null && bio.sclera_redness > 0.3 ? `enrojecidos` : null,
    ].filter(Boolean).join(" · ");
    out.push(sig("👁", "PARPADEO", `${Math.round(v)}/min`, st, cls, extra || "basal 12-20/min"));
  }

  // 😴 Somnolencia: bostezos + PERCLOS alto
  if (bio.yawn_count == null && bio.perclos == null)
    out.push(sig("😴", "SOMNOLENCIA", "—", "sin lectura", CLS.na, "bostezos · ojos cerrados"));
  else {
    const y = bio.yawn_count || 0, pc = bio.perclos || 0;
    const [st, cls] = (y >= 4 || pc > 0.25) ? ["sueño severo", CLS.bad]
      : (y >= 2 || pc > 0.15) ? ["sueño acumulado", CLS.warn]
      : (y >= 1 || pc > 0.08) ? ["algo de sueño", CLS.ok]
      : ["despierto", CLS.ok];
    const val = `${y} bostezo${y === 1 ? "" : "s"} · ojos cerrados ${Math.round(pc * 100)}%`;
    out.push(sig("😴", "SOMNOLENCIA", val, st, cls, "PERCLOS + MAR"));
  }

  // 🙂 Simetría facial (+ asimetría ocular L-R)
  const asymV = bio.facial_asymmetry, earV = bio.ear_asymmetry;
  if (asymV == null) out.push(sig("🙂", "SIMETRÍA FACIAL", "—", "sin lectura", CLS.na, "alerta neuro temprana"));
  else {
    const v = Math.max(asymV, (earV || 0) * 0.8); // la peor de ambas
    const [st, cls] = v < 0.12 ? ["simétrica", CLS.ok] : v < 0.18 ? ["leve asimetría", CLS.warn] : ["asimetría marcada — revisar", CLS.bad];
    out.push(sig("🙂", "SIMETRÍA FACIAL", v.toFixed(2), st, cls, "rostro + diferencia de ojos"));
  }

  // 👀 Atención visual (iris fuera de centro)
  if (bio.gaze_away_pct == null) out.push(sig("👀", "ATENCIÓN VISUAL", "—", "sin lectura", CLS.na, "mirada fuera de la tarea"));
  else {
    const v = bio.gaze_away_pct;
    const [st, cls] = v <= 0.4 ? ["enfocado", CLS.ok] : v <= 0.55 ? ["algo distraído", CLS.warn] : ["muy distraído", CLS.bad];
    out.push(sig("👀", "ATENCIÓN VISUAL", `${Math.round((1 - v) * 100)}%`, st, cls, "mirando la tarea"));
  }

  // 😖 Tensión facial (ceño fruncido / párpados cargados)
  if (bio.face_tension == null) out.push(sig("😖", "TENSIÓN FACIAL", "—", "sin lectura", CLS.na, "estrés o dolor en el rostro"));
  else {
    const v = bio.face_tension;
    const [st, cls] = v <= 0.45 ? ["relajada", CLS.ok] : v <= 0.6 ? ["algo tensa", CLS.warn] : ["muy tensa — estrés/dolor", CLS.bad];
    out.push(sig("😖", "TENSIÓN FACIAL", `${Math.round(v * 100)}%`, st, cls, "ceño + párpados"));
  }

  if (bio.head_sway == null) out.push(sig("🧍", "ESTABILIDAD", "—", "sin lectura", CLS.na, "temblor cuello/cabeza"));
  else {
    const stab = Math.round((1 - bio.head_sway) * 100);
    const [st, cls] = bio.head_sway < 0.25 ? ["estable", CLS.ok] : bio.head_sway < 0.4 ? ["balanceo leve", CLS.warn] : ["inestable — vestibular", CLS.bad];
    out.push(sig("🧍", "ESTABILIDAD", `${stab}%`, st, cls, "temblor cuello/cabeza"));
  }

  if (g.latency_delta_pct == null) out.push(sig("⚡", "VELOCIDAD MENTAL", "—", "sin jugar", CLS.na, "latencia vs tu basal"));
  else {
    const d = g.latency_delta_pct;
    const [st, cls] = d <= 10 ? ["como tu basal", CLS.ok] : d <= 15 ? ["algo más lenta", CLS.warn] : [`+${Math.round(d)}% — enlentecida`, CLS.bad];
    out.push(sig("⚡", "VELOCIDAD MENTAL", `${g.mean_latency_ms} ms`, st, cls, `${g.lapse_count || 0} lapsus >500 ms`));
  }

  if (g.error_rate == null) out.push(sig("🎯", "PRECISIÓN", "—", "sin jugar", CLS.na, "aciertos en el reto"));
  else {
    const acc = Math.round((1 - g.error_rate) * 100);
    const [st, cls] = g.error_rate <= 0.18 ? ["precisa", CLS.ok] : g.error_rate <= 0.30 ? ["con errores", CLS.warn] : ["errores elevados", CLS.bad];
    out.push(sig("🎯", "PRECISIÓN", `${acc}%`, st, cls, `${g.trials || 0} ensayos`));
  }

  // ❤️ Pulso: rPPG de cámara si hay señal, si no el manual (+ HRV en el sub)
  const hr = bio.rppg_hr ?? (Number.isFinite(hrManual) ? hrManual : null);
  const hrvTxt = bio.hrv_rmssd_ms ? ` · variabilidad ${bio.hrv_rmssd_ms} ms${bio.hrv_rmssd_ms < 25 ? " (baja)" : ""}` : "";
  const hrSrc = (bio.rppg_hr ? "estimado por cámara (rPPG)" : "manual/wearable") + hrvTxt;
  if (hr == null) out.push(sig("❤️", "PULSO", "—", "sin dato", CLS.na, `basal ${hrBase} lpm`));
  else {
    const d = (hr - hrBase) / hrBase * 100;
    const [st, cls] = Math.abs(d) <= 10 ? ["normal", CLS.ok] : d > 10 ? [`+${Math.round(d)}% — elevado`, d > 20 ? CLS.bad : CLS.warn] : [`${Math.round(d)}% — bajo`, CLS.warn];
    out.push(sig("❤️", "PULSO", `${hr} lpm`, st, cls, hrSrc));
  }

  return out;
}

function renderSignals() {
  const panel = $("panelSenales");
  if (!panel) return;
  const signals = buildSignals();
  const grid = $("sigGrid");
  grid.innerHTML = "";
  for (const s of signals) {
    const div = document.createElement("div");
    div.className = `sig ${s.cls}`;
    div.innerHTML = `<span class="sig-ico">${s.icon}</span>
      <div><label>${s.name}</label><b>${s.value}</b>
      <small class="st">${s.status}</small><small class="sub">${s.sub || ""}</small></div>`;
    grid.appendChild(div);
  }

  const rank = { ok: 0, na: 0, warn: 1, bad: 2 };
  const worst = signals.reduce((w, s) => rank[s.cls] > rank[w] ? s.cls : w, "ok");
  const phrases = {
    ok: "Todas las señales dentro de tu rango nominal.",
    warn: "Señales atenuadas detectadas — generando veredicto…",
    bad: "Convergencia de señales anómalas — generando veredicto…",
    na: "Sin datos de sesión registrados.",
  };
  $("mascotPhrase").textContent = phrases[worst] || phrases.ok;

  const sim = (AppState.bio?._source === "simulated" || AppState.game?._source === "simulated");
  $("sigSource").textContent = sim ? "[simulado]" : "[cámara + juego real]";
  panel.classList.remove("hidden");
}

/* ---------- Veredicto ---------- */
const VERDICT = {
  NOMINAL: {
    t: "✓ APTO", cls: "NOMINAL",
    sub: "Operativo nominal — sin restricciones. Reevaluar en 24 h.",
  },
  VERDE: {
    t: "✓ APTO — OBSERVACIÓN", cls: "VERDE",
    sub: "Un dominio leve alterado — registrar y reevaluar en 12 h.",
  },
  AMBAR: {
    t: "⚠ APTO CON RESTRICCIONES", cls: "AMBAR",
    sub: "Contramedidas activas — fuera de tareas críticas (EVA, robótica, acoplamiento) hasta reevaluación en 4 h.",
  },
  ROJO: {
    t: "⛔ NO APTO — EMERGENCIA A BORDO", cls: "ROJO",
    sub: "Convergencia crítica de señales — el CMO toma control clínico. Canal médico prioritario.",
  },
};

function collectMetrics() {
  const hr = parseFloat($("hrInput").value);
  const bio = AppState.bio || {};
  return {
    blink_rate: bio.blink_rate ?? null,
    blink_duration_ms: bio.blink_duration_ms ?? null,
    perclos: bio.perclos ?? null,
    yawn_count: bio.yawn_count ?? null,
    facial_asymmetry: bio.facial_asymmetry ?? null,
    ear_asymmetry: bio.ear_asymmetry ?? null,
    head_sway: bio.head_sway ?? null,
    rppg_hr: bio.rppg_hr ?? null,
    hrv_rmssd_ms: bio.hrv_rmssd_ms ?? null,
    gaze_away_pct: bio.gaze_away_pct ?? null,
    face_tension: bio.face_tension ?? null,
    sclera_redness: bio.sclera_redness ?? null,
    mean_latency_ms: AppState.game?.mean_latency_ms ?? null,
    latency_delta_pct: AppState.game?.latency_delta_pct ?? null,
    error_rate: AppState.game?.error_rate ?? null,
    lapse_count: AppState.game?.lapse_count ?? null,
    hr_bpm: Number.isFinite(hr) ? hr : null,
    hr_baseline_bpm: 68,
    notes: AppState.symptoms.size ? "sintomas: " + [...AppState.symptoms].join(", ") : "",
    psych_answers: AppState.psych_answers || [],
  };
}

async function runTriage() {
  const btn = $("btnTriage");
  btn.disabled = true;
  btn.textContent = "⬢ EVALUANDO CONVERGENCIA DE SEÑALES…";

  let res;
  try {
    const r = await fetch("/api/assessment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectMetrics()),
    });
    res = await r.json();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "⬢ GENERAR VEREDICTO";
    alert("API no disponible: " + e.message);
    return;
  }

  // Veredicto grande y claro
  const v = VERDICT[res.triage_level] || VERDICT.NOMINAL;
  const banner = $("verdictBanner");
  banner.className = "verdict-banner " + v.cls;
  $("verdictTitle").textContent = v.t;
  $("verdictSub").textContent = v.sub;

  const fl = $("findingsList");
  fl.innerHTML = "";
  const DOMAIN_ES = {
    ocular: "ojos", neurologico: "neurológico", vestibular: "equilibrio",
    psicomotor: "reflejos", cognitivo: "mente", cardiovascular: "corazón",
    somnolencia: "sueño", muscular: "tensión",
    psicologico: "salud mental", somatico: "cuerpo",
  };
  if (!res.findings.length) {
    fl.innerHTML = `<li style="border-color:#22c55e"><span class="sev" style="color:#22c55e">SIN ALERTAS</span>Todas las métricas dentro de tu línea base.</li>`;
  }
  for (const f of res.findings) {
    const li = document.createElement("li");
    li.style.borderColor = f.color;
    li.innerHTML = `<span class="sev" style="color:${f.color}">${f.severity_label} · ${(DOMAIN_ES[f.domain] || f.domain).toUpperCase()}</span>${f.plain || f.detail}`;
    fl.appendChild(li);
  }

  const cp = $("composites");
  cp.innerHTML = "";
  for (const c of res.composites || []) {
    const d = document.createElement("div");
    d.textContent = "◈ " + c;
    cp.appendChild(d);
  }

  $("actionCard").textContent = res.action_card;
  $("genBy").textContent = `[${res.generated_by}]`;
  const sl = $("sourcesList");
  sl.innerHTML = "";
  for (const s of res.sources || []) {
    const li = document.createElement("li");
    li.innerHTML = `<b>${s.id}</b> — ${s.title} <i>(${s.section})</i> · score ${s.score}`;
    sl.appendChild(li);
  }

  // Micro-intervención 4-7-8 si el veredicto lo amerita o hay señal de estrés/ánimo
  const needsCalm = ["AMBAR", "ROJO"].includes(res.triage_level) ||
    res.findings.some(f => f.code.startsWith("PSYCH") || f.code === "FACE-TENSION" || f.code === "CV-HRV");
  $("btnBreath")?.classList.toggle("hidden", !needsCalm);

  $("panelVeredicto").classList.remove("hidden");
  $("verdictOut").classList.remove("hidden");
  setStep(2);
  renderTrend(res.triage_level);
  $("verdictBanner").scrollIntoView({ behavior: "smooth", block: "center" });
  btn.disabled = false;
  btn.textContent = "⬢ RE-EVALUAR";
}

/* ---------- Tendencia histórica (línea basal individual = estándar NASA) ---------- */
const TREND_KEY = "astro_triage_history";
const LEVEL_SCORE = { NOMINAL: 100, VERDE: 80, AMBAR: 50, ROJO: 15 };
const LEVEL_COLOR = { NOMINAL: "#22c55e", VERDE: "#a3e635", AMBAR: "#f59e0b", ROJO: "#ef4444" };

function renderTrend(level) {
  const row = $("trendBars");
  if (!row) return;
  let hist = [];
  try { hist = JSON.parse(localStorage.getItem(TREND_KEY) || "[]"); } catch {}
  const today = new Date().toISOString().slice(5, 10); // MM-DD
  if (level && (!hist.length || hist[hist.length - 1].d !== today)) {
    hist.push({ d: today, s: LEVEL_SCORE[level] ?? 50, lvl: level });
    if (hist.length > 14) hist = hist.slice(-14);
    localStorage.setItem(TREND_KEY, JSON.stringify(hist));
  }
  row.innerHTML = "";
  for (const h of hist) {
    const bar = document.createElement("div");
    bar.className = "trend-bar";
    bar.title = `${h.d}: ${h.lvl}`;
    bar.innerHTML = `<i style="height:${h.s}%;background:${LEVEL_COLOR[h.lvl] || "#38bdf8"}"></i><small>${h.d.slice(3)}</small>`;
    row.appendChild(bar);
  }
  $("trendRow").classList.toggle("hidden", hist.length < 2);
}

/* ---------- Voz del veredicto ---------- */
function speakVerdict() {
  if (!("speechSynthesis" in window)) return;
  const t = `${$("verdictTitle").textContent}. ${$("verdictSub").textContent}. ${$("actionCard").textContent.slice(0, 400)}`;
  const u = new SpeechSynthesisUtterance(t);
  u.lang = "es-ES";
  u.rate = 1.0;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/* ---------- Auto-avance: jugar → señales → check-in NPC → veredicto ---------- */
AppEvents.on("game", () => {
  renderSignals();
  setStep(1);
  $("panelSenales").scrollIntoView({ behavior: "smooth", block: "start" });
  // El NPC Hubzy hace el check-in emocional antes de generar el veredicto
  setTimeout(() => showHubzyCheckin(() => runTriage()), 1200);
});

/* ---------- Modo jurado: Alt+Shift+1/2/3 inyecta escenarios ---------- */
const JURY = {
  1: { // NOMINAL
    bio: { blink_rate: 15, blink_duration_ms: 140, perclos: 0.04, yawn_count: 0,
           facial_asymmetry: 0.05, ear_asymmetry: 0.02, head_sway: 0.15,
           rppg_hr: 70, hrv_rmssd_ms: 48, gaze_away_pct: 0.15,
           face_tension: 0.2, sclera_redness: 0.1 },
    game: { mean_latency_ms: 340, latency_delta_pct: 3, error_rate: 0.05, lapse_count: 0, trials: 38 },
    psych: ["mood:ok", "sleep:ok", "social:ok"], sym: [],
  },
  2: { // ÁMBAR — fatiga + estrés (un solo caution, resto advisory)
    bio: { blink_rate: 13, blink_duration_ms: 280, perclos: 0.12, yawn_count: 1,
           facial_asymmetry: 0.08, ear_asymmetry: 0.05, head_sway: 0.30,
           rppg_hr: 78, hrv_rmssd_ms: 22, gaze_away_pct: 0.45,
           face_tension: 0.50, sclera_redness: 0.32 },
    game: { mean_latency_ms: 400, latency_delta_pct: 16, error_rate: 0.20, lapse_count: 5, trials: 34 },
    psych: ["mood:bajo", "sleep:mal", "social:distante"], sym: ["cefalea"],
  },
  3: { // ROJO — asimetría focal + síntomas
    bio: { blink_rate: 8, blink_duration_ms: 310, perclos: 0.21, yawn_count: 2,
           facial_asymmetry: 0.34, ear_asymmetry: 0.22, head_sway: 0.55,
           rppg_hr: 96, hrv_rmssd_ms: 15, gaze_away_pct: 0.5,
           face_tension: 0.62, sclera_redness: 0.4 },
    game: { mean_latency_ms: 445, latency_delta_pct: 28, error_rate: 0.34, lapse_count: 9, trials: 30 },
    psych: ["mood:malo", "sleep:mal", "social:aislado"], sym: ["mareo", "cefalea"],
  },
};

function juryInject(n) {
  const J = JURY[n];
  if (!J) return;
  AppState.bio = { ...J.bio, _source: "jury" };
  AppState.game = { ...J.game, _source: "jury" };
  AppState.psych_answers = [...J.psych];
  AppState.symptoms = new Set(J.sym);
  renderSignals();
  setStep(1);
  $("panelSenales").classList.remove("hidden");
  runTriage();
}

window.addEventListener("keydown", e => {
  if (e.altKey && e.shiftKey && ["Digit1", "Digit2", "Digit3"].includes(e.code)) {
    e.preventDefault();
    juryInject(+e.code.slice(-1));
  }
});

window.addEventListener("DOMContentLoaded", () => {
  fetchStatus();
  setStep(0);
  // Precalienta cámara + MediaPipe mientras el usuario lee la pantalla —
  // los ~9 s de carga ocurren aquí, no al pulsar JUGAR
  Bio.start();
  $("btnReto").onclick = () => { setStep(0); Game.start(); };
  const simBtn = $("btnSimReto"); if (simBtn) simBtn.onclick = () => Game.simulate();
  $("btnTriage").onclick = runTriage;
  $("btnSpeak").onclick = speakVerdict;
  $("btnBreath").onclick = startBreathing;
  $("breathClose").onclick = stopBreathing;
  /* síntomas rápidos eliminados de la UI — AppState.symptoms/notes se mantiene para el modo jurado */
});
