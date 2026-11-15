/* i18n — selector de idioma ES/EN persistente.
   Uso:
     · HTML estático:  <span data-i18n="clave">Texto ES</span>
     · JS dinámico:    L("texto ES", "English text")
     · Diccionario:    Lang.t("clave")
   La preferencia se guarda en localStorage y se envía al backend
   como `lang` en cada evaluación. */
"use strict";

const I18N = {
  es: {
    "h.reto": "RETO DE REACCIÓN",
    "sub.reto": "sesión diaria de 60 segundos",
    "lbl.signal": "SEÑAL",
    "lbl.points": "PUNTOS",
    "lbl.streak": "RACHA",
    "lbl.errors": "ERRORES",
    "lbl.time": "TIEMPO",
    "hint.rule": "Toca la carta igual a la <b>SEÑAL</b> — o <b>✕ NINGUNA</b> si no hay ninguna.",
    "game.ready": "Listo. Pulsa JUGAR.",
    "btn.play": "▸ JUGAR · 60 s",
    "cam.msg": "Activando sensores…",
    "cam.note": "Análisis 100 % local — nada se transmite fuera de la nave",
    "h.signals": "ANÁLISIS DE LA SESIÓN",
    "sig.done": "Sesión analizada.",
    "hr.label": "RITMO CARDÍACO — entrada manual o wearable:",
    "hr.unit": "lpm · basal 68",
    "h.verdict": "VEREDICTO",
    "sub.verdict": "triaje autónomo · RAG local sobre protocolos NASA",
    "btn.triage": "⬢ GENERAR VEREDICTO",
    "btn.speak": "🔊 ESCUCHAR VEREDICTO",
    "btn.breath": "◉ CALIBRACIÓN 4-7-8",
    "trend.label": "TU TENDENCIA (vs tu propia basal — así lo mide la NASA):",
    "h.findings": "QUÉ DETECTAMOS",
    "h.actions": "QUÉ HACER",
    "h.sources": "FUENTES RAG",
    "checkin.sub": "registro diario · privado",
    "breath.hint": "Respiración 4-7-8 · regulación autonómica <b>BHP-RES-4.7</b>",
    "breath.close": "CERRAR",
  },
  en: {
    "h.reto": "REACTION CHALLENGE",
    "sub.reto": "daily 60-second session",
    "lbl.signal": "SIGNAL",
    "lbl.points": "SCORE",
    "lbl.streak": "STREAK",
    "lbl.errors": "ERRORS",
    "lbl.time": "TIME",
    "hint.rule": "Tap the card matching the <b>SIGNAL</b> — or <b>✕ NONE</b> if there's no match.",
    "game.ready": "Ready. Press PLAY.",
    "btn.play": "▸ PLAY · 60 s",
    "cam.msg": "Activating sensors…",
    "cam.note": "100% local analysis — nothing leaves the ship",
    "h.signals": "SESSION ANALYSIS",
    "sig.done": "Session analyzed.",
    "hr.label": "HEART RATE — manual or wearable input:",
    "hr.unit": "bpm · baseline 68",
    "h.verdict": "VERDICT",
    "sub.verdict": "autonomous triage · local RAG over NASA protocols",
    "btn.triage": "⬢ GENERATE VERDICT",
    "btn.speak": "🔊 PLAY VERDICT",
    "btn.breath": "◉ 4-7-8 CALIBRATION",
    "trend.label": "YOUR TREND (vs your own baseline — the NASA standard):",
    "h.findings": "WHAT WE FOUND",
    "h.actions": "WHAT TO DO",
    "h.sources": "RAG SOURCES",
    "checkin.sub": "daily log · private",
    "breath.hint": "4-7-8 breathing · autonomic regulation <b>BHP-RES-4.7</b>",
    "breath.close": "CLOSE",
  },
};

const Lang = {
  KEY: "astro_lang",
  get() { return localStorage.getItem(this.KEY) || "es"; },
  set(l) {
    localStorage.setItem(this.KEY, l);
    Lang.apply();
    Lang.syncToggle();
    // Re-render del contenido dinámico (señales, veredicto, juego)
    window.dispatchEvent(new CustomEvent("langchange"));
  },
  t(k) {
    const l = this.get();
    return (I18N[l] && I18N[l][k]) ?? I18N.es[k] ?? k;
  },
  apply() {
    document.querySelectorAll("[data-i18n]").forEach(el => {
      el.innerHTML = Lang.t(el.dataset.i18n);
    });
    document.documentElement.lang = this.get();
  },
  syncToggle() {
    document.querySelectorAll(".lang-btn").forEach(b =>
      b.classList.toggle("on", b.dataset.lang === this.get()));
  },
};

// L(es, en): elige la cadena según el idioma activo — para strings dinámicos
const L = (es, en) => Lang.get() === "en" ? en : es;

window.addEventListener("DOMContentLoaded", () => {
  Lang.apply();
  Lang.syncToggle();
});
