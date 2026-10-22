import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

const sprite = [
  "           ######## ",
  "          ##########",
  "          ## #######",
  "          ##########",
  "          ##########",
  "          ######    ",
  "          ########  ",
  "         ####       ",
  "##      ######      ",
  "##     #########    ",
  "###   ######## #    ",
  "#### #########      ",
  "##############      ",
  " #############      ",
  "  ###########       ",
  "   ##########       ",
  "    ########        ",
  "     #######        ",
  "     ### ###        ",
  "     ##   ##        ",
  "     ##   ##        ",
  "     ###  ###       ",
];
export function drawDino(ctx, x, y, scale = 3, color = "#344c38", step = 0) {
  ctx.fillStyle = color;
  ctx.beginPath();
  sprite.forEach((line, row) =>
    [...line].forEach((pixel, col) => {
      if (pixel !== "#") return;
      if (step && row > 18 && (step % 2 ? col < 9 : col > 9)) return;
      ctx.rect(x + col * scale, y + row * scale, scale, scale);
    }),
  );
  ctx.fill();
}
function bestScore() {
  try {
    return Number(localStorage.getItem("dino-motion-best")) || 0;
  } catch {
    return 0;
  }
}
const fresh = (best) => ({
  mode: "idle",
  score: 0,
  best,
  y: 0,
  vy: 0,
  distance: 0,
  obstacles: [],
  spawn: 1.5,
  jumps: 0,
});

const Game = forwardRef(function Game({ onState, onJump }, ref) {
  const canvas = useRef(null),
    game = useRef(fresh(bestScore()));
  const callbacks = useRef({ onState, onJump });
  callbacks.current = { onState, onJump };
  const publish = () =>
    callbacks.current.onState({ ...game.current, obstacles: undefined });
  const start = () => {
    game.current = { ...fresh(game.current.best), mode: "running" };
    publish();
  };
  const jump = (source = "keyboard") => {
    let g = game.current;
    if (g.mode === "paused") return false;
    if (g.mode !== "running") {
      start();
      g = game.current;
    }
    if (g.y > 0 || g.vy !== 0) return false;
    g.vy = 690;
    g.jumps++;
    callbacks.current.onJump(source);
    publish();
    return true;
  };
  useImperativeHandle(ref, () => ({
    jump,
    start,
    pause() {
      const g = game.current;
      if (g.mode === "running") g.mode = "paused";
      else if (g.mode === "paused") g.mode = "running";
      publish();
    },
  }));
  useEffect(() => {
    const key = (e) => {
      if (document.querySelector("dialog[open]")) return;
      if (
        !["Space", "ArrowUp"].includes(e.code) ||
        e.repeat ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey
      )
        return;
      if (
        /INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName) ||
        e.target.isContentEditable
      )
        return;
      e.preventDefault();
      jump("keyboard");
    };
    const visibility = () => {
      if (document.hidden && game.current.mode === "running") {
        game.current.mode = "paused";
        publish();
      }
    };
    window.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", visibility);
    let raf,
      last = 0,
      reported = 0;
    const frame = (time) => {
      const dt = last ? Math.min((time - last) / 1000, 0.035) : 0;
      last = time;
      const g = game.current;
      if (g.mode === "running") {
        const speed = 330 + Math.min(180, g.distance / 140);
        g.distance += speed * dt;
        g.score = Math.floor(g.distance / 12);
        g.vy -= 1800 * dt;
        g.y = Math.max(0, g.y + g.vy * dt);
        if (!g.y) g.vy = 0;
        g.spawn -= dt;
        if (g.spawn <= 0) {
          g.obstacles.push({
            x: 1030,
            h: 38 + Math.random() * 20,
            w: Math.random() > 0.7 ? 35 : 23,
          });
          g.spawn = 1.3 + Math.random() * 0.65;
        }
        for (const o of g.obstacles) {
          o.x -= speed * dt;
          // Inset collision boxes follow the solid torso and cactus trunk.
          if (
            104 < o.x + o.w - 3 &&
            140 > o.x + 3 &&
            264 - g.y > 266 - o.h + 6 &&
            210 - g.y < 266
          ) {
            g.mode = "over";
            g.best = Math.max(g.best, g.score);
            try {
              localStorage.setItem("dino-motion-best", String(g.best));
            } catch {
              /* Storage optional. */
            }
            publish();
            break;
          }
        }
        g.obstacles = g.obstacles.filter((o) => o.x > -60);
        if (time - reported > 100) {
          reported = time;
          publish();
        }
      }
      const el = canvas.current;
      const ctx = el.getContext("2d");
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const bounds = el.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width * dpr));
      const height = Math.max(1, Math.round(bounds.height * dpr));
      if (el.width !== width || el.height !== height) {
        el.width = width;
        el.height = height;
      }
      // Keep square pixels and the original horizontal gameplay/collision space.
      // Portrait screens crop the far right instead of stretching the dinosaur.
      const scale = (Math.max(650, bounds.width) * dpr) / 1000;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      render(ctx, g, time, height / scale);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    publish();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return (
    <canvas
      ref={canvas}
      className="game-canvas"
      aria-label="Dinosaur runner game. Use Space or Arrow Up to jump."
      role="img"
    />
  );
});
function render(ctx, g, time, height = 340) {
  const ground = height - 20;
  ctx.clearRect(0, 0, 1000, height);
  ctx.fillStyle = "#f2f5e9";
  ctx.fillRect(0, 0, 1000, height);
  ctx.fillStyle = "#e7edcf";
  ctx.beginPath();
  ctx.arc(855, height * 0.38, 43, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#dde5cf";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) {
    const x = ((((i * 310 - g.distance * 0.1) % 1300) + 1300) % 1300) - 100;
    ctx.beginPath();
    ctx.moveTo(x, ground);
    ctx.lineTo(x + 100, ground - 74);
    ctx.lineTo(x + 190, ground);
    ctx.stroke();
  }
  ctx.fillStyle = "#d8e0cb";
  for (let i = 0; i < 5; i++) {
    const x = ((((i * 240 - g.distance * 0.18) % 1200) + 1200) % 1200) - 80;
    ctx.fillRect(x, height * 0.35 + (i % 3) * 26, 47, 2);
    ctx.fillRect(x + 12, height * 0.35 - 7 + (i % 3) * 26, 22, 2);
  }
  ctx.fillStyle = "#73866b";
  ctx.fillRect(0, ground, 1000, 2);
  ctx.fillStyle = "#ccd6bd";
  for (let i = 0; i < 34; i++) {
    const x = (((i * 37 - g.distance) % 1100) + 1100) % 1100;
    ctx.fillRect(x, ground + 15 + (i % 3) * 10, i % 2 ? 8 : 3, 2);
  }
  ctx.fillStyle = "#d8dfca";
  ctx.beginPath();
  ctx.ellipse(120, ground + 6, 29 - g.y * 0.06, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  drawDino(
    ctx,
    88,
    ground - 66 - g.y,
    3,
    g.mode === "over" ? "#8e7057" : "#344c38",
    g.mode === "running" && !g.y ? (Math.floor(time / 110) % 2) + 1 : 0,
  );
  ctx.fillStyle = "#5c7450";
  for (const o of g.obstacles) {
    ctx.fillRect(o.x + o.w * 0.35, ground - o.h, o.w * 0.3, o.h);
    ctx.fillRect(o.x, ground - o.h * 0.64, o.w * 0.4, 6);
    ctx.fillRect(o.x, ground - o.h * 0.84, 5, o.h * 0.24);
    ctx.fillRect(o.x + o.w * 0.6, ground - o.h * 0.46, o.w * 0.4, 6);
    ctx.fillRect(o.x + o.w - 5, ground - o.h * 0.73, 5, o.h * 0.3);
  }
}
export default Game;
