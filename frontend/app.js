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
      el.textContent = L(
        `⚡ Generado 100% a bordo — vector: ${s.vector_store} (${s.protocols_indexed} protocolos) · ` +
        `llm: ${s.llm} · ${s.earth_link === "offline-autonomous" ? "sin enlace Tierra (T-20min)" : s.earth_link}`,
        `⚡ Generated 100% onboard — vector: ${s.vector_store} (${s.protocols_indexed} protocols) · ` +
        `llm: ${s.llm} · ${s.earth_link === "offline-autonomous" ? "no Earth link (T-20min)" : s.earth_link}`);
    }
  } catch {
    AppState.sysinfo = null;
    const el = $("localProof");
    if (el) { el.classList.remove("hidden"); el.textContent = L("⚠ Backend sin respuesta", "⚠ Backend not responding"); }
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

const PSYCH_QUESTIONS_ALL = {
  es: [
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
  ],
  en: [
    {
      q: "How do you feel today?",
      key: "mood",
      opts: [["Energetic", "ok"], ["Tired", "bajo"], ["Very low spirits", "malo"]],
    },
    {
      q: "How did you sleep last night?",
      key: "sleep",
      opts: [["Well, full night", "ok"], ["Woke up several times", "regular"], ["Barely slept", "mal"]],
    },
    {
      q: "Last one: how's your morale with the crew?",
      key: "social",
      opts: [["Good, connected", "ok"], ["A bit distant", "distante"], ["I feel isolated", "aislado"]],
    },
  ],
};

function showHubzyCheckin(onDone) {
  const modal = $("hubzyModal");
  if (!modal) { if (onDone) onDone(); return; }
  AppState.psych_answers = [];
  modal.classList.remove("hidden");
  const txt = $("npcText"), ans = $("npcAnswers");
  const PSYCH_QUESTIONS = PSYCH_QUESTIONS_ALL[Lang.get()] || PSYCH_QUESTIONS_ALL.es;
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
    typeText(txt, L("Anotado, comandante. Generando tu veredicto con esto en cuenta…",
                    "Noted, commander. Generating your verdict with this in mind…"), () => {
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
  const HOLD = L("SOSTÉN", "HOLD");
  const phases = [[L("INHALA", "INHALE"), 4, 1.5], [HOLD, 7, 1.5], [L("EXHALA", "EXHALE"), 8, 1]];
  let i = 0, cycles = 0;
  function run() {
    if (modal.classList.contains("hidden")) return;
    const [name, secs, scale] = phases[i % 3];
    phase.textContent = name;
    circ.style.transition = `transform ${name === HOLD ? 0.5 : secs}s ease-in-out`;
    circ.style.transform = `scale(${scale})`;
    let left = secs;
    count.textContent = left;
    breathTimer = setInterval(() => {
      left--;
      if (left <= 0) {
        clearInterval(breathTimer);
        if (name === "EXHALA") {
          if (++cycles >= 3) {
            phase.textContent = L("LISTO", "DONE"); count.textContent = "✓";
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
  const NA = L("sin lectura", "no reading");
  const BPS = L("basal 12-20/min", "baseline 12-20/min");

  // 👁 Parpadeo (+ PERCLOS y duración en el sub)
  if (bio.blink_rate == null) out.push(sig("👁", L("PARPADEO", "BLINKING"), "—", NA, CLS.na, BPS));
  else {
    const v = bio.blink_rate;
    const [st, cls] = v >= 12 ? [L("normal", "normal"), CLS.ok]
      : v >= 8 ? [L("algo bajo — fatiga", "somewhat low — fatigue"), CLS.warn]
      : [L("muy bajo — fatiga ocular", "very low — eye fatigue"), CLS.bad];
    const extra = [
      bio.perclos != null ? L(`ojos cerrados ${Math.round(bio.perclos * 100)}% del tiempo`,
        `eyes closed ${Math.round(bio.perclos * 100)}% of the time`) : null,
      bio.blink_duration_ms ? L(`parpadeo ${bio.blink_duration_ms} ms`,
        `blink ${bio.blink_duration_ms} ms`) : null,
      bio.sclera_redness != null && bio.sclera_redness > 0.3 ? L("enrojecidos", "reddened") : null,
    ].filter(Boolean).join(" · ");
    out.push(sig("👁", L("PARPADEO", "BLINKING"), `${Math.round(v)}/min`, st, cls, extra || BPS));
  }

  // 😴 Somnolencia: bostezos + PERCLOS alto
  if (bio.yawn_count == null && bio.perclos == null)
    out.push(sig("😴", L("SOMNOLENCIA", "DROWSINESS"), "—", NA, CLS.na, L("bostezos · ojos cerrados", "yawns · eyes closed")));
  else {
    const y = bio.yawn_count || 0, pc = bio.perclos || 0;
    const [st, cls] = (y >= 4 || pc > 0.25) ? [L("sueño severo", "severe drowsiness"), CLS.bad]
      : (y >= 2 || pc > 0.15) ? [L("sueño acumulado", "built-up sleep debt"), CLS.warn]
      : (y >= 1 || pc > 0.08) ? [L("algo de sueño", "mildly drowsy"), CLS.ok]
      : [L("despierto", "awake"), CLS.ok];
    const val = L(
      `${y} bostezo${y === 1 ? "" : "s"} · ojos cerrados ${Math.round(pc * 100)}%`,
      `${y} yawn${y === 1 ? "" : "s"} · eyes closed ${Math.round(pc * 100)}%`);
    out.push(sig("😴", L("SOMNOLENCIA", "DROWSINESS"), val, st, cls, "PERCLOS + MAR"));
  }

  // 🙂 Simetría facial (+ asimetría ocular L-R)
  const asymV = bio.facial_asymmetry, earV = bio.ear_asymmetry;
  if (asymV == null) out.push(sig("🙂", L("SIMETRÍA FACIAL", "FACIAL SYMMETRY"), "—", NA, CLS.na, L("alerta neuro temprana", "early neuro alert")));
  else {
    const v = Math.max(asymV, (earV || 0) * 0.8); // la peor de ambas
    const [st, cls] = v < 0.12 ? [L("simétrica", "symmetric"), CLS.ok]
      : v < 0.18 ? [L("leve asimetría", "slight asymmetry"), CLS.warn]
      : [L("asimetría marcada — revisar", "marked asymmetry — check"), CLS.bad];
    out.push(sig("🙂", L("SIMETRÍA FACIAL", "FACIAL SYMMETRY"), v.toFixed(2), st, cls, L("rostro + diferencia de ojos", "face + eye difference")));
  }

  // 👀 Atención visual (iris fuera de centro)
  if (bio.gaze_away_pct == null) out.push(sig("👀", L("ATENCIÓN VISUAL", "VISUAL FOCUS"), "—", NA, CLS.na, L("mirada fuera de la tarea", "gaze off task")));
  else {
    const v = bio.gaze_away_pct;
    const [st, cls] = v <= 0.4 ? [L("enfocado", "focused"), CLS.ok]
      : v <= 0.55 ? [L("algo distraído", "somewhat distracted"), CLS.warn]
      : [L("muy distraído", "very distracted"), CLS.bad];
    out.push(sig("👀", L("ATENCIÓN VISUAL", "VISUAL FOCUS"), `${Math.round((1 - v) * 100)}%`, st, cls, L("mirando la tarea", "watching the task")));
  }

  // 😖 Tensión facial (ceño fruncido / párpados cargados)
  if (bio.face_tension == null) out.push(sig("😖", L("TENSIÓN FACIAL", "FACE TENSION"), "—", NA, CLS.na, L("estrés o dolor en el rostro", "stress or pain in the face")));
  else {
    const v = bio.face_tension;
    const [st, cls] = v <= 0.45 ? [L("relajada", "relaxed"), CLS.ok]
      : v <= 0.6 ? [L("algo tensa", "somewhat tense"), CLS.warn]
      : [L("muy tensa — estrés/dolor", "very tense — stress/pain"), CLS.bad];
    out.push(sig("😖", L("TENSIÓN FACIAL", "FACE TENSION"), `${Math.round(v * 100)}%`, st, cls, L("ceño + párpados", "brow + eyelids")));
  }

  if (bio.head_sway == null) out.push(sig("🧍", L("ESTABILIDAD", "STABILITY"), "—", NA, CLS.na, L("temblor cuello/cabeza", "neck/head sway")));
  else {
    const stab = Math.round((1 - bio.head_sway) * 100);
    const [st, cls] = bio.head_sway < 0.25 ? [L("estable", "stable"), CLS.ok]
      : bio.head_sway < 0.4 ? [L("balanceo leve", "slight sway"), CLS.warn]
      : [L("inestable — vestibular", "unstable — vestibular"), CLS.bad];
    out.push(sig("🧍", L("ESTABILIDAD", "STABILITY"), `${stab}%`, st, cls, L("temblor cuello/cabeza", "neck/head sway")));
  }

  if (g.latency_delta_pct == null) out.push(sig("⚡", L("VELOCIDAD MENTAL", "MENTAL SPEED"), "—", L("sin jugar", "no game"), CLS.na, L("latencia vs tu basal", "latency vs your baseline")));
  else {
    const d = g.latency_delta_pct;
    const [st, cls] = d <= 10 ? [L("como tu basal", "at your baseline"), CLS.ok]
      : d <= 15 ? [L("algo más lenta", "somewhat slower"), CLS.warn]
      : [`+${Math.round(d)}% — ${L("enlentecida", "slowed")}`, CLS.bad];
    out.push(sig("⚡", L("VELOCIDAD MENTAL", "MENTAL SPEED"), `${g.mean_latency_ms} ms`, st, cls,
      `${g.lapse_count || 0} ${L("lapsus", "lapses")} >500 ms`));
  }

  if (g.error_rate == null) out.push(sig("🎯", L("PRECISIÓN", "ACCURACY"), "—", L("sin jugar", "no game"), CLS.na, L("aciertos en el reto", "hits in the challenge")));
  else {
    const acc = Math.round((1 - g.error_rate) * 100);
    const [st, cls] = g.error_rate <= 0.18 ? [L("precisa", "accurate"), CLS.ok]
      : g.error_rate <= 0.30 ? [L("con errores", "with errors"), CLS.warn]
      : [L("errores elevados", "high error count"), CLS.bad];
    out.push(sig("🎯", L("PRECISIÓN", "ACCURACY"), `${acc}%`, st, cls, `${g.trials || 0} ${L("ensayos", "trials")}`));
  }

  // ❤️ Pulso: rPPG de cámara si hay señal, si no el manual (+ HRV en el sub)
  const hr = bio.rppg_hr ?? (Number.isFinite(hrManual) ? hrManual : null);
  const hrvTxt = bio.hrv_rmssd_ms ? L(
    ` · variabilidad ${bio.hrv_rmssd_ms} ms${bio.hrv_rmssd_ms < 25 ? " (baja)" : ""}`,
    ` · variability ${bio.hrv_rmssd_ms} ms${bio.hrv_rmssd_ms < 25 ? " (low)" : ""}`) : "";
  const hrSrc = (bio.rppg_hr ? L("estimado por cámara (rPPG)", "camera-estimated (rPPG)") : "manual/wearable") + hrvTxt;
  if (hr == null) out.push(sig("❤️", L("PULSO", "PULSE"), "—", L("sin dato", "no data"), CLS.na, L(`basal ${hrBase} lpm`, `baseline ${hrBase} bpm`)));
  else {
    const d = (hr - hrBase) / hrBase * 100;
    const [st, cls] = Math.abs(d) <= 10 ? [L("normal", "normal"), CLS.ok]
      : d > 10 ? [`+${Math.round(d)}% — ${L("elevado", "elevated")}`, d > 20 ? CLS.bad : CLS.warn]
      : [`${Math.round(d)}% — ${L("bajo", "low")}`, CLS.warn];
    out.push(sig("❤️", L("PULSO", "PULSE"), `${hr} ${L("lpm", "bpm")}`, st, cls, hrSrc));
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
    ok: L("Todas las señales dentro de tu rango nominal.", "All signals within your nominal range."),
    warn: L("Señales atenuadas detectadas — generando veredicto…", "Attenuated signals detected — generating verdict…"),
    bad: L("Convergencia de señales anómalas — generando veredicto…", "Converging anomalous signals — generating verdict…"),
    na: L("Sin datos de sesión registrados.", "No session data recorded."),
  };
  $("mascotPhrase").textContent = phrases[worst] || phrases.ok;

  const sim = (AppState.bio?._source === "simulated" || AppState.game?._source === "simulated");
  $("sigSource").textContent = sim ? L("[simulado]", "[simulated]") : L("[cámara + juego real]", "[camera + live game]");
  panel.classList.remove("hidden");
}

/* ---------- Veredicto ---------- */
const VERDICT_ALL = {
  es: {
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
  },
  en: {
    NOMINAL: {
      t: "✓ FIT", cls: "NOMINAL",
      sub: "Nominal — no restrictions. Re-check in 24 h.",
    },
    VERDE: {
      t: "✓ FIT — MONITOR", cls: "VERDE",
      sub: "One mild domain altered — log and re-check in 12 h.",
    },
    AMBAR: {
      t: "⚠ FIT WITH RESTRICTIONS", cls: "AMBAR",
      sub: "Active countermeasures — off critical tasks (EVA, robotics, docking) until re-check in 4 h.",
    },
    ROJO: {
      t: "⛔ UNFIT — ONBOARD EMERGENCY", cls: "ROJO",
      sub: "Critical signal convergence — the CMO takes clinical control. Priority medical channel.",
    },
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
    lang: Lang.get(),
  };
}

async function runTriage() {
  const btn = $("btnTriage");
  btn.disabled = true;
  btn.textContent = L("⬢ EVALUANDO CONVERGENCIA DE SEÑALES…", "⬢ EVALUATING SIGNAL CONVERGENCE…");

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
    btn.textContent = L("⬢ GENERAR VEREDICTO", "⬢ GENERATE VERDICT");
    alert(L("API no disponible: ", "API unavailable: ") + e.message);
    return;
  }

  // Veredicto grande y claro
  const VERDICT = VERDICT_ALL[Lang.get()] || VERDICT_ALL.es;
  const v = VERDICT[res.triage_level] || VERDICT.NOMINAL;
  const banner = $("verdictBanner");
  banner.className = "verdict-banner " + v.cls;
  $("verdictTitle").textContent = v.t;
  $("verdictSub").textContent = v.sub;

  const fl = $("findingsList");
  fl.innerHTML = "";
  const DOMAIN = {
    es: {
      ocular: "ojos", neurologico: "neurológico", vestibular: "equilibrio",
      psicomotor: "reflejos", cognitivo: "mente", cardiovascular: "corazón",
      somnolencia: "sueño", muscular: "tensión",
      psicologico: "salud mental", somatico: "cuerpo",
    },
    en: {
      ocular: "eyes", neurologico: "neurological", vestibular: "balance",
      psicomotor: "reflexes", cognitivo: "mind", cardiovascular: "heart",
      somnolencia: "sleep", muscular: "tension",
      psicologico: "mental health", somatico: "body",
    },
  }[Lang.get()] || {};
  if (!res.findings.length) {
    fl.innerHTML = L(
      `<li style="border-color:#22c55e"><span class="sev" style="color:#22c55e">SIN ALERTAS</span>Todas las métricas dentro de tu línea base.</li>`,
      `<li style="border-color:#22c55e"><span class="sev" style="color:#22c55e">NO ALERTS</span>All metrics within your baseline.</li>`);
  }
  for (const f of res.findings) {
    const li = document.createElement("li");
    li.style.borderColor = f.color;
    li.innerHTML = `<span class="sev" style="color:${f.color}">${f.severity_label} · ${(DOMAIN[f.domain] || f.domain).toUpperCase()}</span>${f.plain || f.detail}`;
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
  btn.textContent = L("⬢ RE-EVALUAR", "⬢ RE-EVALUATE");
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
  u.lang = Lang.get() === "en" ? "en-US" : "es-ES";
  u.rate = 1.0;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/* ---------- Cambio de idioma en tiempo real ----------
   Re-renderiza todo el contenido dinámico ya mostrado. */
window.addEventListener("langchange", () => {
  fetchStatus(); // prueba local ("Generado 100% a bordo…")
  if ($("panelSenales") && !$("panelSenales").classList.contains("hidden")) {
    renderSignals();
  }
  if ($("verdictOut") && !$("verdictOut").classList.contains("hidden")) {
    runTriage(); // re-evalúa: el backend devuelve hallazgos/tarjeta en el idioma nuevo
  }
  if (typeof Game !== "undefined" && Game.relocalize) Game.relocalize();
  // Estado de la cámara tras captura completada
  const cm = $("camMsg");
  if (cm && !cm.classList.contains("hidden") && AppState.bio) {
    cm.textContent = L("✓ Captura completada", "✓ Capture complete");
  }
});

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
