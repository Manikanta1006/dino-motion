import { cp, mkdir, access, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const local = (...parts) => path.join(root, ...parts);
await mkdir(local("public", "mediapipe"), { recursive: true });
await mkdir(local("public", "models"), { recursive: true });
await cp(
  local("node_modules", "@mediapipe", "tasks-vision", "wasm"),
  local("public", "mediapipe", "wasm"),
  { recursive: true },
);
await cp(
  local("node_modules", "@mediapipe", "tasks-vision", "vision_bundle.js"),
  local("public", "mediapipe", "vision_bundle.js"),
);
for (const [name, url] of [
  [
    "hand_landmarker.task",
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  ],
  [
    "pose_landmarker_lite.task",
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  ],
]) {
  const target = local("public", "models", name);
  try {
    await access(target);
    continue;
  } catch {
    /* First install. */
  }
  console.log(`Downloading ${name} (one-time setup)…`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok)
    throw new Error(`Model download failed: ${response.status} ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 100000) throw new Error(`Incomplete model: ${name}`);
  await writeFile(`${target}.tmp`, bytes);
  await rename(`${target}.tmp`, target);
}
console.log(
  "MediaPipe runtime and models are ready. All browser assets are served locally.",
);
