/* Biometría pasiva por cámara — Hubzy Astro-Triage (módulo CoachVirtual).
 * Corre en segundo plano MIENTRAS se juega: el monitoreo es invisible.
 * MediaPipe FaceMesh -> EAR adaptativo (parpadeo + duración), PERCLOS,
 * bostezos (MAR), asimetría facial + asimetría ocular L-R, estabilidad
 * postural y PULSO rPPG (verde de mejillas/frente).
 * API: Bio.start() -> Promise<bool ok>; Bio.stop() -> métricas | null.
 * Si la CDN o la webcam no están disponibles -> Bio.simulate() (el demo nunca muere).
 */

const Bio = (() => {
  const L_EYE = [33, 160, 158, 133, 153, 144];
  const R_EYE = [362, 385, 387, 263, 373, 380];
  const SYM_PAIRS = [[61, 291], [33, 263], [133, 362], [50, 280], [105, 334], [70, 300]];
  const NOSE_TIP = 1;
  const LIP_UP = 13, LIP_LO = 14, MOUTH_L = 78, MOUTH_R = 308;
  const RPPG_PTS = [10, 116, 345]; // frente + ambas mejillas
  const IRIS_L = 468, IRIS_R = 473;              // centros de iris (refineLandmarks)
  const BROW_EYE = [[105, 159], [334, 386]];     // ceja -> párpado sup. (ceño fruncido)
  const SCLERA = [[133, -1], [362, 1]];          // esclerótica nasal (offset hacia la nariz)

  const CLOSE_RATIO = 0.68, OPEN_RATIO = 0.82, PERCLOS_RATIO = 0.78;
  const EAR_CLOSE_FB = 0.19, EAR_OPEN_FB = 0.24;
  const MIN_CLOSED_FRAMES = 2, REFRACT_MS = 300, WARMUP_MS = 1500;
  const MAR_YAWN = 0.55, MAR_CLOSE = 0.30, YAWN_MIN_MS = 800;


  const state = {
    active: false, sawFace: false,
    blinkCount: 0, closedFrames: 0, lastBlinkTs: 0,
    blinkDurTrail: [],
    perclosFrames: 0, totalFrames: 0,
    earBuf: [], earAsymSum: 0, earAsymN: 0,
    asymSum: 0, asymN: 0,
    lastNose: null, deltaTrail: [],
    marOpenSince: 0, yawnCount: 0, yawnCooldown: 0,
    rppg: [], rppgBpm: null, hrv: null,
    awayFrames: 0, browBase: [], tensionSum: 0, tensionN: 0,
    redSum: 0, redN: 0,
    startTs: 0, frameN: 0,
    mediapipeOk: typeof FaceMesh !== "undefined" && typeof Camera !== "undefined",
  };

  let faceMesh = null, mpCamera = null;
  const rppgCv = document.createElement("canvas");
  const rppgCtx = rppgCv.getContext("2d", { willReadFrequently: true });

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  function ear(lm, idx) {
    const [p1, p2, p3, p4, p5, p6] = idx.map(i => lm[i]);
    return (dist(p2, p6) + dist(p3, p5)) / (2 * dist(p1, p4) + 1e-9);
  }

  function percentile(arr, p) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * p / 100))];
  }

  function openEar() {
    return state.earBuf.length >= 45 ? percentile(state.earBuf, 90) : null;
  }
  function thresholds() {
    const o = openEar();
    return o ? { close: o * CLOSE_RATIO, open: o * OPEN_RATIO }
             : { close: EAR_CLOSE_FB, open: EAR_OPEN_FB };
  }

  // ---------- rPPG: pulso por cambios de color en la piel ----------
  function sampleRppg(res, lm, now) {
    const img = res.image;
    if (!img || !img.width) return;
    if (rppgCv.width !== img.width) { rppgCv.width = img.width; rppgCv.height = img.height; }
    rppgCtx.drawImage(img, 0, 0);
    let gSum = 0, n = 0;
    for (const pi of RPPG_PTS) {
      const px = Math.min(img.width - 8, Math.max(0, lm[pi].x * img.width - 4));
      const py = Math.min(img.height - 8, Math.max(0, lm[pi].y * img.height - 4));
      const d = rppgCtx.getImageData(px, py, 8, 8).data;
      for (let i = 0; i < d.length; i += 4) { gSum += d[i + 1]; n++; }
    }
    state.rppg.push({ t: now, g: gSum / n });
    while (state.rppg.length && now - state.rppg[0].t > 12000) state.rppg.shift();
    computeBpm(now);
  }

  function computeBpm(now) {
    const buf = state.rppg.filter(p => now - p.t <= 9000);
    if (buf.length < 90) return; // ~15 Hz x 6 s mínimo
    const vals = buf.map(p => p.g);
    // detrend con media móvil de ~1 s
    const win = Math.max(5, Math.round(buf.length / 9));
    const sm = vals.map((_, i) => {
      const a = Math.max(0, i - win), b = Math.min(vals.length, i + win);
      let s = 0; for (let j = a; j < b; j++) s += vals[j];
      return vals[i] - s / (b - a);
    });
    const mean = sm.reduce((a, b) => a + b, 0) / sm.length;
    const sd = Math.sqrt(sm.reduce((a, b) => a + (b - mean) ** 2, 0) / sm.length);
    if (sd < 0.4) { state.rppgBpm = null; return; } // poca luz / sin señal
    // picos con refractario 0.45 s (<=133 lpm)
    let peaks = 0, lastPk = -1e9;
    const pkTimes = [];
    for (let i = 1; i < sm.length - 1; i++) {
      if (sm[i] > sm[i - 1] && sm[i] >= sm[i + 1] && sm[i] > mean + 0.5 * sd) {
        if (buf[i].t - lastPk > 450) { peaks++; lastPk = buf[i].t; pkTimes.push(buf[i].t); }
      }
    }
    const secs = (buf[buf.length - 1].t - buf[0].t) / 1000;
    const bpm = peaks / secs * 60;
    state.rppgBpm = (bpm >= 45 && bpm <= 160 && peaks >= 4) ? Math.round(bpm) : null;

    // HRV: intervalos entre latidos -> RMSSD (estrés/recuperación)
    if (pkTimes.length >= 8) {
      const ibis = [];
      for (let i = 1; i < pkTimes.length; i++) {
        const d = pkTimes[i] - pkTimes[i - 1];
        if (d > 350 && d < 1500) ibis.push(d); // 40-170 lpm
      }
      if (ibis.length >= 6) {
        const diffs = ibis.slice(1).map((v, i) => v - ibis[i]);
        state.hrv = Math.round(Math.sqrt(
          diffs.reduce((a, b) => a + b * b, 0) / diffs.length
        ));
      }
    }
  }

  // ---------- detecciones principales ----------
  function onResults(res) {
    if (!state.active) return;
    const cv = document.getElementById("overlay");
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);

    if (!res.multiFaceLandmarks || !res.multiFaceLandmarks.length) {
      // modo búsqueda — barrido de escaneo + visor
      const t = performance.now();
      const sy = (t % 2400) / 2400 * cv.height;
      const g = ctx.createLinearGradient(0, sy - 50, 0, sy);
      g.addColorStop(0, "rgba(34,211,238,0)");
      g.addColorStop(1, "rgba(34,211,238,.22)");
      ctx.fillStyle = g;
      ctx.fillRect(0, sy - 50, cv.width, 50);
      ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(cv.width, sy); ctx.stroke();
      const m = 18, cl = 22;
      ctx.lineWidth = 2.5;
      for (const [cx, cy, dx, dy] of [[m, m, 1, 1], [cv.width - m, m, -1, 1],
                                      [m, cv.height - m, 1, -1], [cv.width - m, cv.height - m, -1, -1]]) {
        ctx.beginPath();
        ctx.moveTo(cx + cl * dx, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + cl * dy);
        ctx.stroke();
      }
      ctx.font = "600 10px Consolas, monospace";
      ctx.fillStyle = "#22d3ee";
      ctx.fillText("SCANNING" + ".".repeat(1 + (Math.floor(t / 400) % 3)), m + 8, m + 16);
      return;
    }
    state.sawFace = true;
    const lm = res.multiFaceLandmarks[0];
    const now = performance.now();
    const warmed = now - state.startTs > WARMUP_MS;
    if (warmed) state.totalFrames++;

    // --- EAR por ojo ---
    const eL = ear(lm, L_EYE), eR = ear(lm, R_EYE);
    const e = (eL + eR) / 2;
    state.earBuf.push(e);
    if (state.earBuf.length > 150) state.earBuf.shift();
    const th = thresholds();

    if (warmed) {
      // asimetría ocular L-R (un ojo cae distinto -> refuerzo neuro)
      state.earAsymSum += Math.abs(eL - eR) / (e + 1e-9);
      state.earAsymN++;

      // PERCLOS: % de frames con ojo >= ~78% cerrado
      const o = openEar();
      if (e < (o ? o * PERCLOS_RATIO : EAR_CLOSE_FB * 1.15)) state.perclosFrames++;

      // parpadeo (histéresis + refractario) + duración del parpadeo
      if (e < th.close) {
        state.closedFrames++;
      } else if (e > th.open) {
        if (state.closedFrames >= MIN_CLOSED_FRAMES &&
            now - state.lastBlinkTs > REFRACT_MS) {
          state.blinkCount++;
          state.lastBlinkTs = now;
          state.blinkDurTrail.push(state.closedFrames);
          if (state.blinkDurTrail.length > 60) state.blinkDurTrail.shift();
          const bf = document.getElementById("blinkFlash");
          if (bf) {
            bf.classList.remove("hidden");
            setText("blinkCount", state.blinkCount);
            bf.classList.add("pop");
            setTimeout(() => bf.classList.remove("pop"), 160);
          }
        }
        state.closedFrames = 0;
      }
    }

    // --- Bostezo: apertura bucal (MAR) sostenida ---
    const mar = dist(lm[LIP_UP], lm[LIP_LO]) / (dist(lm[MOUTH_L], lm[MOUTH_R]) + 1e-9);
    if (warmed) {
      if (mar > MAR_YAWN) {
        if (!state.marOpenSince) state.marOpenSince = now;
        else if (now - state.marOpenSince > YAWN_MIN_MS && now > state.yawnCooldown) {
          state.yawnCount++;
          state.yawnCooldown = now + 3000;
          state.marOpenSince = 0;
          const yf = document.getElementById("yawnFlash");
          if (yf) {
            yf.classList.remove("hidden");
            setText("yawnCount", state.yawnCount);
            yf.classList.add("pop");
            setTimeout(() => { yf.classList.remove("pop"); yf.classList.add("hidden"); }, 1500);
          }
        }
      } else if (mar < MAR_CLOSE) state.marOpenSince = 0;
    }

    // --- Asimetría facial global ---
    const faceW = dist(lm[33], lm[263]) + 1e-9;
    let asym = 0;
    for (const [l, r] of SYM_PAIRS) {
      asym += Math.abs(dist(lm[l], lm[NOSE_TIP]) - dist(lm[r], lm[NOSE_TIP])) / faceW;
    }
    if (warmed) { state.asymSum += asym / SYM_PAIRS.length; state.asymN++; }

    // --- Atención visual: iris desplazado del centro del ojo ---
    if (warmed && lm[IRIS_L] && lm[IRIS_R]) {
      const gL = (lm[IRIS_L].x - lm[133].x) / (lm[33].x - lm[133].x + 1e-9);
      const gR = (lm[263].x - lm[IRIS_R].x) / (lm[263].x - lm[362].x + 1e-9);
      if (Math.abs(gL - 0.5) > 0.22 || Math.abs(gR - 0.5) > 0.22) state.awayFrames++;
    }

    // --- Tensión facial: ceño fruncido (ceja-ojo) + párpados caídos ---
    if (warmed) {
      const cur = (dist(lm[BROW_EYE[0][0]], lm[BROW_EYE[0][1]]) +
                   dist(lm[BROW_EYE[1][0]], lm[BROW_EYE[1][1]])) / (2 * faceW);
      state.browBase.push(cur);
      if (state.browBase.length > 120) state.browBase.shift();
      const base = percentile(state.browBase, 80);
      const browDrop = Math.max(0, (base - cur) / base);   // 0..~0.3
      const o = openEar();
      const squint = o ? Math.min(1, Math.max(0, (o * 0.92 - e) / (o * 0.2))) : 0;
      state.tensionSum += Math.min(1, browDrop * 4 + squint * 0.8);
      state.tensionN++;
    }

    // --- Enrojecimiento ocular: proporción de rojo en esclerótica nasal ---
    if (warmed && res.image && state.frameN % 15 === 0) {
      if (rppgCv.width !== res.image.width) {
        rppgCv.width = res.image.width; rppgCv.height = res.image.height;
      }
      rppgCtx.drawImage(res.image, 0, 0);
      let red = 0, n = 0;
      for (const [pi, xo] of SCLERA) {
        const px = Math.min(res.image.width - 7, Math.max(0, lm[pi].x * res.image.width + xo * 6));
        const py = Math.min(res.image.height - 7, Math.max(0, lm[pi].y * res.image.height));
        const d = rppgCtx.getImageData(px, py, 6, 6).data;
        for (let i = 0; i < d.length; i += 4) { red += d[0] / (d[0] + d[1] + d[2] + 1e-9); n++; }
      }
      state.redSum += red / n; state.redN++;
    }

    // --- Estabilidad (temblor frame-a-frame de la nariz) ---
    const nose = { x: lm[NOSE_TIP].x, y: lm[NOSE_TIP].y };
    if (warmed && state.lastNose) {
      state.deltaTrail.push(dist(nose, state.lastNose));
      if (state.deltaTrail.length > 600) state.deltaTrail.shift();
    }
    state.lastNose = nose;

    // --- rPPG cada ~3 frames ---
    if (warmed && state.frameN % 3 === 0) sampleRppg(res, lm, now);
    state.frameN++;

    // ---------- overlay: análisis facial visible ----------
    const P = i => ({ x: lm[i].x * cv.width, y: lm[i].y * cv.height });
    const closed = e < th.close;

    // nube de landmarks — toda la cara escaneada
    ctx.fillStyle = "rgba(56, 189, 248, .30)";
    for (let k = 0; k < lm.length; k += 2) {
      ctx.fillRect(lm[k].x * cv.width - 0.7, lm[k].y * cv.height - 0.7, 1.4, 1.4);
    }

    // óvalo facial (contorno de la cara)
    const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
                  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
                  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = "#38bdf880";
    ctx.beginPath();
    OVAL.forEach((i, k) => k ? ctx.lineTo(P(i).x, P(i).y) : ctx.moveTo(P(i).x, P(i).y));
    ctx.closePath(); ctx.stroke();

    // ojos (EAR) — verde abiertos / ámbar parpadeando
    ctx.lineWidth = 2;
    ctx.strokeStyle = closed ? "#f59e0b" : "#22c55e";
    for (const eye of [L_EYE, R_EYE]) {
      ctx.beginPath();
      eye.forEach((i, k) => k ? ctx.lineTo(P(i).x, P(i).y) : ctx.moveTo(P(i).x, P(i).y));
      ctx.closePath(); ctx.stroke();
    }

    // iris — seguimiento de mirada
    if (lm[IRIS_L] && lm[IRIS_R]) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#f59e0b";
      ctx.fillStyle = "#f59e0b";
      for (const ir of [IRIS_L, IRIS_R]) {
        ctx.beginPath(); ctx.arc(P(ir).x, P(ir).y, 4, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.arc(P(ir).x, P(ir).y, 1.6, 0, 7); ctx.fill();
      }
    }

    // boca — verde cerrada / rojo si detecta bostezo (MAR)
    ctx.lineWidth = 2;
    ctx.strokeStyle = mar > MAR_YAWN ? "#ef4444" : "#84cc16";
    ctx.beginPath();
    ctx.moveTo(P(MOUTH_L).x, P(MOUTH_L).y);
    ctx.lineTo(P(LIP_UP).x, P(LIP_UP).y);
    ctx.lineTo(P(MOUTH_R).x, P(MOUTH_R).y);
    ctx.lineTo(P(LIP_LO).x, P(LIP_LO).y);
    ctx.closePath(); ctx.stroke();

    // cejas — tensión facial (ceño fruncido)
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "#c084fc";
    for (const brow of [[70, 63, 105, 66, 107], [336, 296, 334, 293, 300]]) {
      ctx.beginPath();
      brow.forEach((i, k) => k ? ctx.lineTo(P(i).x, P(i).y) : ctx.moveTo(P(i).x, P(i).y));
      ctx.stroke();
    }

    // nariz — referencia de estabilidad
    ctx.fillStyle = "#ef4444";
    ctx.beginPath(); ctx.arc(P(NOSE_TIP).x, P(NOSE_TIP).y, 3.5, 0, 7); ctx.fill();

    // recuadro HUD + esquinas + etiqueta
    const xs = lm.map(p => p.x * cv.width), ys = lm.map(p => p.y * cv.height);
    const bx = Math.min(...xs), by = Math.min(...ys);
    const bw = Math.max(...xs) - bx, bh = Math.max(...ys) - by;
    ctx.strokeStyle = "#38bdf855"; ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 2.5;
    const cl = 14; // largo de esquina
    for (const [cx, cy, dx, dy] of [[bx, by, 1, 1], [bx + bw, by, -1, 1],
                                    [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(cx + cl * dx, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + cl * dy);
      ctx.stroke();
    }
    ctx.font = "600 10px Consolas, monospace";
    ctx.fillStyle = "#22d3ee";
    ctx.fillText(closed ? "TRACKING · BLINK" : "TRACKING", bx, by - 6);

    // línea de análisis recorriendo el rostro + lecturas en vivo
    const sy2 = by + ((performance.now() % 2000) / 2000) * bh;
    const g2 = ctx.createLinearGradient(0, sy2 - 28, 0, sy2);
    g2.addColorStop(0, "rgba(34,211,238,0)");
    g2.addColorStop(1, "rgba(34,211,238,.18)");
    ctx.fillStyle = g2;
    ctx.fillRect(bx, sy2 - 28, bw, 28);
    ctx.strokeStyle = "rgba(34,211,238,.75)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bx, sy2); ctx.lineTo(bx + bw, sy2); ctx.stroke();
    ctx.fillStyle = "#22d3ee";
    ctx.fillText(`EAR ${e.toFixed(2)}  MAR ${mar.toFixed(2)}`, bx, by + bh + 12);

  }

  function headSway() {
    if (state.deltaTrail.length < 20) return 0;
    const mean = state.deltaTrail.reduce((a, b) => a + b, 0) / state.deltaTrail.length;
    return Math.min(1, mean / 0.015);
  }

  function asymIndex() {
    const raw = state.asymN ? state.asymSum / state.asymN : 0;
    return Math.min(1, Math.max(0, (raw - 0.10) * 4));
  }

  function earAsymIndex() {
    return state.earAsymN ? state.earAsymSum / state.earAsymN : 0;
  }

  function reset() {
    Object.assign(state, {
      sawFace: false, blinkCount: 0, closedFrames: 0, lastBlinkTs: 0,
      blinkDurTrail: [], perclosFrames: 0, totalFrames: 0,
      earBuf: [], earAsymSum: 0, earAsymN: 0, asymSum: 0, asymN: 0,
      lastNose: null, deltaTrail: [],
      marOpenSince: 0, yawnCount: 0, yawnCooldown: 0,
      rppg: [], rppgBpm: null, hrv: null,
      awayFrames: 0, browBase: [], tensionSum: 0, tensionN: 0,
      redSum: 0, redN: 0, frameN: 0, startTs: performance.now(),
    });
  }

  function metrics() {
    if (!state.sawFace) return null;
    const elapsed = (performance.now() - state.startTs - WARMUP_MS) / 1000;
    if (elapsed < 5) return null;
    const avgBlinkFrames = state.blinkDurTrail.length
      ? state.blinkDurTrail.reduce((a, b) => a + b, 0) / state.blinkDurTrail.length : 0;
    return {
      blink_rate: +(state.blinkCount / (elapsed / 60)).toFixed(1),
      blink_duration_ms: Math.round(avgBlinkFrames * 33), // ~30 fps
      perclos: +(state.totalFrames ? state.perclosFrames / state.totalFrames : 0).toFixed(3),
      yawn_count: state.yawnCount,
      facial_asymmetry: +asymIndex().toFixed(3),
      ear_asymmetry: +earAsymIndex().toFixed(3),
      head_sway: +headSway().toFixed(3),
      rppg_hr: state.rppgBpm,
      hrv_rmssd_ms: state.hrv,
      gaze_away_pct: +(state.totalFrames ? state.awayFrames / state.totalFrames : 0).toFixed(3),
      face_tension: +(state.tensionN ? state.tensionSum / state.tensionN : 0).toFixed(3),
      sclera_redness: +(state.redN ? Math.min(1, Math.max(0, (state.redSum / state.redN - 0.45) * 8)) : 0).toFixed(3),
      _source: "camera",
    };
  }

  let startPromise = null;

  async function start() {
    const video = document.getElementById("cam");
    const overlay = document.getElementById("overlay");
    const msg = document.getElementById("camMsg");

    if (!state.mediapipeOk) {
      msg.classList.remove("hidden");
      msg.textContent = L("Sensores no disponibles (offline) — se usarán valores simulados.",
                          "Sensors unavailable (offline) — simulated values will be used.");
      return false;
    }
    // init una sola vez (MediaPipe tarda ~9 s la primera vez);
    // llamadas posteriores solo reinician las métricas de la sesión
    if (!startPromise) {
      startPromise = (async () => {
        try {
          if (!faceMesh) {
            msg.classList.remove("hidden");
            msg.textContent = L("Encendiendo la cámara…", "Powering up camera…");
            faceMesh = new FaceMesh({
              locateFile: f => `assets/mp/${f}`,
            });
            faceMesh.setOptions({
              maxNumFaces: 1,
              refineLandmarks: true,
              minDetectionConfidence: 0.5,
              minTrackingConfidence: 0.5,
            });
            faceMesh.onResults(onResults);
          }
          if (!mpCamera) {
            mpCamera = new Camera(video, {
              onFrame: async () => { await faceMesh.send({ image: video }); },
              width: 640, height: 480,
            });
          }
          await mpCamera.start();
          overlay.width = video.videoWidth || 640;
          overlay.height = video.videoHeight || 480;
          msg.classList.add("hidden");
          return true;
        } catch (e) {
          msg.classList.remove("hidden");
          msg.textContent = L("Cámara no disponible — se usarán valores simulados.",
                              "Camera unavailable — simulated values will be used.");
          return false;
        }
      })();
    }
    const ok = await startPromise;
    if (ok) { reset(); state.active = true; }
    return ok;
  }

  function stop() {
    state.active = false;
    for (const id of ["blinkFlash", "yawnFlash"]) {
      const el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    }
    const msg = document.getElementById("camMsg");
    if (state.sawFace) {
      msg.classList.remove("hidden");
      msg.textContent = L("✓ Captura completada", "✓ Capture complete");
    }
    return metrics();
  }

  function simulate() {
    const jitter = (b, r) => +(b + (Math.random() - 0.5) * r).toFixed(3);
    const result = {
      blink_rate: jitter(9.5, 3),
      blink_duration_ms: Math.round(280 + Math.random() * 120),
      perclos: jitter(0.14, 0.08),
      yawn_count: 1 + Math.floor(Math.random() * 3),

      facial_asymmetry: jitter(0.06, 0.05),
      ear_asymmetry: jitter(0.08, 0.04),
      head_sway: jitter(0.32, 0.12),
      rppg_hr: Math.round(78 + Math.random() * 18),
      hrv_rmssd_ms: Math.round(22 + Math.random() * 30),
      gaze_away_pct: jitter(0.3, 0.2),
      face_tension: jitter(0.4, 0.2),
      sclera_redness: jitter(0.25, 0.15),
      _source: "simulated",
    };
    AppState.bio = result;
    return result;
  }

  return { start, stop, simulate };
})();
