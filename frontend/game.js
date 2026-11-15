/* Reto neuro de cartas — Hubzy Astro-Triage (corazón de Hubzi).
 * 60 s de asociación rápida: se muestra una SEÑAL OBJETIVO y 4 cartas;
 * el tripulante pulsa la carta idéntica (o "NINGUNA"). Por detrás se mide
 * latencia de respuesta (ms), lapsus >500 ms (criterio PVT) y tasa de error.
 * La línea basal individual se guarda en localStorage entre sesiones.
 */

const Game = (() => {
  const DURATION_S = 60;
  const N_OPTIONS = 4;
  const PVT_LAPSE_MS = 500;
  // Emojis temáticos: inconfundibles entre sí aunque el tripulante esté cansado
  const SYMBOLS = ["🚀", "🌍", "⭐", "🔥", "💧", "⚡", "🌙", "🪐"];
  const BASELINE_KEY = "astro_triage_baseline_ms";

  const state = {
    running: false,
    target: null,
    options: [],
    hasMatch: false,
    shownTs: 0,
    hits: 0,
    errors: 0,
    streak: 0,
    score: 0,
    latencies: [],
    timer: null,
    endTs: 0,
  };

  const $ = id => document.getElementById(id);

  // Última línea de basal mostrada — se re-escribe al cambiar de idioma
  let lastBaseline = null;
  function writeBaseline(b) {
    lastBaseline = b;
    const el = $("baselineInfo");
    if (!el) return;
    el.textContent = L(
      `basal: ${b.base.toFixed(0)} ms · media${b.simulated ? "" : " sesión"}: ${b.mean.toFixed(0)} ms ` +
      `(Δ ${b.deltaPct.toFixed(1)}%) · lapsus>500ms: ${b.lapses} · ${b.simulated ? "simulado" : `trials: ${b.n}`}`,
      `baseline: ${b.base.toFixed(0)} ms · ${b.simulated ? "mean" : "session mean"}: ${b.mean.toFixed(0)} ms ` +
      `(Δ ${b.deltaPct.toFixed(1)}%) · lapses>500ms: ${b.lapses} · ${b.simulated ? "simulated" : `trials: ${b.n}`}`);
  }
  function relocalize() {
    if (lastBaseline) writeBaseline(lastBaseline);
    if (state.done) {
      capySay(L(`Sesión completada — ${state.score} puntos. Generando análisis…`,
                `Session complete — ${state.score} points. Running analysis…`));
    }
  }

  const PRAISE = () => L(["Acierto.", "Preciso.", "Ritmo constante.", "Bien ejecutado."],
                         ["Hit.", "Precise.", "Steady rhythm.", "Well executed."]);
  const OOPS = () => L(["Incorrecto.", "Racha reiniciada.", "Fuera de marca."],
                       ["Miss.", "Streak reset.", "Off target."]);

  function capySay(msg) {
    const el = $("capyLine");
    if (el) el.textContent = msg;
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function newRound() {
    if (!state.running) return;
    state.target = pick(SYMBOLS);
    $("targetSym").textContent = state.target;

    // 75% de rondas con coincidencia, 25% trampa (ninguna coincide)
    state.hasMatch = Math.random() < 0.75;
    const pool = SYMBOLS.filter(s => s !== state.target);
    shuffle(pool);
    state.options = state.hasMatch
      ? shuffle([state.target, ...pool.slice(0, N_OPTIONS - 1)])
      : pool.slice(0, N_OPTIONS);

    const grid = $("cardGrid");
    grid.innerHTML = "";
    for (const sym of state.options) {
      const c = document.createElement("div");
      c.className = "card option";
      c.textContent = sym;
      c.onclick = () => answer(sym === state.target, c);
      grid.appendChild(c);
    }
    // Quinta carta: "NINGUNA" — misma talla que las demás
    const none = document.createElement("div");
    none.className = "card option none";
    none.innerHTML = `<span class="none-x">✕</span><span class="none-txt">${L("NINGUNA", "NONE")}</span>`;
    none.onclick = () => answer(!state.hasMatch, none);
    grid.appendChild(none);
    state.shownTs = performance.now();
  }

  function answer(correct, cardEl) {
    if (!state.running) return;
    const ms = performance.now() - state.shownTs;
    state.latencies.push(ms);
    if (correct) {
      state.hits++;
      state.streak++;
      state.score += 10 + Math.min(state.streak, 10); // bonus por racha
      $("gHits").textContent = state.score;
      $("gMs").textContent = "×" + state.streak;
      capySay(state.streak >= 10 ? L("Racha destacada.", "Notable streak.") :
              state.streak >= 5 ? L("Racha en curso.", "On a streak.") : pick(PRAISE()));
      if (cardEl) cardEl.classList.add("hit");
      setTimeout(newRound, 120);
    } else {
      state.errors++;
      state.streak = 0;
      state.score = Math.max(0, state.score - 3);
      $("gErr").textContent = state.errors;
      $("gHits").textContent = state.score;
      $("gMs").textContent = "×0";
      capySay(pick(OOPS()));
      if (cardEl) cardEl.classList.add("miss");
      setTimeout(newRound, 220); // coste por error
    }
  }

  function baseline() {
    const v = localStorage.getItem(BASELINE_KEY);
    return v ? parseFloat(v) : null;
  }

  async function finish() {
    state.running = false;
    $("btnReto").disabled = false;
    $("cardGrid").innerHTML = "";

    // El check-in invisible termina con el juego: recoger biometría capturada
    const bio = await Bio.stop();
    if (bio) { AppState.bio = bio; }
    else { state.bioFallback = true; Bio.simulate(); }

    const n = state.latencies.length;
    const mean = n ? state.latencies.reduce((a, b) => a + b, 0) / n : 0;
    const lapses = state.latencies.filter(l => l > PVT_LAPSE_MS).length;
    const total = state.hits + state.errors;
    const errorRate = total ? state.errors / total : 0;

    // Línea basal: primer día = propia media; días siguientes = guardada
    let base = baseline();
    let deltaPct = 0;
    if (base && base > 0) {
      deltaPct = Math.max(0, ((mean - base) / base) * 100);
    } else {
      // primera sesión: calibrar con primer tercio como basal
      const third = Math.max(3, Math.floor(n / 3));
      const firstMean = state.latencies.slice(0, third).reduce((a, b) => a + b, 0) / third || mean;
      deltaPct = Math.max(0, ((mean - firstMean) / firstMean) * 100);
      // Solo se guarda una basal de una sesión válida (<1500 ms de media)
      if (mean > 0 && mean < 1500) {
        localStorage.setItem(BASELINE_KEY, mean.toFixed(0));
        base = mean;
      } else {
        base = mean;
      }
    }

    const result = {
      mean_latency_ms: +mean.toFixed(0),
      latency_delta_pct: +deltaPct.toFixed(1),
      error_rate: +errorRate.toFixed(3),
      lapse_count: lapses,
      trials: n,
      _source: "cards",
    };
    AppState.game = result;
    AppEvents.emit("game", result);

    state.done = true;
    writeBaseline({ base, mean, deltaPct, lapses, n, simulated: false });
    $("targetSym").textContent = "✓";
    capySay(L(`Sesión completada — ${state.score} puntos. Generando análisis…`,
              `Session complete — ${state.score} points. Running analysis…`));
  }

  async function start() {
    state.running = true;
    state.hits = 0; state.errors = 0;
    state.streak = 0; state.score = 0;
    state.latencies = [];
    $("gHits").textContent = "0";
    $("gErr").textContent = "0";
    $("gMs").textContent = "×0";
    state.done = false;
    capySay(L("Sesión en curso.", "Session running."));
    $("btnReto").disabled = true;

    // Check-in invisible: la cámara arranca en segundo plano — nunca bloquea el juego
    state.bioFallback = false;
    Bio.start().then(ok => { state.bioFallback = !ok; });

    state.endTs = performance.now() + DURATION_S * 1000;
    newRound();

    state.timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((state.endTs - performance.now()) / 1000));
      $("gTime").textContent = left;
      if (left <= 0) {
        clearInterval(state.timer);
        finish();
      }
    }, 250);
  }

  function simulate() {
    // Sesión simulada completa: juego degradado + biometría de fatiga leve
    const base = baseline() || 340;
    const result = {
      mean_latency_ms: +(base * 1.18 + (Math.random() - 0.5) * 20).toFixed(0),
      latency_delta_pct: +(15 + Math.random() * 8).toFixed(1),
      error_rate: +(0.18 + Math.random() * 0.12).toFixed(3),
      lapse_count: 3 + Math.floor(Math.random() * 4),
      trials: 34,
      _source: "simulated",
    };
    AppState.game = result;
    Bio.simulate(); // también llena AppState.bio
    AppEvents.emit("game", result);
    state.done = true;
    writeBaseline({ base, mean: result.mean_latency_ms, deltaPct: result.latency_delta_pct,
                    lapses: result.lapse_count, n: 0, simulated: true });
  }

  return { start, simulate, relocalize, DURATION_S };
})();
