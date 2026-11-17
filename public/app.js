/* Game Day Squad: everything runs in the browser, nothing is stored. */
(() => {
  "use strict";

  // ---------- Config ----------
  const SCHOOL_COLORS = {
    primary: "#262223",   // charcoal
    accent: "#a2caec",    // light blue
    shirt: "#a2caec",
    shirtText: "#262223",
    gk: "#262223",
  };
  const CHARCOAL = "#262223";
  const FONT = '"Barlow Semi Condensed", "Arial Narrow", Arial, sans-serif';
  const SERIF = FONT; // headings
  const SANS = FONT;  // body

  // Lines from defence to attack (goalkeeper is added automatically)
  // 11-a-side shapes: lines from defence to attack (goalkeeper is added automatically)
  const FORMATIONS = {
    "4-4-2": [4, 4, 2], "4-3-3": [4, 3, 3], "4-2-3-1": [4, 2, 3, 1], "4-5-1": [4, 5, 1],
    "4-1-4-1": [4, 1, 4, 1], "3-5-2": [3, 5, 2], "3-4-3": [3, 4, 3], "5-3-2": [5, 3, 2],
  };
  const DEFAULT_FORMATION = "4-3-3";
  const LABELS = {
    def: { 1: ["CB"], 2: ["CB", "CB"], 3: ["CB", "CB", "CB"], 4: ["LB", "CB", "CB", "RB"], 5: ["LWB", "CB", "CB", "CB", "RWB"] },
    mid: { 1: ["CM"], 2: ["CM", "CM"], 3: ["CM", "CM", "CM"], 4: ["LM", "CM", "CM", "RM"], 5: ["LM", "CM", "CM", "CM", "RM"] },
    att: { 1: ["ST"], 2: ["ST", "ST"], 3: ["LW", "ST", "RW"] },
  };

  // Image layouts (pixels). Pitch is drawn in metres (68 x 105) and scaled in.
  const LAYOUTS = {
    portrait: {
      W: 1080, H: 1350, header: 230, strip: { y: 230, h: 110 },
      pitch: { x: 36, y: 368, w: 690, h: 950 }, side: { x: 750, y: 368, w: 294, h: 950 },
      R: 34, nameFont: 24, nameMax: 180,
    },
    landscape: {
      W: 1600, H: 1000, header: 190, strip: { y: 190, h: 72 },
      pitch: { x: 36, y: 290, w: 1090, h: 676 }, side: { x: 1150, y: 290, w: 414, h: 676 },
      R: 31, nameFont: 22, nameMax: 170,
    },
  };

  // ---------- State ----------
  const state = {
    team: "Sacred Heart College",
    category: "",
    opponent: "",
    homeAway: "",
    date: nextSaturday(),
    kickoff: "09:00",
    meet: "",
    venue: "",
    notes: "",
    coach: "",
    subs: "",
    formation: DEFAULT_FORMATION,
    names: Array(11).fill(""),
    positions: [],
    layout: "portrait",
    colors: { ...SCHOOL_COLORS },
    showLogo: true,
    logo: null,
  };

  const canvas = document.getElementById("sheet");
  const ctx = canvas.getContext("2d");
  let geom = null;          // last pitch geometry, used for dragging
  let dragging = -1;
  let lastMoved = -1;
  let renderQueued = false;

  // ---------- Helpers ----------
  function nextSaturday() {
    const d = new Date();
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function formatDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
  }
  function formatTime(t) {
    if (!t) return "";
    let [h, m] = t.split(":").map(Number);
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, "0")} ${ap}`;
  }
  function slug(s) {
    return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  function readableOn(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? "#262223" : "#ffffff";
  }
  function setFont(size, weight, family) { ctx.font = `${weight} ${size}px ${family}`; }
  // Shrinks font until text fits maxW; returns size used.
  function fitFont(text, maxW, size, weight, family, min = 12) {
    setFont(size, weight, family);
    while (size > min && ctx.measureText(text).width > maxW) { size -= 1; setFont(size, weight, family); }
    return size;
  }
  function ellipsize(text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 1 && ctx.measureText(text + "…").width > maxW) text = text.slice(0, -1);
    return text + "…";
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function wrapLines(text, maxW) {
    const out = [];
    text.split("\n").forEach((para) => {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(""); return; }
      let line = "";
      words.forEach((w) => {
        const test = line ? line + " " + w : w;
        if (ctx.measureText(test).width > maxW && line) { out.push(line); line = w; } else line = test;
      });
      out.push(line);
    });
    return out;
  }
  function subsList() {
    return state.subs.split("\n").map((s) => s.trim()).filter(Boolean);
  }

  // ---------- Formation ----------
  function buildPositions() {
    const lines = FORMATIONS[state.formation];
    const L = lines.length;
    const pos = [{ u: 0.5, v: 0.9, label: "GK" }];
    lines.forEach((n, i) => {
      const v = 0.74 - i * (0.52 / (L - 1));
      const spacing = n === 1 ? 0 : Math.min(0.25, 0.8 / (n - 1));
      const labels = labelsFor(i, L, n);
      for (let j = 0; j < n; j++) pos.push({ u: 0.5 + (j - (n - 1) / 2) * spacing, v, label: labels[j] });
    });
    state.positions = pos;
  }
  function labelsFor(i, L, n) {
    if (i === 0) return LABELS.def[n];
    if (i === L - 1) return LABELS.att[n] || LABELS.mid[n];
    if (L === 4 && i === 1) return Array(n).fill("DM");
    if (L === 4 && i === 2 && n === 3) return ["LW", "AM", "RW"];
    return LABELS.mid[n];
  }

  // ---------- Drawing ----------
  function render() {
    renderQueued = false;
    const Lo = LAYOUTS[state.layout];
    if (canvas.width !== Lo.W) canvas.width = Lo.W;
    if (canvas.height !== Lo.H) canvas.height = Lo.H;
    const c = state.colors;

    ctx.clearRect(0, 0, Lo.W, Lo.H);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, Lo.W, Lo.H);

    drawHeader(Lo, c);
    drawStrip(Lo, c);
    drawPitch(Lo);
    drawPlayers(Lo, c);
    drawSide(Lo, c);
  }
  function queueRender() {
    if (!renderQueued) { renderQueued = true; requestAnimationFrame(render); }
  }

  function drawHeader(Lo, c) {
    const H = Lo.header;
    const portrait = state.layout === "portrait";
    const blockX = Math.round(Lo.W * (portrait ? 0.5 : 0.56));

    // Dark band on the left, light-blue block on the right
    ctx.fillStyle = c.primary;
    ctx.fillRect(0, 0, Lo.W, H);
    ctx.fillStyle = c.accent;
    ctx.fillRect(blockX, 0, Lo.W - blockX, H);

    // Left: logo + school name
    const onDark = readableOn(c.primary);
    let x = 44;
    if (state.showLogo && state.logo && state.logo.complete && state.logo.naturalWidth) {
      const box = H - 70;
      const k = Math.min((blockX * 0.42) / state.logo.naturalWidth, box / state.logo.naturalHeight);
      const w = state.logo.naturalWidth * k, h = state.logo.naturalHeight * k;
      ctx.drawImage(state.logo, x, (H - h) / 2, w, h);
      x += w + 28;
    }
    const maxLeft = blockX - x - 32;
    const team = state.team.trim().toUpperCase();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    if (team) {
      // Up to two lines for the school name
      setFont(Math.round(H * 0.2), 800, FONT);
      let lines = [team];
      if (ctx.measureText(team).width > maxLeft && team.includes(" ")) {
        const words = team.split(" ");
        let best = null;
        for (let k = 1; k < words.length; k++) {
          const a = words.slice(0, k).join(" "), b = words.slice(k).join(" ");
          const m = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
          if (!best || m < best.m) best = { m, lines: [a, b] };
        }
        lines = best.lines;
      }
      let size = Math.round(H * 0.2);
      lines.forEach((l) => { size = Math.min(size, fitFont(l, maxLeft, Math.round(H * 0.2), 800, FONT, 16)); });
      setFont(size, 800, FONT);
      const lh = size * 1.0;
      const blockH = lh * lines.length + H * 0.13;
      let y = (H - blockH) / 2 + size * 0.85;
      ctx.fillStyle = onDark;
      lines.forEach((l) => { ctx.fillText(l, x, y); y += lh; });
      ctx.fillStyle = c.accent;
      setFont(Math.round(H * 0.1), 700, FONT);
      ctx.fillText("TEAM SHEET", x, y + H * 0.04);
    }

    // Right block: game day, category, opponent
    const ink = readableOn(c.accent);
    const bx = blockX + 40, bw = Lo.W - blockX - 80;
    ctx.fillStyle = ink;
    setFont(Math.round(H * 0.1), 700, FONT);
    ctx.fillText("GAME DAY", bx, H * 0.29);
    const cat = (state.category || "Team Sheet").toUpperCase();
    fitFont(cat, bw, Math.round(H * 0.3), 800, FONT, 20);
    ctx.fillText(cat, bx, H * 0.62);
    const vs = [state.opponent ? `VS ${state.opponent.toUpperCase()}` : "", state.homeAway].filter(Boolean).join("  |  ");
    if (vs) {
      fitFont(vs, bw, Math.round(H * 0.14), 700, FONT);
      ctx.fillText(vs, bx, H * 0.83);
    }
  }

  function drawStrip(Lo, c) {
    const s = Lo.strip;
    ctx.fillStyle = "#f4f4f4";
    ctx.fillRect(0, s.y, Lo.W, s.h);
    ctx.fillStyle = c.accent;
    ctx.fillRect(0, s.y + s.h - 5, Lo.W, 5);
    const parts = [
      formatDate(state.date).toUpperCase(),
      state.kickoff ? `KICK-OFF ${formatTime(state.kickoff)}` : "",
      state.meet ? `MEET ${formatTime(state.meet)}` : "",
    ].filter(Boolean);
    const venue = state.venue ? state.venue.toUpperCase() : "";
    ctx.fillStyle = CHARCOAL;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxW = Lo.W - 80;
    const sep = "   |   ";
    if (state.layout === "portrait") {
      const l1 = parts.join(sep);
      if (venue && l1) {
        fitFont(l1, maxW, 34, 800, FONT); ctx.fillText(l1, Lo.W / 2, s.y + s.h * 0.33);
        ctx.fillStyle = "#555051";
        fitFont(venue, maxW, 28, 700, FONT); ctx.fillText(venue, Lo.W / 2, s.y + s.h * 0.68);
      } else {
        const t = l1 || venue;
        fitFont(t, maxW, 36, 800, FONT); ctx.fillText(t, Lo.W / 2, s.y + s.h / 2 - 2);
      }
    } else {
      const t = [...parts, venue].filter(Boolean).join(sep);
      fitFont(t, maxW, 32, 800, FONT); ctx.fillText(t, Lo.W / 2, s.y + s.h / 2 - 2);
    }
  }

  function drawPitch(Lo) {
    const p = Lo.pitch, pad = 18;
    const portrait = state.layout === "portrait";
    const s = portrait
      ? Math.min((p.w - 2 * pad) / 68, (p.h - 2 * pad) / 105)
      : Math.min((p.w - 2 * pad) / 105, (p.h - 2 * pad) / 68);
    const lw = (portrait ? 68 : 105) * s, lh = (portrait ? 105 : 68) * s;
    const ox = p.x + (p.w - lw) / 2, oy = p.y + (p.h - lh) / 2;
    // mx: across the pitch (0..68, left to right for our team), my: along (0 = attacking goal, 105 = our goal)
    const map = portrait
      ? (mx, my) => [ox + mx * s, oy + my * s]
      : (mx, my) => [ox + (105 - my) * s, oy + mx * s];
    const unmap = portrait
      ? (X, Y) => [(X - ox) / s, (Y - oy) / s]
      : (X, Y) => [(Y - oy) / s, 105 - (X - ox) / s];
    geom = { map, unmap, R: Lo.R };

    // Grass
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0)";
    roundRect(ox - pad, oy - pad, lw + 2 * pad, lh + 2 * pad, 0.01);
    ctx.fillStyle = "#2e8b46"; ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ox - pad, oy - pad, lw + 2 * pad, lh + 2 * pad, 0.01);
    ctx.clip();
    for (let k = 0; k < 10; k++) {
      if (k % 2) continue;
      const [x1, y1] = map(-pad / s, k * 10.5), [x2, y2] = map(68 + pad / s, (k + 1) * 10.5);
      ctx.fillStyle = "#34984f";
      ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    }
    ctx.restore();

    // Lines
    ctx.strokeStyle = "rgba(255,255,255,.88)";
    ctx.fillStyle = "rgba(255,255,255,.88)";
    ctx.lineWidth = 3;
    const rect = (x1, y1, x2, y2) => {
      const [a, b] = map(x1, y1), [c2, d] = map(x2, y2);
      ctx.strokeRect(Math.min(a, c2), Math.min(b, d), Math.abs(c2 - a), Math.abs(d - b));
    };
    const line = (x1, y1, x2, y2) => {
      ctx.beginPath(); ctx.moveTo(...map(x1, y1)); ctx.lineTo(...map(x2, y2)); ctx.stroke();
    };
    const arc = (cx, cy, r, keep = () => true) => {
      ctx.beginPath();
      let drawing = false;
      for (let a = 0; a <= 360; a += 3) {
        const mx = cx + r * Math.cos((a * Math.PI) / 180), my = cy + r * Math.sin((a * Math.PI) / 180);
        if (keep(mx, my)) { const [X, Y] = map(mx, my); drawing ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); drawing = true; }
        else drawing = false;
      }
      ctx.stroke();
    };
    const dot = (mx, my) => { const [X, Y] = map(mx, my); ctx.beginPath(); ctx.arc(X, Y, 4, 0, Math.PI * 2); ctx.fill(); };

    rect(0, 0, 68, 105);
    line(0, 52.5, 68, 52.5);
    arc(34, 52.5, 9.15);
    dot(34, 52.5);
    rect(13.85, 0, 54.15, 16.5); rect(13.85, 88.5, 54.15, 105);
    rect(24.85, 0, 43.15, 5.5); rect(24.85, 99.5, 43.15, 105);
    dot(34, 11); dot(34, 94);
    arc(34, 11, 9.15, (x, y) => y > 16.5);
    arc(34, 94, 9.15, (x, y) => y < 88.5);
    rect(30.34, -1.6, 37.66, 0); rect(30.34, 105, 37.66, 106.6);
  }

  function jersey(x, y, R, fill) {
    const P = [[-0.36, -0.92], [0.36, -0.92], [0.98, -0.58], [0.78, -0.12], [0.56, -0.26], [0.56, 0.95],
               [-0.56, 0.95], [-0.56, -0.26], [-0.78, -0.12], [-0.98, -0.58]];
    ctx.beginPath();
    ctx.moveTo(x + P[0][0] * R, y + P[0][1] * R);
    ctx.quadraticCurveTo(x, y - 0.6 * R, x + P[1][0] * R, y + P[1][1] * R);
    for (let i = 2; i < P.length; i++) ctx.lineTo(x + P[i][0] * R, y + P[i][1] * R);
    ctx.closePath();
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
    ctx.fillStyle = fill; ctx.fill();
    ctx.restore();
    ctx.lineWidth = 3; ctx.strokeStyle = "#ffffff"; ctx.stroke();
  }

  function drawPlayers(Lo, c) {
    const R = Lo.R;
    // Draw the player being moved (or last moved) on top of the others
    const order = state.positions.map((_, i) => i).filter((i) => i !== lastMoved);
    if (lastMoved >= 0 && lastMoved < state.positions.length) order.push(lastMoved);
    order.forEach((i) => {
      const p = state.positions[i];
      const [X, Y] = geom.map(p.u * 68, p.v * 105);
      const isGK = i === 0;
      if (i === dragging) {
        ctx.beginPath(); ctx.arc(X, Y, R * 1.45, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fill();
      }
      jersey(X, Y, R, isGK ? c.gk : c.shirt);
      ctx.fillStyle = isGK ? readableOn(c.gk) : c.shirtText;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      setFont(Math.round(R * (p.label.length > 2 ? 0.52 : 0.62)), 800, SANS);
      ctx.fillText(p.label, X, Y + R * 0.1);

      const name = (state.names[i] || "").trim().toUpperCase();
      if (name) {
        // Long names go onto two lines rather than shrinking too small
        let lines = [name];
        setFont(Lo.nameFont, 800, SANS);
        if (ctx.measureText(name).width > Lo.nameMax && name.includes(" ")) {
          const words = name.split(/\s+/);
          let best = null;
          for (let k = 1; k < words.length; k++) {
            const a = words.slice(0, k).join(" "), b = words.slice(k).join(" ");
            const wMax = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
            if (!best || wMax < best.w) best = { w: wMax, lines: [a, b] };
          }
          lines = best.lines;
        }
        let size = Lo.nameFont;
        lines.forEach((l) => { size = Math.min(size, fitFont(l, Lo.nameMax, Lo.nameFont, 800, SANS, 14)); });
        setFont(size, 800, SANS);
        const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
        const lh = size * 1.15;
        const ph = lh * lines.length + 12, pw = tw + 24, py = Y + R + 8;
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,.3)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
        roundRect(X - pw / 2, py, pw, ph, 2);
        ctx.fillStyle = "#ffffff"; ctx.fill();
        ctx.restore();
        ctx.fillStyle = CHARCOAL;
        lines.forEach((l, k) => ctx.fillText(l, X, py + 6 + lh * (k + 0.5) + 1));
      }
    });
  }

  function drawSide(Lo, c) {
    const s = Lo.side, pad = 30;
    // Light-blue panel
    ctx.fillStyle = c.accent;
    ctx.fillRect(s.x, s.y, s.w, s.h);
    const ink = readableOn(c.accent);

    const x = s.x + pad, w = s.w - pad * 2;
    let y = s.y + pad;
    const bottom = s.y + s.h - pad;
    ctx.textAlign = "left"; ctx.textBaseline = "top";

    const heading = (t) => {
      ctx.fillStyle = ink;
      setFont(34, 800, FONT);
      ctx.fillText(t, x, y);
      y += 44;
      ctx.fillRect(x, y, 48, 4);
      y += 22;
    };

    // Coach (anchored at the bottom)
    let coachTop = bottom;
    if (state.coach.trim()) {
      coachTop = bottom - 34;
      ctx.fillStyle = ink;
      setFont(22, 700, FONT);
      ctx.globalAlpha = 0.75;
      ctx.fillText("COACH", x, coachTop - 26);
      ctx.globalAlpha = 1;
      setFont(30, 800, FONT);
      ctx.fillText(ellipsize(state.coach.trim().toUpperCase(), w), x, coachTop);
      coachTop -= 44;
    }

    // Substitutes
    heading("SUBSTITUTES");
    const subs = subsList();
    const notes = state.notes.trim();
    const subsSpace = (coachTop - y) * (notes ? 0.55 : 1);
    if (!subs.length) {
      ctx.fillStyle = ink; setFont(28, 700, FONT);
      ctx.fillText("—", x, y); y += 40;
    } else {
      let size = state.layout === "portrait" ? 30 : 31;
      while (size > 14 && subs.length * size * 1.45 > subsSpace) size -= 1;
      const lh = size * 1.45;
      subs.forEach((name) => {
        ctx.fillStyle = ink;
        ctx.fillRect(x, y + size * 0.36, size * 0.3, size * 0.3);
        setFont(size, 700, FONT);
        ctx.fillText(ellipsize(name.toUpperCase(), w - 24), x + 22, y);
        y += lh;
      });
    }

    // Notes
    if (notes) {
      y += 22;
      if (y + 100 < coachTop) {
        heading("NOTES");
        setFont(25, 500, FONT);
        const lines = wrapLines(notes, w);
        const lh = 32;
        ctx.fillStyle = ink;
        for (let i = 0; i < lines.length; i++) {
          if (y + lh * 2 > coachTop && i < lines.length - 1) { ctx.fillText(ellipsize(lines[i] + "…", w), x, y); break; }
          ctx.fillText(lines[i], x, y);
          y += lh;
        }
      }
    }
  }

  // ---------- Dragging on the preview ----------
  function canvasPoint(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return [(clientX - r.left) * (canvas.width / r.width), (clientY - r.top) * (canvas.height / r.height)];
  }
  function hitTest(X, Y) {
    if (!geom) return -1;
    const order = state.positions.map((_, i) => i).filter((i) => i !== lastMoved);
    if (lastMoved >= 0 && lastMoved < state.positions.length) order.push(lastMoved);
    for (let k = order.length - 1; k >= 0; k--) {
      const i = order[k], p = state.positions[i];
      const [px, py] = geom.map(p.u * 68, p.v * 105);
      if (Math.hypot(X - px, Y - py) < geom.R * 1.4) return i;
    }
    return -1;
  }
  canvas.addEventListener("pointerdown", (e) => {
    const [X, Y] = canvasPoint(e.clientX, e.clientY);
    const i = hitTest(X, Y);
    if (i < 0) return;
    dragging = i;
    lastMoved = i;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = "grabbing";
    e.preventDefault();
    queueRender();
  });
  canvas.addEventListener("pointermove", (e) => {
    const [X, Y] = canvasPoint(e.clientX, e.clientY);
    if (dragging < 0) { canvas.style.cursor = hitTest(X, Y) >= 0 ? "grab" : "default"; return; }
    const [mx, my] = geom.unmap(X, Y);
    const p = state.positions[dragging];
    p.u = Math.min(0.97, Math.max(0.03, mx / 68));
    p.v = Math.min(0.97, Math.max(0.03, my / 105));
    queueRender();
  });
  const endDrag = () => { if (dragging >= 0) { dragging = -1; canvas.style.cursor = "grab"; queueRender(); } };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  // On phones, only stop the page from scrolling when a finger lands on a shirt.
  canvas.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    const [X, Y] = canvasPoint(t.clientX, t.clientY);
    if (hitTest(X, Y) >= 0) e.preventDefault();
  }, { passive: false });

  // ---------- UI wiring ----------
  const startersEl = document.getElementById("starters");
  const formationSel = document.getElementById("formation");

  function buildFormationSelect() {
    formationSel.innerHTML = Object.keys(FORMATIONS)
      .map((f) => `<option value="${f}"${f === state.formation ? " selected" : ""}>${f}</option>`).join("");
  }
  function buildStarters() {
    startersEl.innerHTML = "";
    state.positions.forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "starter";
      row.innerHTML = `<span class="pos-badge${i === 0 ? " gk" : ""}">${p.label}</span>`;
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = i === 0 ? "Goalkeeper" : `Player ${i + 1}`;
      input.value = state.names[i] || "";
      input.setAttribute("aria-label", `${p.label} name`);
      input.addEventListener("input", () => { state.names[i] = input.value; queueRender(); });
      row.appendChild(input);
      startersEl.appendChild(row);
    });
  }
  function setActive(selector, attr, value) {
    document.querySelectorAll(selector).forEach((b) => b.classList.toggle("active", b.dataset[attr] === String(value)));
  }
  function applyFormation() {
    lastMoved = -1;
    buildPositions();
    buildFormationSelect();
    buildStarters();
    queueRender();
  }
  function syncInputs() {
    document.querySelectorAll("[data-field]").forEach((el) => { el.value = state[el.dataset.field]; });
    document.querySelectorAll("[data-color]").forEach((el) => { el.value = state.colors[el.dataset.color]; });
  }

  document.querySelectorAll("[data-field]").forEach((el) => {
    el.addEventListener("input", () => { state[el.dataset.field] = el.value; queueRender(); });
  });
  document.querySelectorAll("[data-color]").forEach((el) => {
    el.addEventListener("input", () => { state.colors[el.dataset.color] = el.value; queueRender(); });
  });
  formationSel.addEventListener("change", () => { state.formation = formationSel.value; applyFormation(); });
  document.getElementById("resetPositions").addEventListener("click", () => { buildPositions(); queueRender(); });

  document.querySelectorAll("[data-layout]").forEach((b) => {
    b.addEventListener("click", () => {
      state.layout = b.dataset.layout;
      setActive("[data-layout]", "layout", state.layout);
      document.querySelector(".preview-inner").classList.toggle("portrait", state.layout === "portrait");
      queueRender();
    });
  });

  document.getElementById("fillBtn").addEventListener("click", () => {
    const list = document.getElementById("pasteBox").value
      .split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!list.length) return;
    const n = state.positions.length;
    for (let i = 0; i < n; i++) state.names[i] = list[i] || "";
    if (list.length > n) state.subs = list.slice(n).join("\n");
    buildStarters();
    syncInputs();
    queueRender();
  });

  // Logo
  function loadLogo(src) {
    const img = new Image();
    img.onload = () => {
      state.logo = img;
      document.getElementById("topLogo").src = src;
      queueRender();
    };
    img.src = src;
  }
  document.getElementById("logoInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadLogo(reader.result);
    reader.readAsDataURL(file);
    e.target.value = "";
  });
  document.getElementById("resetLogo").addEventListener("click", () => window.DEFAULT_LOGO && loadLogo(window.DEFAULT_LOGO));
  document.getElementById("showLogo").addEventListener("change", (e) => { state.showLogo = e.target.checked; queueRender(); });
  document.getElementById("resetColors").addEventListener("click", () => {
    state.colors = { ...SCHOOL_COLORS };
    syncInputs();
    queueRender();
  });

  // Clear all (two taps, so nobody loses a team by accident)
  const clearBtn = document.getElementById("clearBtn");
  let clearArmed = null;
  clearBtn.addEventListener("click", () => {
    if (!clearArmed) {
      clearBtn.textContent = "Tap again to clear";
      clearBtn.classList.add("danger");
      clearArmed = setTimeout(() => { clearArmed = null; clearBtn.textContent = "Clear all"; clearBtn.classList.remove("danger"); }, 3000);
      return;
    }
    clearTimeout(clearArmed); clearArmed = null;
    clearBtn.textContent = "Clear all"; clearBtn.classList.remove("danger");
    Object.assign(state, { category: "", opponent: "", homeAway: "", meet: "", venue: "", notes: "", coach: "", subs: "", names: Array(11).fill("") });
    document.getElementById("pasteBox").value = "";
    syncInputs(); buildPositions(); buildStarters(); queueRender();
  });

  // ---------- Export ----------
  function fileName() {
    const parts = [slug(state.category) || "team-sheet", state.opponent ? "vs-" + slug(state.opponent) : "", state.date, state.layout];
    return parts.filter(Boolean).join("_") + ".png";
  }
  function makeBlob() {
    dragging = -1;
    render();
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }
  document.getElementById("downloadBtn").addEventListener("click", async () => {
    const blob = await makeBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fileName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });

  const shareBtn = document.getElementById("shareBtn");
  try {
    const probe = new File([new Blob(["x"])], "probe.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [probe] })) shareBtn.hidden = false;
  } catch (_) { /* sharing not supported */ }
  shareBtn.addEventListener("click", async () => {
    const blob = await makeBlob();
    const file = new File([blob], fileName(), { type: "image/png" });
    const title = [state.category || "Team sheet", state.opponent ? `vs ${state.opponent}` : ""].filter(Boolean).join(" ");
    try {
      await navigator.share({ files: [file], title, text: `${title}: ${formatDate(state.date)}` });
    } catch (err) {
      if (err.name !== "AbortError") console.warn("Share failed", err);
    }
  });

  // ---------- Start ----------
  syncInputs();
  applyFormation();
  setActive("[data-layout]", "layout", state.layout);
  document.querySelector(".preview-inner").classList.add("portrait");
  if (window.DEFAULT_LOGO) loadLogo(window.DEFAULT_LOGO);
  render();
  if (document.fonts) {
    Promise.all([
      document.fonts.load(`800 40px ${FONT}`),
      document.fonts.load(`700 20px ${FONT}`),
      document.fonts.load(`500 20px ${FONT}`),
    ]).then(queueRender, queueRender);
  }
})();
