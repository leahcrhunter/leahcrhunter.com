// The fairy lights strung across the top and the fireflies drifting behind
// everything: the same family as the landing page and the corkboard.
// Used by the app and the login page, so no imports.

const rand = (a, b) => a + Math.random() * (b - a);
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Swags of wire across the full width with a bulb every ~50px.
export function fairyLights(svg) {
  const ns = "http://www.w3.org/2000/svg";
  function draw() {
    const W = Math.max(320, svg.clientWidth || window.innerWidth);
    const H = 64;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.replaceChildren();

    const defs = document.createElementNS(ns, "defs");
    defs.innerHTML = `<filter id="bulbBlur" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3.5"/></filter>`;
    svg.append(defs);

    const swags = Math.max(2, Math.round(W / 380));
    const y0 = 6, sag = 26;
    let d = `M -4 ${y0}`;
    for (let i = 0; i < swags; i++) {
      const x1 = (W / swags) * (i + 0.5), x2 = (W / swags) * (i + 1) + (i === swags - 1 ? 4 : 0);
      d += ` Q ${x1} ${y0 + sag * 2} ${x2} ${y0}`;
    }
    const wire = document.createElementNS(ns, "path");
    wire.setAttribute("d", d);
    wire.setAttribute("class", "wire");
    svg.append(wire);

    const len = wire.getTotalLength();
    const count = Math.round(W / 50);
    for (let i = 1; i < count; i++) {
      const p = wire.getPointAtLength((len / count) * i);
      const g = document.createElementNS(ns, "g");
      g.setAttribute("class", "bulb-group");
      g.style.setProperty("--dur", rand(2.4, 4.6).toFixed(2) + "s");
      g.style.setProperty("--delay", (-rand(0, 4)).toFixed(2) + "s");
      // a few warmer bulbs among the gold ones
      if (Math.random() < 0.22) g.classList.add("warm");
      const y = p.y + 8;
      g.innerHTML =
        `<rect class="cap" x="${(p.x - 1.8).toFixed(1)}" y="${p.y.toFixed(1)}" width="3.6" height="5" rx="1"/>` +
        `<circle class="bulb-glow" cx="${p.x.toFixed(1)}" cy="${(y + 3).toFixed(1)}" r="10"/>` +
        `<ellipse class="bulb-glass" cx="${p.x.toFixed(1)}" cy="${(y + 3).toFixed(1)}" rx="2.6" ry="3.4"/>`;
      svg.append(g);
    }
  }
  draw();
  let t;
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(draw, 150); });
}

export function fireflies(canvas, { count = 14 } = {}) {
  const ctx = canvas.getContext("2d");
  let W, H, flies = [];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function seed() {
    flies = [];
    const n = reduced ? Math.ceil(count / 3) : count;
    for (let i = 0; i < n; i++) {
      flies.push({
        x: rand(0, W), y: rand(0, H), angle: rand(0, Math.PI * 2), wander: rand(0, 6),
        ws: rand(0.003, 0.008), speed: rand(0.12, 0.3), r: rand(1.3, 2.3),
        phase: rand(0, 6), ps: rand(0.012, 0.025),
      });
    }
  }

  let prev = performance.now();
  function loop(t) {
    const dt = Math.min(2.2, (t - prev) / 16.67 || 1);
    prev = t;
    ctx.clearRect(0, 0, W, H);
    for (const f of flies) {
      f.wander += f.ws * dt; f.phase += f.ps * dt;
      f.angle += Math.sin(f.wander) * 0.02 * dt;
      const s = (reduced ? 0.3 : 1) * f.speed * dt;
      f.x += Math.cos(f.angle) * s; f.y += Math.sin(f.angle) * s;
      if (f.x < -20) f.x = W + 20; if (f.x > W + 20) f.x = -20;
      if (f.y < -20) f.y = H + 20; if (f.y > H + 20) f.y = -20;

      const glow = 0.5 + Math.sin(f.phase) * 0.5;
      const a = 0.15 + glow * 0.55;
      const r = f.r * (1 + glow * 0.6);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r * 6);
      g.addColorStop(0, `rgba(244,213,141,${a * 0.9})`);
      g.addColorStop(0.35, `rgba(244,213,141,${a * 0.25})`);
      g.addColorStop(1, "rgba(244,213,141,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, r * 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,244,214,${Math.min(1, a + 0.2)})`;
      ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    requestAnimationFrame(loop);
  }
  resize(); seed();
  window.addEventListener("resize", () => { resize(); seed(); });
  requestAnimationFrame(loop);
}
