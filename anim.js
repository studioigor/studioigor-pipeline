// Процедурные сцены слайдов — как в ref2game: картинку рисует нейронка, движение и эффекты — код.
// <canvas data-anim="имя" data-variant="…"> оживает, только пока его слайд на экране; кадр — функция времени t.
// Сцены — тёмные «экраны» в обеих темах, как блоки кода, поэтому палитра своя, а не из темы.
(() => {
  const SCENES = {};
  const S = 1.5; // запас разрешения: дека масштабируется под окно
  const C = {
    bg: "#14110e", bg2: "#1d1915", bg3: "#26211b", line: "#3b332a", line2: "#554a3d",
    ink: "#f3ead7", ink2: "#c8bba3", mute: "#8c7f6c", amber: "#f0a63a", sage: "#9db59a",
    red: "#e0705a", code: "#0e0c0a", codeInk: "#efe5cf",
  };

  // ---------- общие помощники ----------
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = (k) => (k = clamp(k), k * k * (3 - 2 * k));
  const easeOut = (k) => 1 - Math.pow(1 - clamp(k), 3);
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  function rng(seed) { // детерминированный генератор: один и тот же кадр при одном и том же t
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }
  function rgba(hex, a) {
    if (!hex || hex[0] !== "#") return hex;
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }
  function ik(hx, hy, fx, fy, l1, l2, bendDir) { // двухзвенная нога/рука: где колено
    const dx = fx - hx, dy = fy - hy;
    const d = Math.min(Math.hypot(dx, dy), l1 + l2 - 0.01);
    const a = Math.atan2(dy, dx);
    const b = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
    const ang = a - b * bendDir;
    return [hx + Math.cos(ang) * l1, hy + Math.sin(ang) * l1];
  }
  function line(ctx, pts, w, col) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineWidth = w; ctx.strokeStyle = col; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke();
  }
  function text(ctx, s, x, y, font, col, align = "left", base = "alphabetic") {
    ctx.font = font; ctx.fillStyle = col; ctx.textAlign = align; ctx.textBaseline = base; ctx.fillText(s, x, y);
  }
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  }
  const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
  const SANS = 'Onest, "Helvetica Neue", Arial, sans-serif';
  const img = (src) => { const i = new Image(); i.src = src; return i; };

  // =====================================================================================
  // ТЕСТОВАЯ СЦЕНА «ФОНАРИК» (Creepy Farm): без чисел (A) и по спеке (B), панель тюнинга.
  // Спрайты и текстуры — настоящие ассеты игры, сцена, порча и движение — код. Время ускорено ×4.
  // =====================================================================================
  SCENES.farm = (cv, ctx, W, H) => {
    const I = {};
    ["ground_tex", "corrupt_tex", "cobble_tex", "soil_tex", "house", "hero_side", "creeper_full", "crop_pumpkin", "mut_pumpkin",
      "crop_corn", "mut_corn", "dog_sit", "rift", "tuft_0", "bush_o"].forEach((n) => (I[n] = img("assets/creepyfarm/sprites/" + n + ".png")));
    const ok = (i) => i.complete && i.naturalWidth;
    const f = W / 1000, T = W / 16, g = T / 64;          // клетка = 64 px игры; g — игровой пиксель в пикселях канваса
    const X = 4, AMB = "#f0a63a", RED = "#e0705a", INK = "#2d1315";
    const SPEC = { clean: 1.5, batt: 30, spread: 4.0, range: 340, charge: 6, cone: 0.36 };
    const A = { name: "A · «сделай фонарик»", clean: 0, batt: Infinity, charge: 0, loop: 6 };
    const B = { name: "B · по спеке", clean: SPEC.clean, batt: SPEC.batt, charge: SPEC.charge, loop: 11.6 };
    const RANGE = SPEC.range / 64;                         // дальность луча в клетках
    const cols = Math.ceil(W / T) + 1, rows = Math.ceil(H / T) + 1;
    const key = (c, r) => r * 64 + c, cOf = (k) => k % 64, rOf = (k) => Math.floor(k / 64);
    const RIFT = [12.6, 4.75], PORCH = [2.2, 4.3], STAND = [4.9, 4.75];
    const FIELD = [];
    for (let c = 6; c <= 8; c++) for (let r = 2; r <= 5; r++) FIELD.push({ c, r, corn: r % 2 === 1 });
    const fieldAt = new Map(FIELD.map((q) => [key(q.c, q.r), q]));
    // B: луч горит, пока есть заряд; потом бегом на крыльцо, заряд, обратно
    const tOn = 0.3, tEmpty = tOn + SPEC.batt / X, tPorch = tEmpty + 1.1, tFull = tPorch + SPEC.batt / (SPEC.charge * X), tBack = tFull + 1.0;

    function hero(P, s) {
      if (P === A) return { x: STAND[0], y: STAND[1], dir: 1, walk: 0, beam: s >= 0.4 };
      const mv = (a, b, k) => [lerp(a[0], b[0], ease(k)), lerp(a[1], b[1], ease(k))];
      if (s < tEmpty) return { x: STAND[0], y: STAND[1], dir: 1, walk: 0, beam: s >= tOn };
      if (s < tPorch) { const p = mv(STAND, PORCH, seg(s, tEmpty, tPorch)); return { x: p[0], y: p[1], dir: -1, walk: 2, beam: false }; }
      if (s < tFull) return { x: PORCH[0], y: PORCH[1], dir: 1, walk: 0, beam: false, charging: true };
      const p = mv(PORCH, STAND, seg(s, tFull, tBack)); return { x: p[0], y: p[1], dir: 1, walk: s < tBack ? 1 : 0, beam: false };
    }
    const hand = (h) => [h.x + h.dir * 0.32, h.y - 0.95];
    const batt = (P, s) => P === A ? Infinity : s < tOn ? SPEC.batt : s < tEmpty ? SPEC.batt - (s - tOn) * X : s < tPorch ? 0 : Math.min(SPEC.batt, (s - tPorch) * SPEC.charge * X);

    // порча и уборка — детерминированная мини-симуляция с начала петли: кадр зависит только от t
    function sim(P, u) {
      const R = rng(P === A ? 5 : 11), cor = new Map(), mut = new Map(), ev = [];
      for (let c = 10; c < cols; c++) for (let r = 0; r < rows; r++)
        if (Math.hypot(c + 0.5 - RIFT[0], (r + 0.5 - RIFT[1]) * 1.15) < 2.3 + R() * 0.6) cor.set(key(c, r), -9);
      let acc = 0, prog = 0, target = -1, cool = 0, aim = 0, cr = null;
      const dt = 1 / 30;
      for (let s = 0; s <= u; s += dt) {
        const h = hero(P, s), [hx, hy] = hand(h);
        acc += dt * X;
        if (acc >= SPEC.spread) {                          // порча захватывает соседний тайл, тянется к урожаю
          acc -= SPEC.spread;
          let best = -1, bs = 1e9;
          for (const k of cor.keys()) for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const c = cOf(k) + dc, r = rOf(k) + dr, kk = key(c, r);
            if (c < 6 || c >= cols || r < 0 || r >= rows - 1 || cor.has(kk)) continue;
            const sc = c + Math.abs(r + 0.5 - 3.8) * 0.35 + R() * 1.4;
            if (sc < bs) { bs = sc; best = kk; }
          }
          if (best >= 0) {
            cor.set(best, s);
            if (fieldAt.has(best) && !mut.has(best)) { mut.set(best, s); ev.push([s, "mut"]); }
          }
        }
        if (h.beam) {                                      // луч: ближайший тайл порчи в пределах дальности
          let bk = -1, bd = 1e9;
          for (const k of cor.keys()) {
            const d = Math.hypot(cOf(k) + 0.5 - hx, rOf(k) + 0.5 - hy);
            if (d <= RANGE && d < bd) { bd = d; bk = k; }
          }
          if (bk !== target) { target = bk; prog = 0; }
          if (target >= 0) {
            const want = Math.atan2(rOf(target) + 0.5 - hy, cOf(target) + 0.5 - hx);
            aim += (want - aim) * Math.min(1, dt * 9);
            if (P.clean) { prog += dt * X / P.clean; if (prog >= 1) { cor.delete(target); ev.push([s, "clean", target]); target = -1; prog = 0; } }
            else if ((cool -= dt) <= 0) { cor.delete(target); ev.push([s, "clean", target]); target = -1; cool = 0.08; }
          }
        } else { target = -1; prog = 0; }
        // ползун: вылез из разлома, ползёт к урожаю, от луча убегает обратно
        if (P === B && !cr && s >= 2.6) cr = { x: RIFT[0] - 0.7, y: RIFT[1] + 0.5, st: "crawl", t: s };
        if (cr && cr.st !== "gone") {
          const sp = cr.st === "crawl" ? 1.1 : 3.2;
          const tx = cr.st === "crawl" ? 7.6 : RIFT[0], ty = cr.st === "crawl" ? 4.2 : RIFT[1] + 0.5;
          const d = Math.hypot(tx - cr.x, ty - cr.y);
          if (d > 0.05) { cr.x += (tx - cr.x) / d * sp * dt; cr.y += (ty - cr.y) / d * sp * dt; cr.dir = Math.sign(tx - cr.x) || cr.dir; }
          if (cr.st === "crawl" && h.beam) {
            const vx = cr.x - hx, vy = cr.y - 0.3 - hy, dd = Math.hypot(vx, vy);
            let da = Math.abs(Math.atan2(vy, vx) - aim); if (da > Math.PI) da = 2 * Math.PI - da;
            if (dd < RANGE + 0.5 && da < SPEC.cone + 0.15) { cr.st = "flee"; cr.t = s; ev.push([s, "flee"]); }
          }
          if (cr.st === "flee" && d < 0.4) { cr.st = "gone"; cr.t = s; }
        }
      }
      return { cor, mut, ev, target, prog, aim, cr };
    }

    const pats = {};
    function pat(n, gameSize) {
      if (pats[n] || !ok(I[n])) return pats[n];
      const p = ctx.createPattern(I[n], "repeat"), k = gameSize * g / I[n].naturalWidth;
      p.setTransform(new DOMMatrix().scale(k));
      return (pats[n] = p);
    }
    function spr(n, x, y, gw, flip, alpha) { // x, y — центр низа спрайта, в пикселях канваса
      const im = I[n]; if (!ok(im)) return;
      const w = gw * g, h = w * im.naturalHeight / im.naturalWidth;
      ctx.save(); if (alpha !== undefined) ctx.globalAlpha = alpha;
      ctx.translate(x, y); if (flip) ctx.scale(-1, 1);
      ctx.drawImage(im, -w / 2, -h, w, h); ctx.restore();
    }
    function chip(s, x, y, col, bg) {
      ctx.font = `700 ${12 * f}px ${MONO}`; const w = ctx.measureText(s).width + 16 * f;
      rrect(ctx, x - w / 2, y - 15 * f, w, 22 * f, 6); ctx.fillStyle = bg || "rgba(14,12,10,.85)"; ctx.fill();
      text(ctx, s, x, y, `700 ${12 * f}px ${MONO}`, col, "center");
    }

    return {
      draw(t) {
        const per = A.loop + B.loop, q = t % per, P = q < A.loop ? A : B, s = P === A ? q : q - A.loop;
        const st = sim(P, s), h = hero(P, s), [hx, hy] = hand(h);
        const px = (c) => c * T, py = (r) => r * T;

        // ---------- мир: земля, дорожка, дом, грядки ----------
        ctx.fillStyle = pat("ground_tex", 547) || "#7a4a26"; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = pat("cobble_tex", 272) || "#6b5a4a"; ctx.fillRect(px(1.6), py(3.1), T * 1.3, H);
        ctx.fillRect(px(1.6), py(4.4), px(3.9), T * 0.8);
        spr("house", px(2.3), py(3.25), 590 * 0.62);
        ctx.fillStyle = pat("soil_tex", 262) || "#4a2a1a"; ctx.fillRect(px(6), py(2), T * 3, T * 4);
        ctx.strokeStyle = INK; ctx.lineWidth = 2.5 * g; ctx.strokeRect(px(6), py(2), T * 3, T * 4);
        [[0.5, 6.5], [4.4, 6.5], [9.4, 6.6], [5.4, 1.6], [0.5, 4.9]].forEach(([c, r], i) => spr(i % 2 ? "bush_o" : "tuft_0", px(c), py(r), i % 2 ? 55 : 51));
        // порча: тайлы с текстурой игры, новые растут из центра
        const cp = pat("corrupt_tex", 300) || "#2a1420";
        for (const [k, t0] of st.cor) {
          const a = t0 < 0 ? 1 : easeOut((s - t0) / 0.35), c = cOf(k), r = rOf(k), m = T * (1 - a) / 2;
          ctx.fillStyle = cp; ctx.fillRect(px(c) + m, py(r) + m, T - 2 * m, T - 2 * m);
          ctx.strokeStyle = rgba(INK, 0.9); ctx.lineWidth = 1.5 * g; ctx.strokeRect(px(c) + m, py(r) + m, T - 2 * m, T - 2 * m);
        }
        // урожай: мутирует, если порча дошла до грядки
        for (const fq of FIELD) {
          const k = key(fq.c, fq.r), mt = st.mut.get(k), m = mt !== undefined;
          spr(m ? (fq.corn ? "mut_corn" : "mut_pumpkin") : (fq.corn ? "crop_corn" : "crop_pumpkin"),
            px(fq.c + 0.5), py(fq.r + 0.92), m ? (fq.corn ? 51 : 57) : (fq.corn ? 49 : 53));
        }
        spr("rift", px(RIFT[0]), py(RIFT[1] + 1.95), 98);

        // ---------- ночь и свет ----------
        ctx.fillStyle = "rgba(14,8,26,.46)"; ctx.fillRect(0, 0, W, H);
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        const glow = (x, y, r, col, a) => {
          const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
          gr.addColorStop(0, rgba(col, a)); gr.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = gr; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
        };
        glow(px(PORCH[0]), py(PORCH[1] - 0.6), T * 1.9, "#ffb860", 0.32);
        glow(px(RIFT[0]), py(RIFT[1] + 0.4), T * 2.4, "#ff3048", 0.24 + 0.06 * Math.sin(t * 3.1));
        for (const [k] of st.cor) { ctx.fillStyle = `rgba(150,24,70,${0.13 + 0.05 * Math.sin(t * 2.3 + k)})`; ctx.fillRect(px(cOf(k)), py(rOf(k)), T, T); }
        if (h.beam) {
          const x0 = px(hx), y0 = py(hy), L = RANGE * T, a = st.aim;
          const gr = ctx.createRadialGradient(x0, y0, 4, x0, y0, L);
          gr.addColorStop(0, "rgba(255,226,160,.62)"); gr.addColorStop(0.7, "rgba(255,206,120,.28)"); gr.addColorStop(1, "rgba(255,200,110,0)");
          ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.arc(x0, y0, L, a - SPEC.cone, a + SPEC.cone); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
        // вспышка очищенного тайла
        for (const [et, k, tk] of st.ev) if (k === "clean" && s - et < 0.3) {
          ctx.fillStyle = rgba("#ffd890", 0.55 * (1 - (s - et) / 0.3)); ctx.fillRect(px(cOf(tk)), py(rOf(tk)), T, T);
        }

        // ---------- персонажи ----------
        ctx.save(); ctx.filter = "brightness(0.9)";
        const crOn = st.cr && st.cr.st !== "gone";
        spr("dog_sit", px(PORCH[0] + 1.35), py(PORCH[1] + 0.45), 87 * 0.85);
        if (crOn) {
          const k = st.cr.st === "flee" ? 1 : 0, wob = Math.sin(t * 18) * 0.04;
          ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.filter = "none";
          const gx = px(st.cr.x), gy = py(st.cr.y) - 0.35 * T, gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, T);
          gr.addColorStop(0, "rgba(255,90,90,.35)"); gr.addColorStop(1, "rgba(255,90,90,0)"); ctx.fillStyle = gr; ctx.fillRect(gx - T, gy - T, 2 * T, 2 * T);
          ctx.restore();
          ctx.save(); ctx.filter = "brightness(1.35)"; ctx.translate(px(st.cr.x), py(st.cr.y)); ctx.rotate(wob);
          spr("creeper_full", 0, 0, 142 * 0.62, st.cr.dir < 0); ctx.restore();
          if (k) text(ctx, "бежит от луча", px(st.cr.x), py(st.cr.y) - 1.25 * T, `700 ${13 * f}px ${MONO}`, AMB, "center");
        }
        const bob = h.walk ? -Math.abs(Math.sin(s * (h.walk > 1 ? 15 : 10))) * 4 * g : Math.sin(t * 2.2) * 0.6 * g;
        spr("hero_side", px(h.x), py(h.y) + bob, 59, h.dir < 0);
        ctx.restore();
        if (crOn && st.cr.st === "crawl") chip("!", px(PORCH[0] + 1.4), py(PORCH[1] - 1.05), RED);

        // ---------- подписи прямо в сцене ----------
        ctx.save(); ctx.setLineDash([6 * f, 6 * f]); ctx.strokeStyle = rgba("#f3ead7", 0.55); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(px(PORCH[0]), py(PORCH[1]), T * 1.05, T * 0.55, 0, 0, 7); ctx.stroke();
        if (h.beam) {
          const x0 = px(hx), y0 = py(hy), L = RANGE * T;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + Math.cos(st.aim) * L, y0 + Math.sin(st.aim) * L); ctx.stroke();
        }
        ctx.restore();
        text(ctx, P === B ? "крыльцо · заряд +6/с" : "крыльцо", px(PORCH[0]), py(PORCH[1] + 0.95), `700 ${12 * f}px ${MONO}`, "#f3ead7", "center");
        if (h.beam) {                                       // подпись дальности — на середине луча, под линией
          const L = RANGE * T * 0.5, nx = -Math.sin(st.aim), ny = Math.cos(st.aim);
          chip("луч 340 px", px(hx) + Math.cos(st.aim) * L + nx * 16 * f, py(hy) + Math.sin(st.aim) * L + ny * 16 * f + 4 * f, "#f3ead7");
        }
        if (st.target >= 0 && P.clean) {                  // кольцо прогресса очистки
          const cx = px(cOf(st.target) + 0.5), cy = py(rOf(st.target) + 0.5);
          ctx.strokeStyle = "rgba(14,12,10,.7)"; ctx.lineWidth = 6 * f; ctx.beginPath(); ctx.arc(cx, cy, T * 0.36, 0, 7); ctx.stroke();
          ctx.strokeStyle = AMB; ctx.lineWidth = 4 * f; ctx.beginPath(); ctx.arc(cx, cy, T * 0.36, -Math.PI / 2, -Math.PI / 2 + st.prog * 2 * Math.PI); ctx.stroke();
          text(ctx, "1,5 с", cx, cy + 5 * f, `800 ${13 * f}px ${MONO}`, "#fff4d8", "center");
        }
        const lastMut = [...st.mut.entries()].filter(([, v]) => s - v < 1.6).pop();   // одна подпись — у последнего мутанта
        if (lastMut) chip("мутант!", px(cOf(lastMut[0]) + 0.5), py(rOf(lastMut[0])) - 4 * f, "#fff", rgba(RED, 0.92));
        // заряд над головой героя
        const bv = batt(P, s), bx = px(h.x) - 0.45 * T, by = py(h.y) - 2.15 * T + bob;
        rrect(ctx, bx - 2, by - 2, 0.9 * T + 4, 9 * f + 4, 4); ctx.fillStyle = "rgba(14,12,10,.85)"; ctx.fill();
        ctx.fillStyle = bv === Infinity ? "#8c7f6c" : bv < 6 ? RED : AMB;
        ctx.fillRect(bx, by, 0.9 * T * (bv === Infinity ? 1 : clamp(bv / SPEC.batt)), 9 * f);
        text(ctx, bv === Infinity ? "∞" : `${Math.ceil(bv)} с`, bx + 0.9 * T + 8 * f, by + 9 * f, `700 ${13 * f}px ${MONO}`, bv === Infinity ? "#c8bba3" : bv < 6 ? RED : AMB);
        if (h.charging) chip("заряжается", bx + 0.9 * T + 92 * f, by + 9 * f, AMB);

        // ---------- интерфейс тестовой сцены ----------
        const pad = 18;
        rrect(ctx, pad, pad, 300 * f, 64 * f, 10); ctx.fillStyle = "rgba(14,12,10,.86)"; ctx.fill();
        text(ctx, "GYM · M01 ФОНАРИК", pad + 16 * f, pad + 26 * f, `700 ${14 * f}px ${MONO}`, "#c8bba3");
        text(ctx, P.name, pad + 16 * f, pad + 52 * f, `800 ${21 * f}px ${SANS}`, P === B ? AMB : "#f3ead7");
        const pw = 290 * f, pxl = W - pw - pad, pyt = pad;
        const rws = [
          ["очистка лучом", P.clean, 3, (v) => v.toFixed(1).replace(".", ",") + " с"],
          ["батарейка", P.batt === Infinity ? 60 : P.batt, 60, (v) => P.batt === Infinity ? "∞" : Math.round(v) + " с"],
          ["заряд на крыльце", P.charge, 12, (v) => P.charge ? "+" + Math.round(v) + "/с" : "—"],
          ["порча: тайл раз в", SPEC.spread, 8, (v) => v.toFixed(1).replace(".", ",") + " с"],
        ];
        rrect(ctx, pxl, pyt, pw, (34 + rws.length * 37) * f, 10); ctx.fillStyle = "rgba(14,12,10,.88)"; ctx.fill();
        text(ctx, "TAB · ПАНЕЛЬ ТЮНИНГА", pxl + 16 * f, pyt + 25 * f, `700 ${13 * f}px ${MONO}`, "#8c7f6c");
        const mix = ease(seg(s, 0, 0.5));
        rws.forEach(([name, val, max, fmt], i) => {
          const y = pyt + (50 + i * 37) * f, v = lerp(i === 0 ? (P === B ? 0 : SPEC.clean) : val, val, mix);
          const hot = P === B ? AMB : i < 3 ? RED : "#c8bba3";
          text(ctx, name, pxl + 16 * f, y, `500 ${15 * f}px ${SANS}`, "#f3ead7");
          text(ctx, fmt(v), pxl + pw - 16 * f, y, `700 ${15 * f}px ${MONO}`, hot, "right");
          const sx = pxl + 16 * f, sw = pw - 32 * f, sy = y + 11 * f;
          ctx.fillStyle = "#3b332a"; ctx.fillRect(sx, sy, sw, 4 * f);
          ctx.fillStyle = hot; ctx.fillRect(sx, sy, sw * clamp(v / max), 4 * f);
          ctx.beginPath(); ctx.arc(sx + sw * clamp(v / max), sy + 2 * f, 6 * f, 0, 7); ctx.fill();
        });
        // таймлайн петли
        const tx = pad, tw = W - 2 * pad, ty = H - 34 * f;
        rrect(ctx, tx, ty - 22 * f, tw, 46 * f, 10); ctx.fillStyle = "rgba(14,12,10,.86)"; ctx.fill();
        const XT = (x) => tx + 120 * f + (tw - 140 * f) * x / P.loop;
        text(ctx, "события", tx + 14 * f, ty + 5 * f, `700 ${13 * f}px ${MONO}`, "#8c7f6c");
        ctx.fillStyle = "#3b332a"; ctx.fillRect(XT(0), ty - 2 * f, XT(P.loop) - XT(0), 4 * f);
        for (const [et, k] of st.ev) {
          ctx.fillStyle = k === "mut" ? RED : k === "flee" ? "#9db59a" : AMB;
          ctx.fillRect(XT(et) - 1, ty - (k === "mut" ? 9 : 6) * f, k === "mut" ? 4 : 2, (k === "mut" ? 18 : 12) * f);
        }
        if (P === B) {
          [[tOn, "луч"], [tEmpty, "заряд 0"], [tPorch, "крыльцо"], [tFull, "полный"]].forEach(([m, l]) => {
            ctx.fillStyle = "#c8bba3"; ctx.fillRect(XT(m) - 1, ty - 8 * f, 2, 16 * f);
            text(ctx, l, XT(m), ty - 11 * f, `500 ${12 * f}px ${MONO}`, "#c8bba3", "center");
          });
          text(ctx, "пока заряжаешься — порча идёт к урожаю", tx + tw - 14 * f, ty + 17 * f, `700 ${12 * f}px ${MONO}`, AMB, "right");
        } else text(ctx, "чистит мгновенно, заряд бесконечный — решать нечего", XT(0.4) + 8 * f, ty + 17 * f, `500 ${12 * f}px ${MONO}`, RED);
        ctx.fillStyle = "#f3ead7"; ctx.fillRect(XT(s) - 1.5, ty - 14 * f, 3, 28 * f);
        // клавиши, общие для всех тестовых сцен
        const keys = ["R рестарт", "1/2 A/B", "время ×4", "P сохранить"];
        let kx = pad;
        keys.forEach((k, i) => {
          ctx.font = `600 ${12 * f}px ${MONO}`; const w = ctx.measureText(k).width + 18 * f;
          rrect(ctx, kx, pad + 74 * f, w, 24 * f, 6); ctx.fillStyle = "rgba(14,12,10,.8)"; ctx.fill();
          text(ctx, k, kx + 9 * f, pad + 90 * f, `600 ${12 * f}px ${MONO}`, i === 2 ? AMB : "#c8bba3");
          kx += w + 6 * f;
        });
      },
    };
  };

  // =====================================================================================
  // ЛАБОРАТОРИЯ ПОХОДКИ: «семенит» найдено замером шага и частоты, а не на глаз
  // =====================================================================================
  SCENES.walk = (cv, ctx, W, H) => {
    const lanes = [
      { label: "до · клип на 0,7 м/с, ускорен ×2,4", step: 0.36, slip: 0.07, bad: true },
      { label: "после · клип под 1,7 м/с", step: 0.85, slip: 0.004, bad: false },
    ];
    const V = 1.7; // м/с, одинаковая скорость персонажа в обеих дорожках
    return {
      draw(t) {
        ctx.fillStyle = C.code; ctx.fillRect(0, 0, W, H);
        const lh = H / 2;
        lanes.forEach((ln, li) => {
          const y0 = li * lh, M = lh / 3.3, floor = y0 + lh * 0.82, cx = W * 0.62;
          // циклорама
          const g = ctx.createLinearGradient(0, y0, 0, floor);
          g.addColorStop(0, "#1a1714"); g.addColorStop(1, "#2a251f");
          ctx.fillStyle = g; ctx.fillRect(0, y0, W, lh);
          ctx.fillStyle = "#332d26"; ctx.fillRect(0, floor, W, y0 + lh - floor);
          if (li) line(ctx, [[0, y0], [W, y0]], 2, C.line);
          // пол уезжает со скоростью V
          const scroll = V * t * M;
          for (let x = -((scroll) % (0.5 * M)); x < W; x += 0.5 * M) line(ctx, [[x, floor + 3], [x, floor + 9]], 2, "#4a4136");
          const freq = V / ln.step;              // шагов в секунду
          const cyc = 2 / freq;                  // полный цикл = 2 шага
          const stance = 0.6;
          const Lh = V * stance * cyc * M / 2;   // половина хода стопы в опоре
          const plantAt = (n, off) => cx + Lh + V * (n - off) * cyc * M - scroll; // где стопа встала, на экране
          const legs = [0, 0.5].map((off) => {
            const q = t / cyc + off, n = Math.floor(q), ph = q - n;
            let fx, fy, plantX = null, slipPx = 0;
            if (ph < stance) {
              // в опоре стопа обязана стоять на полу; у «до» она уезжает на slip за шаг — это и меряем
              const k = ph / stance;
              plantX = plantAt(n, off); slipPx = ln.slip * M * k;
              fx = plantX + slipPx; fy = floor;
            } else {
              const k = (ph - stance) / (1 - stance);
              fx = lerp(cx - Lh + ln.slip * M, cx + Lh, ease(k)); fy = floor - Math.sin(Math.PI * k) * (0.06 + ln.step * 0.14) * M;
            }
            return { fx, fy, ph, n, off, plantX, slipPx };
          });
          const bob = Math.abs(Math.sin(t / cyc * Math.PI * 2)) * 0.03 * M;
          const hip = [cx, floor - 0.92 * M + bob];
          const neck = [cx + 0.06 * M, hip[1] - 0.62 * M];
          // следы касаний остаются на полу и уезжают вместе с ним
          legs.forEach((lg) => {
            for (let j = 0; j < 4; j++) {
              const x = plantAt(lg.n - j, lg.off);
              if (x < -20) continue;
              ctx.fillStyle = ln.bad ? rgba(C.red, 0.8 - j * 0.15) : rgba(C.sage, 0.8 - j * 0.15);
              ctx.fillRect(x - 0.06 * M, floor + 12, 0.12 * M, 5);
            }
            if (ln.bad && lg.plantX !== null && lg.slipPx > 4) {
              line(ctx, [[lg.plantX, floor + 24], [lg.fx, floor + 24]], 2, C.red);
              text(ctx, `${Math.round(lg.slipPx / M * 100)} см`, lg.fx + 8, floor + 30, `700 ${0.13 * M}px ${MONO}`, C.red);
            }
          });
          // манекен: ноги через IK, руки в противофазе
          const ord = legs[0].ph < legs[1].ph ? [1, 0] : [0, 1];
          const body = "#d9cfbd", dark = "#9c9384";
          ord.forEach((i) => {
            const lg = legs[i];
            const kn = ik(hip[0], hip[1], lg.fx, lg.fy - 0.06 * M, 0.47 * M, 0.47 * M, 1);
            const col = i ? dark : body;
            line(ctx, [hip, kn, [lg.fx, lg.fy - 0.06 * M]], 0.13 * M, col);
            line(ctx, [[lg.fx - 0.04 * M, lg.fy - 0.02 * M], [lg.fx + 0.14 * M, lg.fy - 0.02 * M]], 0.08 * M, col);
            ctx.fillStyle = "#1a1714"; ctx.beginPath(); ctx.arc(kn[0], kn[1], 0.035 * M, 0, 7); ctx.fill();
          });
          line(ctx, [hip, neck], 0.24 * M, body);
          ctx.fillStyle = body; ctx.beginPath(); ctx.arc(neck[0] + 0.03 * M, neck[1] - 0.16 * M, 0.12 * M, 0, 7); ctx.fill();
          [0, 1].forEach((i) => {
            const sw = Math.sin(t / cyc * Math.PI * 2 + (i ? 0 : Math.PI)) * (0.12 + ln.step * 0.3);
            const el = [neck[0] + Math.sin(sw) * 0.3 * M, neck[1] + 0.3 * M];
            const hd = [el[0] + Math.sin(sw + 0.4) * 0.27 * M, el[1] + 0.25 * M];
            line(ctx, [[neck[0], neck[1] + 0.04 * M], el, hd], 0.09 * M, i ? dark : body);
          });
          // подписи и замеры
          text(ctx, ln.label, 18, y0 + 30, `600 ${15}px ${MONO}`, C.ink2);
          const col = ln.bad ? C.red : C.sage;
          text(ctx, `шаг ${ln.step.toFixed(2).replace(".", ",")} м · ${(freq).toFixed(1).replace(".", ",")} шага/с`, 18, y0 + 56, `800 ${20}px ${SANS}`, col);
          text(ctx, ln.bad ? "СЕМЕНИТ" : "НОРМА ≈ 2 шага/с", W - 18, y0 + 30, `800 ${15}px ${MONO}`, col, "right");
        });
      },
    };
  };

  // =====================================================================================
  // ЛИПСИНК: звук → фонемы → виземы (формы рта), губы на 55 мс раньше звука
  // =====================================================================================
  SCENES.visemes = (cv, ctx, W, H) => {
    // виземы: open, wide, round (0..1); подпись
    const VIS = {
      sil: [0.04, 0.55, 0, "тишина"], PP: [0, 0.5, 0.1, "П Б М"], FF: [0.14, 0.62, 0, "Ф В"], DD: [0.3, 0.62, 0, "Т Д"],
      kk: [0.36, 0.56, 0, "К Г Х"], CH: [0.3, 0.42, 0.6, "Ч Ш Ж"], SS: [0.16, 0.8, 0, "С З Ц"], nn: [0.24, 0.62, 0, "Н Л"],
      RR: [0.3, 0.48, 0.4, "Р"], aa: [0.95, 0.66, 0, "А"], E: [0.55, 0.86, 0, "Э Е"], I: [0.3, 1, 0, "И Ы"],
      O: [0.72, 0.42, 0.9, "О"], U: [0.36, 0.3, 1, "У Ю"], TH: [0.2, 0.72, 0, "Й"],
    };
    const ORDER = ["sil", "PP", "FF", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "I", "O", "U", "TH"];
    // «Арго, приём. Как слышно?» — фонемы с длительностями
    const PH = [["sil", 0.25], ["aa", 0.16], ["RR", 0.07], ["kk", 0.07], ["O", 0.18], ["sil", 0.12], ["PP", 0.07], ["RR", 0.06], ["I", 0.08], ["TH", 0.05],
      ["O", 0.16], ["PP", 0.12], ["sil", 0.3], ["kk", 0.07], ["aa", 0.15], ["kk", 0.07], ["SS", 0.09], ["nn", 0.06], ["I", 0.12], ["CH", 0.08], ["nn", 0.06], ["O", 0.2], ["sil", 0.35]];
    let acc = 0;
    const seq = PH.map(([v, d]) => { const o = { v, a: acc, b: acc + d }; acc += d; return o; });
    const LOOP = acc + 0.2, LEAD = 0.055;
    const at = (x) => seq.find((p) => x >= p.a && x < p.b) || seq[seq.length - 1];
    const amp = (x) => { // огибающая «звука»
      const p = at(x), k = (x - p.a) / (p.b - p.a);
      const base = { sil: 0, PP: 0.15, FF: 0.25, DD: 0.3, kk: 0.3, CH: 0.35, SS: 0.35, nn: 0.4, RR: 0.45, TH: 0.4 }[p.v] ?? 0.95;
      return base * Math.sin(Math.PI * clamp(k)) ** 0.6;
    };
    function mouth(cx, cy, sz, o, w, r) { // губы — заливкой: верхняя с «луком купидона», нижняя полнее
      const hw = sz * lerp(0.45, 1, w) * lerp(1, 0.68, r), oh = sz * 0.5 * o, lt = sz * lerp(0.17, 0.24, r);
      ctx.save(); ctx.translate(cx, cy);
      ctx.beginPath();
      ctx.moveTo(-hw, 0);
      ctx.bezierCurveTo(-hw * 0.6, -oh - lt * 1.1, -hw * 0.25, -oh - lt * 1.3, 0, -oh - lt * 0.75);
      ctx.bezierCurveTo(hw * 0.25, -oh - lt * 1.3, hw * 0.6, -oh - lt * 1.1, hw, 0);
      ctx.bezierCurveTo(hw * 0.6, oh + lt * 1.6, -hw * 0.6, oh + lt * 1.6, -hw, 0);
      ctx.fillStyle = "#d9785a"; ctx.fill();
      ctx.lineWidth = Math.max(1.5, sz * 0.03); ctx.strokeStyle = "#8a3f2c"; ctx.stroke();
      const iw = hw * 0.86;
      if (oh > 1) {
        ctx.beginPath(); ctx.moveTo(-iw, 0);
        ctx.bezierCurveTo(-iw * 0.5, -oh * 1.25, iw * 0.5, -oh * 1.25, iw, 0);
        ctx.bezierCurveTo(iw * 0.5, oh * 1.25, -iw * 0.5, oh * 1.25, -iw, 0);
        ctx.fillStyle = "#24110c"; ctx.fill();
        ctx.save(); ctx.clip();
        ctx.fillStyle = "#f1e8d8"; ctx.fillRect(-iw, -oh * 1.3, iw * 2, Math.min(oh * 0.75, sz * 0.13));
        if (o > 0.5) { ctx.fillStyle = "#9c3f3f"; ctx.beginPath(); ctx.ellipse(0, oh * 0.85, iw * 0.55, oh * 0.45, 0, 0, 7); ctx.fill(); }
        ctx.restore();
      } else { line(ctx, [[-iw, 0], [iw, 0]], Math.max(2, sz * 0.04), "#5a2618"); }
      ctx.restore();
    }
    return {
      draw(t) {
        const u = t % LOOP, f = W / 1000;
        ctx.fillStyle = C.code; ctx.fillRect(0, 0, W, H);
        // рот: визема текущего момента + LEAD, с плавным переходом
        const lipT = u + LEAD, p = at(lipT), k = clamp((lipT - p.a) / 0.06), prev = seq[Math.max(0, seq.indexOf(p) - 1)];
        const [o1, w1, r1] = VIS[prev.v], [o2, w2, r2] = VIS[p.v];
        const mx = W * 0.19, my = H * 0.36;
        rrect(ctx, 24 * f, 24 * f, W * 0.36 - 40 * f, H - 190 * f, 16 * f); ctx.fillStyle = C.bg2; ctx.fill();
        text(ctx, "визема сейчас", mx, 58 * f, `600 ${14 * f}px ${MONO}`, C.mute, "center");
        mouth(mx, my, 105 * f, lerp(o1, o2, ease(k)), lerp(w1, w2, ease(k)), lerp(r1, r2, ease(k)));
        text(ctx, VIS[p.v][3], mx, H - 200 * f, `800 ${38 * f}px ${SANS}`, C.amber, "center");
        // волна звука
        const x0 = W * 0.4, x1 = W - 24 * f, wy = H * 0.3, span = 1.6, tA = u - 0.5;
        const X = (x) => x0 + (x1 - x0) * (x - tA) / span;
        ctx.fillStyle = C.ink2;
        for (let x = x0; x < x1; x += 3 * f) {
          const tt = tA + (x - x0) / (x1 - x0) * span, a = amp(tt) * (0.6 + 0.4 * Math.abs(Math.sin(tt * 190))) * 60 * f;
          ctx.globalAlpha = tt < u ? 0.95 : 0.4; ctx.fillRect(x, wy - a, 2 * f, a * 2 + 1);
        }
        ctx.globalAlpha = 1;
        text(ctx, "звук: «Арго, приём. Как слышно?»", x0, 34 * f, `600 ${15 * f}px ${MONO}`, C.mute);
        // дорожка визем под волной
        const vy = wy + 92 * f;
        seq.forEach((q) => {
          const a = Math.max(X(q.a), x0), b = Math.min(X(q.b), x1);
          if (b <= a) return;
          const on = q === p;
          ctx.fillStyle = on ? C.amber : q.v === "sil" ? "transparent" : C.bg3;
          rrect(ctx, a + 1, vy - 16 * f, b - a - 2, 32 * f, 6 * f); ctx.fill();
          if (b - a > 26 * f && q.v !== "sil") text(ctx, VIS[q.v][3], (a + b) / 2, vy + 5 * f, `700 ${12 * f}px ${MONO}`, on ? "#1b1309" : C.ink2, "center");
        });
        text(ctx, "виземы", x0, vy + 40 * f, `600 ${13 * f}px ${MONO}`, C.mute);
        // две «головки»: звук и губы на 55 мс раньше
        line(ctx, [[X(u), wy - 70 * f], [X(u), vy + 22 * f]], 2, C.ink);
        line(ctx, [[X(u + LEAD), wy - 70 * f], [X(u + LEAD), vy + 22 * f]], 3, C.amber);
        text(ctx, "губы −55 мс", X(u + LEAD) + 6 * f, wy - 58 * f, `700 ${13 * f}px ${MONO}`, C.amber);
        // все 15 визем
        const gy = H - 70 * f, gw = (W - 48 * f) / 15;
        ORDER.forEach((v, i) => {
          const gx = 24 * f + i * gw + gw / 2, on = v === p.v;
          rrect(ctx, gx - gw / 2 + 3, gy - 34 * f, gw - 6, 92 * f, 8 * f);
          ctx.fillStyle = on ? rgba(C.amber, 0.18) : C.bg2; ctx.fill();
          if (on) { ctx.strokeStyle = C.amber; ctx.lineWidth = 2; ctx.stroke(); }
          const [o, w, r] = VIS[v];
          mouth(gx, gy - 2 * f, Math.min(gw * 0.34, 26 * f), o, w, r);
          text(ctx, VIS[v][3], gx, gy + 44 * f, `600 ${11 * f}px ${MONO}`, on ? C.amber : C.mute, "center");
        });
      },
    };
  };

  // =====================================================================================
  // ТРИ УРОВНЯ ПРОВЕРКИ: ошибки падают сверху, большинство ловят скрипты, часть — критики по кадрам, до человека доходит мало
  // =====================================================================================
  SCENES.funnel = (cv, ctx, W, H) => {
    const LV = [
      { y: 0.3, name: "1 · автопроверки", sub: "скрипты, тесты, коллайдеры", share: 0.62, col: "sage" },
      { y: 0.56, name: "2 · критики по кадрам", sub: "свежий агент смотрит плёнку", share: 0.27, col: "sage" },
      { y: 0.82, name: "3 · ты играешь", sub: "вкус и ощущения", share: 0.11, col: "amber" },
    ];
    const N = 64, LOOP = 15, R = rng(42);
    const bugs = Array.from({ length: N }, (_, i) => {
      const r = R(); let lv = r < 0.62 ? 0 : r < 0.89 ? 1 : 2;
      return { t0: i * 0.17 + R() * 0.1, x: 0.08 + R() * 0.5, lv, v: 0.5 + R() * 0.25, w: R() * 6 };
    });
    return {
      draw(t) {
        const u = t % LOOP, f = W / 900;
        ctx.fillStyle = C.code; ctx.fillRect(0, 0, W, H);
        const cnt = [0, 0, 0];
        bugs.forEach((b) => {
          const yT = LV[b.lv].y * H, age = u - b.t0;
          if (age < 0) return;
          const y = -10 + age * b.v * H * 0.9;
          const caught = y >= yT;
          const x = b.x * W + Math.sin(age * 4 + b.w) * 6 * f;
          if (caught) {
            const since = (y - yT) / (b.v * H * 0.9);
            cnt[b.lv]++;
            if (since < 0.45) {
              const k = since / 0.45;
              ctx.strokeStyle = rgba(C.red, 1 - k); ctx.lineWidth = 2;
              ctx.beginPath(); ctx.arc(x, yT, 6 * f + k * 18 * f, 0, 7); ctx.stroke();
              const cx = lerp(x, W * 0.86, ease(k)), cy = yT - 4 * f;
              ctx.fillStyle = rgba(C.red, 1 - k * 0.6); ctx.beginPath(); ctx.arc(cx, cy, 5 * f, 0, 7); ctx.fill();
            }
            return;
          }
          // жучок: тело и лапки
          ctx.fillStyle = C.ink;
          ctx.beginPath(); ctx.ellipse(x, y, 5 * f, 7 * f, 0, 0, 7); ctx.fill();
          ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
          for (let l = -1; l <= 1; l++) for (const sd of [-1, 1]) {
            ctx.beginPath(); ctx.moveTo(x, y + l * 3 * f); ctx.lineTo(x + sd * 9 * f, y + l * 4 * f + Math.sin(age * 20 + l) * 2 * f); ctx.stroke();
          }
        });
        LV.forEach((lv, i) => {
          const y = lv.y * H, col = C[lv.col];
          ctx.setLineDash([10 * f, 8 * f]); line(ctx, [[0, y], [W * 0.72, y]], 3, col); ctx.setLineDash([]);
          text(ctx, lv.name, 20 * f, y - 30 * f, `800 ${22 * f}px ${SANS}`, col);
          text(ctx, lv.sub, 20 * f, y - 8 * f, `500 ${14 * f}px ${MONO}`, C.mute);
          rrect(ctx, W * 0.76, y - 46 * f, W * 0.22, 64 * f, 10 * f); ctx.fillStyle = C.bg2; ctx.fill();
          ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
          text(ctx, String(cnt[i]), W * 0.87, y - 4 * f, `800 ${34 * f}px ${SANS}`, col, "center");
          text(ctx, "поймано", W * 0.87, y + 12 * f, `500 ${12 * f}px ${MONO}`, C.mute, "center");
        });
      },
    };
  };

  // =====================================================================================
  // АВТОПРОВЕРКА КОЛЛАЙДЕРОВ: скрипт проходит сцену и сам находит пересечения
  // =====================================================================================
  SCENES.colliders = (cv, ctx, W, H) => {
    // сцена в метрах: 20×12
    const objs = [
      { k: "wall", n: "Wall_N", x: 0, y: 0, w: 20, h: 0.5 }, { k: "wall", n: "Wall_S", x: 0, y: 11.5, w: 20, h: 0.5 },
      { k: "wall", n: "Wall_W", x: 0, y: 0, w: 0.5, h: 12 }, { k: "wall", n: "Wall_E", x: 19.5, y: 0, w: 0.5, h: 12 },
      { k: "wall", n: "Wall_03", x: 9, y: 0.5, w: 0.5, h: 6.5 },
      { k: "box", n: "Crate_12", x: 8.3, y: 3.1, w: 1.1, h: 1.1, hit: "Wall_03", d: "0,18 м" },
      { k: "box", n: "Crate_07", x: 3, y: 2, w: 1.2, h: 1.2 }, { k: "box", n: "Crate_08", x: 4.4, y: 2.2, w: 1, h: 1 },
      { k: "round", n: "Barrel_02", x: 14.2, y: 8.6, r: 0.55 }, { k: "round", n: "Barrel_03", x: 14.9, y: 8.9, r: 0.55, hit: "Barrel_02", d: "0,46 м" },
      { k: "box", n: "Door_A", x: 12.5, y: 11.1, w: 1.6, h: 0.9, hit: "Wall_S", d: "0,50 м" },
      { k: "box", n: "Table_01", x: 15, y: 2.5, w: 2.4, h: 1.3 }, { k: "round", n: "Pillar_01", x: 6, y: 8, r: 0.6 },
    ];
    const LOOP = 7;
    return {
      draw(t) {
        const u = t % LOOP, f = W / 800;
        ctx.fillStyle = C.code; ctx.fillRect(0, 0, W, H);
        const pad = 22 * f, sc = Math.min((W - 2 * pad) / 20, (H - 110 * f) / 12), ox = (W - 20 * sc) / 2, oy = pad;
        const P = (x, y) => [ox + x * sc, oy + y * sc];
        // сетка
        ctx.strokeStyle = rgba(C.line2, 0.35); ctx.lineWidth = 1;
        for (let x = 0; x <= 20; x++) { ctx.beginPath(); ctx.moveTo(...P(x, 0)); ctx.lineTo(...P(x, 12)); ctx.stroke(); }
        for (let y = 0; y <= 12; y++) { ctx.beginPath(); ctx.moveTo(...P(0, y)); ctx.lineTo(...P(20, y)); ctx.stroke(); }
        const scanX = ease(seg(u, 0.4, 4.6)) * 20;
        const found = objs.filter((o) => o.hit && (o.x ?? 0) < scanX - 0.3);
        objs.forEach((o) => {
          const bad = found.includes(o) || found.some((q) => q.hit === o.n);
          const col = bad ? C.red : C.sage;
          ctx.strokeStyle = col; ctx.lineWidth = bad ? 3 : 2; ctx.setLineDash(o.k === "wall" ? [] : [6 * f, 4 * f]);
          ctx.fillStyle = bad ? rgba(C.red, 0.18 + 0.12 * Math.sin(u * 10)) : rgba(C.sage, o.k === "wall" ? 0.25 : 0.08);
          ctx.beginPath();
          if (o.k === "round") { const [x, y] = P(o.x, o.y); ctx.arc(x, y, o.r * sc, 0, 7); }
          else { const [x, y] = P(o.x, o.y); ctx.rect(x, y, o.w * sc, o.h * sc); }
          ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
        });
        found.forEach((o) => {
          const [x, y] = P(o.x + (o.w || 0) / 2, o.y);
          const label = `${o.n} ∩ ${o.hit} · ${o.d}`;
          ctx.font = `700 ${13 * f}px ${MONO}`; const w = ctx.measureText(label).width + 14 * f;
          const lx = Math.min(x - w / 2, W - w - 8), ly = y - 30 * f < 6 ? y + 14 * f : y - 30 * f;
          rrect(ctx, lx, ly, w, 22 * f, 6 * f); ctx.fillStyle = C.red; ctx.fill();
          text(ctx, label, lx + 7 * f, ly + 15 * f, `700 ${13 * f}px ${MONO}`, "#fff");
        });
        // линия сканирования
        if (u < 4.8) {
          const [sx] = P(scanX, 0);
          const g = ctx.createLinearGradient(sx - 60 * f, 0, sx, 0);
          g.addColorStop(0, rgba(C.amber, 0)); g.addColorStop(1, rgba(C.amber, 0.28));
          ctx.fillStyle = g; ctx.fillRect(sx - 60 * f, oy, 60 * f, 12 * sc);
          line(ctx, [[sx, oy], [sx, oy + 12 * sc]], 2, C.amber);
        }
        // консоль
        const cy = oy + 12 * sc + 30 * f;
        text(ctx, "$ python tools/check_colliders.py scenes/level_02", ox, cy, `500 ${15 * f}px ${MONO}`, C.codeInk);
        const msg = u < 4.8 ? `проверено ${Math.round(scanX / 20 * objs.length)} из ${objs.length} объектов…` : `${found.length} пересечения → exit 1, отчёт в checks/colliders.json`;
        text(ctx, msg, ox, cy + 26 * f, `700 ${15 * f}px ${MONO}`, u < 4.8 ? C.mute : C.red);
      },
    };
  };

  // =====================================================================================
  // ДАМП ОВЕРЛЕЯ: то, что человек видит графиком, агент читает текстом
  // =====================================================================================
  SCENES.dump = (el) => {
    let last = -1;
    return {
      draw(t) {
        const step = Math.floor(t * 4);
        if (step === last) return;
        last = step;
        const R = rng(step * 31 + 7), fps = 58 + Math.round(R() * 5), low = 41 + Math.round(R() * 8);
        const hp = Math.max(12, 100 - (step % 120) * 0.7 | 0);
        const st = step % 40 < 18 ? "explore" : step % 40 < 32 ? "combat" : "cutscene";
        el.textContent =
`# tech_overlay.txt · кадр ${18000 + step * 15}
fps            ${fps}   1% low ${low}
frame_ms       ${(1000 / fps).toFixed(1)}   gpu ${(9 + R() * 3).toFixed(1)}
draw_calls     ${380 + Math.round(R() * 60)}
tris           ${(1.1 + R() * 0.3).toFixed(2)} M
memory_mb      ${2410 + Math.round(R() * 40)}
player.hp      ${hp}
player.pos     (${(12 + Math.sin(step / 9) * 3).toFixed(1)}, 0.0, ${(3 + Math.cos(step / 7) * 2).toFixed(1)})
state          ${st}
enemies.alive  ${st === "combat" ? 2 + (step % 3) : 0}
last_event     ${st === "combat" ? "creature_02 hit player 14" : st === "cutscene" ? "intro shot SH06A" : "door_03 opened"}`;
      },
    };
  };

  // ---------- запуск: только активный слайд ----------
  let running = [], raf = 0, t0 = 0;
  function start(slide) {
    running = [...slide.querySelectorAll("[data-anim]")].map((el) => {
      const make = SCENES[el.dataset.anim];
      if (!make) return null;
      if (el.tagName === "CANVAS") {
        const W = el.clientWidth, H = el.clientHeight;
        if (!W || !H) return null;
        el.width = Math.round(W * S); el.height = Math.round(H * S);
        const ctx = el.getContext("2d");
        const sc = make(el, ctx, W, H);
        return { el, ctx, sc, canvas: true };
      }
      return { el, sc: make(el), canvas: false };
    }).filter(Boolean);
    t0 = performance.now();
    cancelAnimationFrame(raf);
    if (running.length) raf = requestAnimationFrame(frame);
  }
  function frame(now) {
    const t = (now - t0) / 1000;
    for (const r of running) {
      if (r.canvas) { r.ctx.setTransform(S, 0, 0, S, 0, 0); r.ctx.clearRect(0, 0, r.el.width, r.el.height); }
      try { r.sc.draw(t); } catch (e) { console.error("anim", r.el.dataset.anim, e); }
    }
    raf = requestAnimationFrame(frame);
  }
  document.addEventListener("deck:slide", (e) => {
    document.fonts.ready.then(() => start(e.detail.slide));
  });
  // deck.js показал первый слайд раньше, чем загрузился этот файл
  const first = document.querySelector("#deck > .slide.active");
  if (first) document.fonts.ready.then(() => start(first));
  // seek(t): перемотать живые сцены на t секунд — для покадровой проверки
  window.DeckAnim = { SCENES, start, seek: (t) => (t0 = performance.now() - t * 1000) };
})();
