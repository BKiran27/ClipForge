import { CheckpointManager } from "../pipeline/checkpoint";
import { PipelineOrchestrator } from "../pipeline/orchestrator";
import { loadConfig } from "../config";
import { listFiles, fileExists } from "../utils/fs";
import { createLogger } from "../utils/logger";
import { join } from "path";

const log = createLogger("web-server");

export function startWebServer(port: number = 3000) {
  const config = loadConfig();
  const checkpoint = new CheckpointManager(config.paths.checkpointDb);
  let activeOrchestrator: PipelineOrchestrator | null = null;
  let activeRunId: string | null = null;
  let activeLog: string[] = [];

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🎬 Clips Studio - AI Viral Shorts Pipeline</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card: #111827;
      --card-border: #1f293d;
      --accent: #6366f1;
      --accent-hover: #4f46e5;
      --accent-glow: rgba(99, 102, 241, 0.25);
      --success: #10b981;
      --warning: #f59e0b;
      --text: #f9fafb;
      --text-muted: #9ca3af;
      --font: 'Plus Jakarta Sans', sans-serif;
      --mono: 'JetBrains Mono', monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: rgba(17, 24, 39, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--card-border);
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 1.25rem;
      font-weight: 800;
      background: linear-gradient(135deg, #a5b4fc, #6366f1, #c084fc);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .badge {
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.3);
      color: #a5b4fc;
      font-size: 0.75rem;
      padding: 0.25rem 0.6rem;
      border-radius: 999px;
      font-weight: 600;
    }
    main {
      max-width: 1300px;
      margin: 0 auto;
      padding: 2.5rem 1.5rem;
      width: 100%;
      display: grid;
      grid-template-columns: 1fr 380px;
      gap: 2rem;
    }
    @media (max-width: 1024px) {
      main { grid-template-columns: 1fr; }
    }
    .card {
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.75rem;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    }
    h2 { font-size: 1.2rem; font-weight: 700; margin-bottom: 1.25rem; display: flex; align-items: center; gap: 0.5rem; }
    .form-group { margin-bottom: 1.25rem; }
    label { display: block; font-size: 0.85rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.5rem; }
    input[type="text"], select {
      width: 100%;
      padding: 0.85rem 1rem;
      background: #0b1120;
      border: 1px solid var(--card-border);
      border-radius: 10px;
      color: var(--text);
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    input[type="text"]:focus, select:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-glow);
    }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    button.btn-primary {
      width: 100%;
      padding: 0.95rem;
      background: linear-gradient(135deg, #6366f1, #4f46e5);
      border: none;
      border-radius: 10px;
      color: white;
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 0.5rem;
      transition: transform 0.15s, opacity 0.15s;
    }
    button.btn-primary:hover { opacity: 0.95; transform: translateY(-1px); }
    button.btn-primary:active { transform: translateY(0); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .stages {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 0.75rem;
      margin-top: 1.5rem;
    }
    .stage-pill {
      background: #0b1120;
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 0.75rem;
      text-align: center;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
      transition: all 0.3s;
    }
    .stage-pill.active {
      border-color: var(--accent);
      color: #a5b4fc;
      background: rgba(99, 102, 241, 0.1);
      box-shadow: 0 0 15px var(--accent-glow);
    }
    .stage-pill.completed {
      border-color: var(--success);
      color: var(--success);
      background: rgba(16, 185, 129, 0.1);
    }
    .clips-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1.25rem;
      margin-top: 1.5rem;
    }
    .clip-card {
      background: #0b1120;
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .clip-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .viral-badge {
      background: linear-gradient(135deg, #f59e0b, #ef4444);
      color: white;
      font-size: 0.75rem;
      font-weight: 800;
      padding: 0.2rem 0.5rem;
      border-radius: 6px;
    }
    .clip-title { font-size: 0.95rem; font-weight: 700; }
    .clip-hook {
      font-size: 0.82rem;
      color: #cbd5e1;
      font-style: italic;
      background: rgba(255, 255, 255, 0.04);
      padding: 0.5rem;
      border-radius: 6px;
      border-left: 3px solid var(--accent);
    }
    .clip-meta { font-size: 0.75rem; color: var(--text-muted); display: flex; justify-content: space-between; }
    .video-player-container {
      width: 100%;
      aspect-ratio: 9/16;
      max-height: 520px;
      background: black;
      border-radius: 12px;
      overflow: hidden;
      margin: 1rem auto 0;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    }
    video { width: 100%; height: 100%; object-fit: contain; }
    .log-box {
      font-family: var(--mono);
      font-size: 0.75rem;
      background: #060911;
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 0.85rem;
      height: 180px;
      overflow-y: auto;
      color: #94a3b8;
      margin-top: 1.25rem;
      white-space: pre-wrap;
    }
    .runs-list { display: flex; flex-direction: column; gap: 0.75rem; max-height: 500px; overflow-y: auto; }
    .run-item {
      padding: 0.85rem;
      background: #0b1120;
      border: 1px solid var(--card-border);
      border-radius: 10px;
      font-size: 0.82rem;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    .run-item:hover { border-color: var(--accent); }
    .run-title { font-weight: 700; margin-bottom: 0.25rem; }
    .run-status { font-size: 0.72rem; color: var(--text-muted); display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <span>🎬</span>
      <span>Clips Studio</span>
      <span class="badge">v2.0 Pro</span>
    </div>
    <div style="font-size: 0.85rem; color: var(--text-muted);">
      Powered by Google Gemini 2.0 & Remotion
    </div>
  </header>

  <main>
    <div>
      <div class="card">
        <h2>⚡ Create Viral Shorts from YouTube</h2>
        <div class="form-group">
          <label for="url">YouTube Video URL</label>
          <input type="text" id="url" placeholder="https://www.youtube.com/watch?v=..." value="https://www.youtube.com/watch?v=dQw4w9WgXcQ">
        </div>
        <div class="row">
          <div class="form-group">
            <label for="layout">Vertical Layout Style</label>
            <select id="layout">
              <option value="blur-background" selected>✨ Blur Background (Studio Standard)</option>
              <option value="split-screen">🎮 Split-Screen (Subway Surfers Gameplay)</option>
              <option value="center-crop">📐 Center Crop 9:16</option>
            </select>
          </div>
          <div class="form-group">
            <label for="maxClips">Max Clips to Generate</label>
            <select id="maxClips">
              <option value="1">1 Top Viral Clip</option>
              <option value="3" selected>3 Viral Clips</option>
              <option value="5">5 Viral Clips</option>
              <option value="0">All Identified Clips</option>
            </select>
          </div>
        </div>

        <button class="btn-primary" id="startBtn" onclick="startPipeline()">
          <span>🚀</span>
          <span>Generate Viral Vertical Reels</span>
        </button>

        <div class="stages">
          <div class="stage-pill" id="stg-DOWNLOAD">1. Download</div>
          <div class="stage-pill" id="stg-TRANSCRIBE">2. Transcribe</div>
          <div class="stage-pill" id="stg-IDENTIFY_CLIPS">3. AI Hooks</div>
          <div class="stage-pill" id="stg-EXTRACT_CLIPS">4. Extract</div>
          <div class="stage-pill" id="stg-REMOVE_SILENCE">5. Desilence</div>
          <div class="stage-pill" id="stg-GENERATE_CAPTIONS">6. Captions</div>
          <div class="stage-pill" id="stg-COMPOSE_REEL">7. Compose</div>
        </div>

        <div class="log-box" id="logs">Ready. Enter YouTube URL and click Generate.</div>
      </div>

      <div class="card" style="margin-top: 2rem;">
        <h2>🔥 Discovered Viral Clips & Reels</h2>
        <div id="clipsContainer" class="clips-grid">
          <div style="color: var(--text-muted); font-size: 0.9rem; grid-column: 1/-1;">
            Generated clips will appear here with viral scores and download buttons.
          </div>
        </div>
      </div>
    </div>

    <div>
      <div class="card">
        <h2>📱 Reel Preview</h2>
        <div class="video-player-container">
          <video id="player" controls autoplay muted loop>
            <source id="playerSrc" src="" type="video/mp4">
          </video>
        </div>
        <div style="text-align: center; margin-top: 1rem;">
          <a id="downloadLink" href="#" download style="display: none; color: #a5b4fc; text-decoration: none; font-weight: 700; font-size: 0.9rem;">
            ⬇️ Download Vertical MP4
          </a>
        </div>
      </div>

      <div class="card" style="margin-top: 1.5rem;">
        <h2>📜 Past Pipeline Runs</h2>
        <div class="runs-list" id="runsList">
          <div style="color: var(--text-muted); font-size: 0.85rem;">Loading runs...</div>
        </div>
      </div>
    </div>
  </main>

  <script>
    let activeRunId = null;
    let pollInterval = null;

    async function loadPastRuns() {
      try {
        const res = await fetch('/api/runs');
        const runs = await res.json();
        const container = document.getElementById('runsList');
        if (runs.length === 0) {
          container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem;">No runs yet.</div>';
          return;
        }
        container.innerHTML = runs.map(r => \`
          <div class="run-item" onclick="loadRun('\${r.id}')">
            <div class="run-title">\${r.videoTitle || r.videoId || 'Video'}</div>
            <div class="run-status">
              <span>\${r.status.toUpperCase()}</span>
              <span>\${r.currentStage}</span>
            </div>
          </div>
        \`).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function startPipeline() {
      const url = document.getElementById('url').value;
      const layout = document.getElementById('layout').value;
      const maxClips = parseInt(document.getElementById('maxClips').value);
      const btn = document.getElementById('startBtn');

      if (!url) return alert('Please enter a YouTube URL');

      btn.disabled = true;
      btn.innerHTML = '<span>⏳</span><span>Processing Pipeline...</span>';

      try {
        const res = await fetch('/api/pipeline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, layout, maxClips })
        });
        const data = await res.json();
        if (data.runId) {
          activeRunId = data.runId;
          startPolling(activeRunId);
        } else {
          alert(data.error || 'Failed to start');
          btn.disabled = false;
        }
      } catch (err) {
        alert(err);
        btn.disabled = false;
      }
    }

    function startPolling(runId) {
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(async () => {
        try {
          const res = await fetch('/api/status/' + runId);
          const data = await res.json();
          updateUI(data);
          if (data.status === 'completed' || data.status === 'failed') {
            clearInterval(pollInterval);
            document.getElementById('startBtn').disabled = false;
            document.getElementById('startBtn').innerHTML = '<span>🚀</span><span>Generate Viral Vertical Reels</span>';
            loadPastRuns();
          }
        } catch (e) {
          console.error(e);
        }
      }, 2000);
    }

    function updateUI(data) {
      const stages = ['DOWNLOAD', 'TRANSCRIBE', 'IDENTIFY_CLIPS', 'EXTRACT_CLIPS', 'REMOVE_SILENCE', 'GENERATE_CAPTIONS', 'COMPOSE_REEL'];
      const currentIndex = stages.indexOf(data.currentStage);

      stages.forEach((stg, i) => {
        const el = document.getElementById('stg-' + stg);
        if (!el) return;
        el.className = 'stage-pill';
        if (i < currentIndex || data.status === 'completed') el.classList.add('completed');
        else if (i === currentIndex && data.status === 'running') el.classList.add('active');
      });

      if (data.logs && data.logs.length) {
        document.getElementById('logs').innerText = data.logs.join('\\n');
        document.getElementById('logs').scrollTop = document.getElementById('logs').scrollHeight;
      }

      if (data.clips && data.clips.length) {
        const container = document.getElementById('clipsContainer');
        container.innerHTML = data.clips.map(c => \`
          <div class="clip-card">
            <div class="clip-header">
              <span class="viral-badge">⚡ Score \${c.viralScore || 9}/10</span>
              <span style="font-size: 0.75rem; color: var(--text-muted);">\${Math.round(c.duration || (c.endTime - c.startTime))}s</span>
            </div>
            <div class="clip-title">\${c.title}</div>
            <div class="clip-hook">"\${c.hookLine || c.title}"</div>
            <div class="clip-meta">
              <span>\${c.startTime}s - \${c.endTime}s</span>
              \${c.videoUrl ? \`<button onclick="playVideo('\${c.videoUrl}')" style="background: var(--accent); color: white; border: none; padding: 0.25rem 0.6rem; border-radius: 6px; cursor: pointer; font-size: 0.75rem;">▶ Watch</button>\` : '<span style="color: var(--text-muted)">Processing...</span>'}
            </div>
          </div>
        \`).join('');
      }
    }

    function playVideo(url) {
      const player = document.getElementById('player');
      const src = document.getElementById('playerSrc');
      const download = document.getElementById('downloadLink');
      src.src = url;
      player.load();
      player.play();
      download.href = url;
      download.style.display = 'inline-block';
    }

    async function loadRun(runId) {
      activeRunId = runId;
      startPolling(runId);
    }

    loadPastRuns();
  </script>
</body>
</html>`;

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }

      if (url.pathname === "/api/runs" && req.method === "GET") {
        const runs = checkpoint.getAllRuns();
        return Response.json(runs);
      }

      if (url.pathname.startsWith("/api/status/")) {
        const runId = url.pathname.replace("/api/status/", "");
        const run = checkpoint.getRunInfo(runId);
        if (!run) return Response.json({ error: "Run not found" }, { status: 404 });

        // Check if clips.json exists in run folder
        const clipsPath = join(config.paths.data, "runs", runId, "clips.json");
        let clips: any[] = [];
        if (await fileExists(clipsPath)) {
          try {
            clips = await Bun.file(clipsPath).json();
            // Attach video URLs if final reels exist
            const outputDir = join(config.paths.output, run.videoId);
            const reelFiles = listFiles(outputDir, ".mp4");
            for (const c of clips) {
              const matchingReel = reelFiles.find((f: string) => f.includes(c.id));
              if (matchingReel) {
                c.videoUrl = `/api/video/${run.videoId}/${c.id}_reel.mp4`;
              }
            }
          } catch {
            // ignore
          }
        }

        return Response.json({
          ...run,
          clips,
          logs:
            activeRunId === runId
              ? activeLog
              : [`Stage: ${run.currentStage}`, `Status: ${run.status}`],
        });
      }

      if (url.pathname.startsWith("/api/video/")) {
        const parts = url.pathname.replace("/api/video/", "").split("/");
        const videoId = parts[0];
        const filename = parts[1];
        const filePath = join(config.paths.output, videoId, filename);
        if (await fileExists(filePath)) {
          return new Response(Bun.file(filePath));
        }
        return new Response("Not found", { status: 404 });
      }

      if (url.pathname === "/api/pipeline" && req.method === "POST") {
        try {
          const body = (await req.json()) as { url: string; layout?: string; maxClips?: number };
          const activeConfig = loadConfig({
            layout: (body.layout as any) || "blur-background",
            maxClips: body.maxClips ?? 3,
          });

          activeOrchestrator = new PipelineOrchestrator(activeConfig, checkpoint);
          activeLog = [`Starting pipeline for: ${body.url}`, `Layout mode: ${activeConfig.layout}`];

          // Run asynchronously in background
          (async () => {
            try {
              activeRunId = await activeOrchestrator!.run(body.url);
              activeLog.push(`Run complete! Run ID: ${activeRunId}`);
            } catch (err) {
              activeLog.push(`Pipeline error: ${err}`);
            }
          })();

          // Extract quick run ID preview
          const videoIdMatch = body.url.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
          const previewId = videoIdMatch ? videoIdMatch[1] : "video";

          return Response.json({ success: true, runId: activeRunId || previewId });
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 });
        }
      }

      return new Response("Not found", { status: 404 });
    },
  });

  log.info(`🎬 Clips Studio running at http://localhost:${server.port}`);
  return server;
}
