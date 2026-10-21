// Движок презентации: масштаб 1920×1080, навигация, видео в рамках.
// ← → / пробел — листать · Home/End · число+Enter — перейти · F — полный экран · T — светлая/тёмная тема
(() => {
  const STAGES = ["идея", "стиль", "движок", "окружение", "ассеты", "механики", "срез", "контент", "полировка", "релиз"];
  const TITLE = "studioigor · не делай игру — настрой пайплайн";

  const deck = document.getElementById("deck");
  const slides = [...deck.querySelectorAll(":scope > .slide")];
  const total = slides.length;
  let cur = 0;

  // ---------- Сборка слайдов ----------
  slides.forEach((s, i) => {
    // data-stage: один этап, несколько через запятую или "all" — сквозной инструмент
    if (s.dataset.stage) {
      const all = s.dataset.stage === "all";
      const on = all ? [] : s.dataset.stage.split(",").map((x) => STAGES.indexOf(x.trim()));
      const first = Math.min(...on);
      const bar = document.createElement("div");
      bar.className = all ? "rail all" : "rail";
      bar.innerHTML = STAGES.map((st, k) =>
        `<span class="${on.includes(k) ? "on" : k < first ? "done" : ""}"><b>${String(k + 1).padStart(2, "0")}</b>${st}</span>`
      ).join("");
      s.prepend(bar);
    }
    if (!s.classList.contains("nofoot")) {
      const f = document.createElement("div");
      f.className = "foot";
      f.innerHTML = `<span><b>${TITLE}</b></span><span>${String(i + 1).padStart(2, "0")} / ${total}</span>`;
      s.append(f);
    }
  });

  // Рамка с медиа: data-gif — .gif или .mp4/.webm, до загрузки видна обложка data-poster
  document.querySelectorAll("figure.gif[data-gif]").forEach((fig) => {
    const ph = document.createElement("div");
    const poster = fig.dataset.poster;
    const src = fig.dataset.gif;
    const isVideo = /\.(mp4|webm|mov)$/i.test(src);
    ph.className = poster ? "ph poster" : "ph";
    if (poster) ph.style.backgroundImage = `url("${poster}")`;
    fig.prepend(ph);
    if (isVideo) {
      const v = document.createElement("video");
      Object.assign(v, { muted: true, loop: true, playsInline: true, preload: "auto" });
      v.setAttribute("muted", "");
      if (poster) v.poster = poster;
      if (fig.dataset.fit) v.style.objectFit = fig.dataset.fit;
      if (fig.dataset.pos) v.style.objectPosition = fig.dataset.pos;
      v.onloadeddata = () => { ph.remove(); fig.prepend(v); if (fig.closest(".slide.active")) v.play().catch(() => {}); };
      v.src = src;
    } else {
      const img = new Image();
      img.alt = "";
      img.onload = () => { ph.remove(); fig.prepend(img); };
      img.src = src;
    }
  });

  // ---------- Тема ----------
  let theme = storeGet("deck-theme") || "dark";
  function setTheme(t) {
    theme = t;
    document.documentElement.dataset.theme = t;
    storeSet("deck-theme", t);
    document.dispatchEvent(new CustomEvent("deck:theme", { detail: t }));
  }
  function storeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function storeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
  setTheme(theme);

  // ---------- Масштаб ----------
  function fit() {
    const k = Math.min(innerWidth / 1920, innerHeight / 1080);
    deck.style.transform = `translate(-50%, -50%) scale(${k})`;
  }

  // ---------- Навигация ----------
  function go(i) {
    const prev = cur;
    cur = Math.max(0, Math.min(total - 1, i));
    slides.forEach((s, k) => s.classList.toggle("active", k === cur));
    // анимации слайда начинаются заново при каждом входе; видео играют только на своём слайде
    if (prev !== cur || !slides[cur].classList.contains("play")) {
      slides.forEach((s) => s.classList.remove("play"));
      void slides[cur].offsetWidth;
      slides[cur].classList.add("play");
    }
    slides.forEach((s, k) => s.querySelectorAll("video").forEach((v) => {
      if (k === cur) { v.currentTime = 0; v.play().catch(() => {}); } else v.pause();
    }));
    document.dispatchEvent(new CustomEvent("deck:slide", { detail: { index: cur, slide: slides[cur] } }));
    history.replaceState(null, "", "#" + (cur + 1));
  }
  const fromHash = () => parseInt((location.hash || "#1").slice(1), 10) - 1 || 0;

  let buf = "", bufT;
  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest("textarea, input")) return;
    const k = e.key;
    if (/^\d$/.test(k)) {
      buf += k; clearTimeout(bufT); bufT = setTimeout(() => (buf = "", showJump()), 1500); showJump(); return;
    }
    if (k === "Enter" && buf) { go(parseInt(buf, 10) - 1); buf = ""; showJump(); return; }
    if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(k)) { e.preventDefault(); go(cur + 1); }
    else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(k)) { e.preventDefault(); go(cur - 1); }
    else if (k === "Home") go(0);
    else if (k === "End") go(total - 1);
    else if (k === "f" || k === "F" || k === "а" || k === "А") toggleFs();
    else if (k === "t" || k === "T" || k === "е" || k === "Е") setTheme(theme === "light" ? "dark" : "light");
  });
  function showJump() {
    const j = document.getElementById("jump");
    j.style.display = buf ? "block" : "none";
    j.textContent = buf;
  }
  function toggleFs() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  }
  deck.addEventListener("click", (e) => {
    const r = deck.getBoundingClientRect();
    go(e.clientX - r.left > r.width * 0.3 ? cur + 1 : cur - 1);
  });

  addEventListener("resize", fit);
  addEventListener("hashchange", () => go(fromHash()));
  fit();
  go(fromHash());
})();
