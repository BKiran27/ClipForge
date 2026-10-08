import { CheckpointManager } from "../pipeline/checkpoint";
import { PipelineOrchestrator } from "../pipeline/orchestrator";
import { loadConfig, type Config } from "../config";
import { listFiles, fileExists, cleanRunArtifacts } from "../utils/fs";
import { createLogger, subscribeLogs, type LogEntry } from "../utils/logger";
import { getFfmpegBin, getPythonBin, getYtDlpCommand } from "../utils/exec";
import { join } from "path";

const log = createLogger("web-server");

export function startWebServer(port: number = 3000) {
  let config = loadConfig();
  const checkpoint = new CheckpointManager(config.paths.checkpointDb);
  let activeOrchestrator: PipelineOrchestrator | null = null;
  let activeRunId: string | null = null;

  // Run logs buffer (runId -> string[])
  const runLogsMap = new Map<string, string[]>();
  const globalRecentLogs: string[] = [];

  // Subscribe to all pipeline log events across all modules
  subscribeLogs((entry: LogEntry) => {
    const formatted = `[${entry.timestamp}] [${entry.level}] [${entry.module}] ${entry.message}`;
    globalRecentLogs.push(formatted);
    if (globalRecentLogs.length > 200) globalRecentLogs.shift();

    if (activeRunId) {
      let logs = runLogsMap.get(activeRunId);
      if (!logs) {
        logs = [];
        runLogsMap.set(activeRunId, logs);
      }
      logs.push(formatted);
      if (logs.length > 500) logs.shift();
    }
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClipForge Studio - AI Viral Shorts Pipeline</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card: #111827;
      --card-hover: #172133;
      --card-border: #1f293d;
      --accent: #6366f1;
      --accent-hover: #4f46e5;
      --accent-glow: rgba(99, 102, 241, 0.25);
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --text: #f9fafb;
      --text-muted: #94a3b8;
      --font: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
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
      overflow-x: hidden;
    }
    header {
      background: rgba(17, 24, 39, 0.85);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--card-border);
      padding: 0.85rem 2rem;
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
      font-size: 1.3rem;
      font-weight: 900;
      background: linear-gradient(135deg, #a5b4fc, #6366f1, #c084fc);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.02em;
    }
    .badge {
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.35);
      color: #a5b4fc;
      font-size: 0.72rem;
      padding: 0.2rem 0.55rem;
      border-radius: 999px;
      font-weight: 700;
    }
    .nav-actions {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.25rem 0.65rem;
      border-radius: 999px;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: var(--success);
      cursor: pointer;
    }
    .status-pill.warning {
      background: rgba(245, 158, 11, 0.1);
      border-color: rgba(245, 158, 11, 0.3);
      color: var(--warning);
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 0.45rem 0.85rem;
      border-radius: 8px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      transition: all 0.2s;
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: var(--accent);
    }
    main {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2rem 1.5rem;
      width: 100%;
      display: grid;
      grid-template-columns: 1fr 400px;
      gap: 2rem;
      flex: 1;
    }
    @media (max-width: 1080px) {
      main { grid-template-columns: 1fr; }
    }
    .card {
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.75rem;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    }
    h2 {
      font-size: 1.25rem;
      font-weight: 800;
      margin-bottom: 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.6rem;
      letter-spacing: -0.01em;
    }
    .form-group { margin-bottom: 1.25rem; position: relative; }
    label {
      display: block;
      font-size: 0.82rem;
      font-weight: 700;
      color: var(--text-muted);
      margin-bottom: 0.45rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    input[type="text"], select {
      width: 100%;
      padding: 0.85rem 1rem;
      background: #0b1120;
      border: 1px solid var(--card-border);
      border-radius: 10px;
      color: var(--text);
      font-family: var(--font);
      font-size: 0.95rem;
      outline: none;
      transition: all 0.2s;
    }
    input[type="text"]:focus, select:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-glow);
    }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    @media (max-width: 640px) {
      .row { grid-template-columns: 1fr; }
    }
    .video-preview-hint {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-top: 0.6rem;
      padding: 0.6rem;
      background: #0b1120;
      border-radius: 8px;
      border: 1px solid var(--card-border);
    }
    .video-preview-thumb {
      width: 68px;
      height: 48px;
      object-fit: cover;
      border-radius: 6px;
      background: #1e293b;
    }
    .quick-examples {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
      flex-wrap: wrap;
    }
    .quick-chip {
      font-size: 0.72rem;
      padding: 0.2rem 0.5rem;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.2s;
    }
    .quick-chip:hover {
      color: #a5b4fc;
      border-color: var(--accent);
      background: rgba(99, 102, 241, 0.1);
    }
    button.btn-primary {
      width: 100%;
      padding: 1rem;
      background: linear-gradient(135deg, #6366f1, #4f46e5);
      border: none;
      border-radius: 12px;
      color: white;
      font-family: var(--font);
      font-size: 1.05rem;
      font-weight: 800;
      cursor: pointer;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 0.6rem;
      box-shadow: 0 8px 20px rgba(99, 102, 241, 0.35);
      transition: all 0.2s;
    }
    button.btn-primary:hover:not(:disabled) {
      opacity: 0.95;
      transform: translateY(-2px);
      box-shadow: 0 12px 28px rgba(99, 102, 241, 0.45);
    }
    button.btn-primary:active:not(:disabled) { transform: translateY(0); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    
    .stages-container {
      margin-top: 1.75rem;
      background: #0b1120;
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 1.25rem;
    }
    .stages-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.85rem;
      font-size: 0.85rem;
      font-weight: 700;
    }
    .stages {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 0.6rem;
    }
    .stage-pill {
      background: #111827;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 0.65rem 0.5rem;
      text-align: center;
      font-size: 0.72rem;
      font-weight: 700;
      color: var(--text-muted);
      transition: all 0.3s;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .stage-pill.active {
      border-color: var(--accent);
      color: #a5b4fc;
      background: rgba(99, 102, 241, 0.15);
      box-shadow: 0 0 15px var(--accent-glow);
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    .stage-pill.completed {
      border-color: var(--success);
      color: var(--success);
      background: rgba(16, 185, 129, 0.12);
    }
    .stage-pill.failed {
      border-color: var(--danger);
      color: var(--danger);
      background: rgba(239, 68, 68, 0.12);
    }

    .log-box-wrapper {
      margin-top: 1.25rem;
    }
    .log-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.4rem;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .log-box {
      font-family: var(--mono);
      font-size: 0.75rem;
      line-height: 1.5;
      background: #060911;
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 0.85rem;
      height: 190px;
      overflow-y: auto;
      color: #94a3b8;
      white-space: pre-wrap;
    }
    .log-box::-webkit-scrollbar { width: 6px; }
    .log-box::-webkit-scrollbar-track { background: #060911; }
    .log-box::-webkit-scrollbar-thumb { background: #1f293d; border-radius: 3px; }

    .clips-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1.25rem;
      margin-top: 1rem;
    }
    .clip-card {
      background: #0b1120;
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      transition: transform 0.2s, border-color 0.2s;
    }
    .clip-card:hover {
      border-color: var(--accent);
      transform: translateY(-2px);
    }
    .clip-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .viral-badge {
      background: linear-gradient(135deg, #f59e0b, #ef4444);
      color: white;
      font-size: 0.72rem;
      font-weight: 800;
      padding: 0.2rem 0.5rem;
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(245, 158, 11, 0.4);
    }
    .clip-title {
      font-size: 0.95rem;
      font-weight: 700;
      line-height: 1.3;
    }
    .clip-hook {
      font-size: 0.8rem;
      color: #cbd5e1;
      font-style: italic;
      background: rgba(255, 255, 255, 0.04);
      padding: 0.6rem;
      border-radius: 6px;
      border-left: 3px solid var(--accent);
    }
    .clip-meta {
      font-size: 0.75rem;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: auto;
    }
    .clip-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }
    .btn-action {
      flex: 1;
      padding: 0.45rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 700;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.3rem;
      transition: opacity 0.2s;
    }
    .btn-action.play {
      background: var(--accent);
      color: white;
    }
    .btn-action.dl {
      background: rgba(16, 185, 129, 0.15);
      color: var(--success);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    /* Right column: 9:16 Video Mockup Player */
    .phone-mockup {
      width: 100%;
      max-width: 320px;
      aspect-ratio: 9/16;
      background: #000;
      border: 8px solid #1e293b;
      border-radius: 36px;
      margin: 0 auto;
      overflow: hidden;
      position: relative;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .phone-notch {
      position: absolute;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
      width: 110px;
      height: 18px;
      background: #1e293b;
      border-bottom-left-radius: 12px;
      border-bottom-right-radius: 12px;
      z-index: 10;
    }
    video#player {
      width: 100%;
      height: 100%;
      object-fit: cover;
      background: #000;
    }
    .player-placeholder {
      position: absolute;
      text-align: center;
      padding: 1.5rem;
      color: var(--text-muted);
      font-size: 0.85rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
    }

    .runs-list {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      max-height: 440px;
      overflow-y: auto;
    }
    .run-item {
      padding: 0.85rem;
      background: #0b1120;
      border: 1px solid var(--card-border);
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .run-item:hover {
      border-color: var(--accent);
      background: #111827;
    }
    .run-title {
      font-weight: 700;
      font-size: 0.85rem;
      margin-bottom: 0.2rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 250px;
    }
    .run-sub {
      font-size: 0.72rem;
      color: var(--text-muted);
      display: flex;
      gap: 0.5rem;
    }
    .run-badge {
      font-size: 0.68rem;
      font-weight: 700;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .run-badge.completed { background: rgba(16, 185, 129, 0.15); color: var(--success); }
    .run-badge.running { background: rgba(99, 102, 241, 0.15); color: #a5b4fc; }
    .run-badge.failed { background: rgba(239, 68, 68, 0.15); color: var(--danger); }

    /* Modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 100;
      padding: 1rem;
    }
    .modal-box {
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 2rem;
      width: 100%;
      max-width: 480px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
    }
    .toast {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      background: #111827;
      border: 1px solid var(--accent);
      color: white;
      padding: 0.85rem 1.25rem;
      border-radius: 10px;
      font-size: 0.85rem;
      font-weight: 600;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
      z-index: 200;
      display: none;
      align-items: center;
      gap: 0.5rem;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <span>🎬</span>
      <span>ClipForge Studio</span>
      <span class="badge">v2.0 Pro</span>
    </div>
    <div class="nav-actions">
      <div id="aiStatusPill" class="status-pill" onclick="openSettingsModal()">
        <span>●</span>
        <span id="aiStatusText">Checking AI...</span>
      </div>
      <button class="btn-secondary" onclick="openSettingsModal()">
        <span>⚙️</span>
        <span>Settings</span>
      </button>
      <a href="https://github.com/BKiran27/ClipForge" target="_blank" class="btn-secondary" style="text-decoration: none;">
        <span>⭐</span>
        <span>GitHub</span>
      </a>
    </div>
  </header>

  <main>
    <div>
      <!-- Pipeline Generator Form -->
      <div class="card">
        <h2>⚡ Convert Long Video into Viral Vertical Clips</h2>
        <div class="form-group">
          <label for="url">YouTube Video URL</label>
          <input type="text" id="url" placeholder="https://www.youtube.com/watch?v=..." value="https://www.youtube.com/watch?v=dQw4w9WgXcQ" oninput="handleUrlChange()">
          
          <div class="quick-examples">
            <span style="font-size: 0.72rem; color: var(--text-muted); align-self: center;">Examples:</span>
            <span class="quick-chip" onclick="setUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')">Rick Astley</span>
            <span class="quick-chip" onclick="setUrl('https://www.youtube.com/watch?v=kGgD_p7jFvE')">Huberman Podcast</span>
            <span class="quick-chip" onclick="setUrl('https://www.youtube.com/watch?v=21X5lGlDOfg')">NASA Documentary</span>
          </div>

          <div id="thumbPreview" class="video-preview-hint" style="display: none;">
            <img id="thumbImg" class="video-preview-thumb" src="" alt="Thumbnail">
            <div>
              <div id="thumbVideoId" style="font-weight: 700; font-size: 0.85rem;"></div>
              <div style="font-size: 0.72rem; color: var(--text-muted);">Verified YouTube video stream</div>
            </div>
          </div>
        </div>

        <div class="row">
          <div class="form-group">
            <label for="layout">Vertical Composition Layout</label>
            <select id="layout">
              <option value="blur-background" selected>✨ Blur Background (Studio Standard)</option>
              <option value="split-screen">🎮 Split-Screen (Gameplay Overlay)</option>
              <option value="center-crop">📐 Center Crop 9:16 (Portrait Focus)</option>
            </select>
          </div>
          <div class="form-group">
            <label for="captionTheme">Viral Caption Style</label>
            <select id="captionTheme">
              <option value="hormozi" selected>🟨 Hormozi Pop (Yellow / Black Stroke)</option>
              <option value="mrbeast">🟩 MrBeast Pulse (Green Dynamic Zoom)</option>
              <option value="neon">🟦 Cyberpunk Neon (Cyan & Pink Glow)</option>
              <option value="minimal">⬜ Minimalist Clean (Sleek Subtitles)</option>
            </select>
          </div>
        </div>

        <div class="row">
          <div class="form-group">
            <label for="speed">Pacing & Clip Speed</label>
            <select id="speed">
              <option value="1.0">1.0x Normal (Natural Speed)</option>
              <option value="1.1">1.1x Engaging (Fast-paced)</option>
              <option value="1.2" selected>1.2x Viral Standard (Recommended)</option>
              <option value="1.3">1.3x High Intensity</option>
            </select>
          </div>
          <div class="form-group">
            <label for="maxClips">Max Clips to Extract</label>
            <select id="maxClips">
              <option value="1">1 Top Virality Clip</option>
              <option value="3" selected>3 High Retention Clips (Recommended)</option>
              <option value="5">5 Complete Reel Series</option>
              <option value="0">All Identified Clips</option>
            </select>
          </div>
        </div>

        <button class="btn-primary" id="startBtn" onclick="startPipeline()">
          <span>🚀</span>
          <span>Generate Viral Vertical Reels</span>
        </button>

        <!-- Stage Tracker -->
        <div class="stages-container">
          <div class="stages-header">
            <span>PIPELINE ENGINE PROGRESS</span>
            <span id="pipelineTimer" style="color: var(--accent); font-family: var(--mono);">00:00</span>
          </div>
          <div class="stages">
            <div class="stage-pill" id="stg-DOWNLOAD">
              <span>Stage 1</span>
              <span>📥 Download</span>
            </div>
            <div class="stage-pill" id="stg-TRANSCRIBE">
              <span>Stage 2</span>
              <span>📝 Transcribe</span>
            </div>
            <div class="stage-pill" id="stg-IDENTIFY_CLIPS">
              <span>Stage 3</span>
              <span>🧠 AI Hooks</span>
            </div>
            <div class="stage-pill" id="stg-EXTRACT_CLIPS">
              <span>Stage 4</span>
              <span>✂️ Extract</span>
            </div>
            <div class="stage-pill" id="stg-REMOVE_SILENCE">
              <span>Stage 5</span>
              <span>🔇 Desilence</span>
            </div>
            <div class="stage-pill" id="stg-GENERATE_CAPTIONS">
              <span>Stage 6</span>
              <span>💬 Captions</span>
            </div>
            <div class="stage-pill" id="stg-COMPOSE_REEL">
              <span>Stage 7</span>
              <span>📱 Compose</span>
            </div>
          </div>
        </div>

        <!-- Terminal Logs -->
        <div class="log-box-wrapper">
          <div class="log-toolbar">
            <span>REAL-TIME TERMINAL OUTPUT</span>
            <div style="display: flex; gap: 0.5rem;">
              <button class="quick-chip" onclick="copyLogs()">📋 Copy</button>
              <button class="quick-chip" onclick="clearLogs()">Clear</button>
            </div>
          </div>
          <div class="log-box" id="logs">ClipForge Studio ready. Enter YouTube URL and click Generate to start.</div>
        </div>
      </div>

      <!-- Discovered Clips Grid -->
      <div class="card" style="margin-top: 2rem;">
        <h2>🔥 Discovered Viral Clips & Reels</h2>
        <div id="clipsContainer" class="clips-grid">
          <div style="color: var(--text-muted); font-size: 0.9rem; grid-column: 1/-1; text-align: center; padding: 2rem 0;">
            No clips generated for this session yet. Start a run above to extract clips!
          </div>
        </div>
      </div>
    </div>

    <!-- Right Column: Vertical Player & History -->
    <div>
      <div class="card">
        <h2>📱 Vertical Reel Player</h2>
        <div class="phone-mockup">
          <div class="phone-notch"></div>
          <video id="player" controls autoplay muted loop playsinline style="display: none;">
            <source id="playerSrc" src="" type="video/mp4">
          </video>
          <div id="playerPlaceholder" class="player-placeholder">
            <span style="font-size: 2.5rem;">🎬</span>
            <span>Select any clip or run the pipeline to preview 9:16 vertical reel</span>
          </div>
        </div>

        <div id="reelActions" style="margin-top: 1.25rem; display: none;">
          <a id="downloadBtn" href="#" class="btn-primary" style="text-decoration: none; font-size: 0.95rem;">
            <span>⬇️</span>
            <span>Download 1080x1920 MP4</span>
          </a>
          <div id="nowPlayingTitle" style="font-size: 0.82rem; font-weight: 700; text-align: center; margin-top: 0.6rem; color: #a5b4fc;"></div>
        </div>
      </div>

      <!-- Past Runs History -->
      <div class="card" style="margin-top: 1.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h2 style="margin-bottom: 0;">📜 Run History</h2>
          <button class="quick-chip" onclick="loadPastRuns()">🔄 Refresh</button>
        </div>
        <div class="runs-list" id="runsList">
          <div style="color: var(--text-muted); font-size: 0.85rem;">Loading runs...</div>
        </div>
      </div>
    </div>
  </main>

  <!-- Settings Modal -->
  <div id="settingsModal" class="modal-overlay">
    <div class="modal-box">
      <h2>⚙️ System & AI Settings</h2>
      <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.25rem;">
        Configure your Google Gemini API key and pipeline preferences.
      </p>

      <div class="form-group">
        <label for="apiKeyInput">Google Gemini API Key</label>
        <input type="text" id="apiKeyInput" placeholder="AIzaSy...">
        <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.3rem;">
          Get a free API key at <a href="https://aistudio.google.com/" target="_blank" style="color: var(--accent);">Google AI Studio</a>.
        </div>
      </div>

      <div style="display: flex; gap: 0.75rem; justify-content: flex-end; margin-top: 1.5rem;">
        <button class="btn-secondary" onclick="closeSettingsModal()">Cancel</button>
        <button class="btn-primary" style="width: auto; padding: 0.6rem 1.2rem;" onclick="saveSettings()">Save & Connect</button>
      </div>
    </div>
  </div>

  <div id="toast" class="toast">
    <span id="toastIcon">✅</span>
    <span id="toastMsg">Notification</span>
  </div>

  <script>
    let activeRunId = null;
    let pollInterval = null;
    let timerInterval = null;
    let secondsElapsed = 0;

    async function checkHealth() {
      try {
        const res = await fetch('/api/health');
        const data = await res.json();
        const pill = document.getElementById('aiStatusPill');
        const text = document.getElementById('aiStatusText');
        if (data.gemini) {
          pill.className = 'status-pill';
          text.innerText = 'Gemini AI Connected';
        } else {
          pill.className = 'status-pill warning';
          text.innerText = 'Gemini Key Needed';
        }
      } catch {
        // ignore
      }
    }

    function setUrl(url) {
      document.getElementById('url').value = url;
      handleUrlChange();
    }

    function handleUrlChange() {
      const url = document.getElementById('url').value.trim();
      const match = url.match(/(?:v=|\\/shorts\\/|youtu\\.be\\/)([a-zA-Z0-9_-]{11})/);
      const hint = document.getElementById('thumbPreview');
      if (match) {
        const id = match[1];
        document.getElementById('thumbImg').src = 'https://img.youtube.com/vi/' + id + '/mqdefault.jpg';
        document.getElementById('thumbVideoId').innerText = 'YouTube Video ID: ' + id;
        hint.style.display = 'flex';
      } else {
        hint.style.display = 'none';
      }
    }

    async function loadPastRuns() {
      try {
        const res = await fetch('/api/runs');
        const runs = await res.json();
        const container = document.getElementById('runsList');
        if (!runs || runs.length === 0) {
          container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; padding: 1rem 0; text-align: center;">No pipeline runs recorded yet.</div>';
          return;
        }
        container.innerHTML = runs.map(r => {
          const statusClass = r.status === 'completed' ? 'completed' : r.status === 'running' ? 'running' : 'failed';
          return \`
            <div class="run-item" onclick="loadRun('\${r.id}')">
              <div style="flex: 1; min-width: 0;">
                <div class="run-title">\${r.videoTitle || r.videoId || 'Video'}</div>
                <div class="run-sub">
                  <span>\${new Date(r.createdAt).toLocaleDateString()}</span>
                  <span>•</span>
                  <span>\${r.currentStage}</span>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span class="run-badge \${statusClass}">\${r.status}</span>
                <button class="quick-chip" onclick="event.stopPropagation(); deleteRun('\${r.id}')" title="Delete run">🗑️</button>
              </div>
            </div>
          \`;
        }).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function deleteRun(runId) {
      if (!confirm('Are you sure you want to delete this run and its video artifacts?')) return;
      try {
        await fetch('/api/runs/' + runId, { method: 'DELETE' });
        showToast('Run deleted successfully');
        loadPastRuns();
        if (activeRunId === runId) {
          clearInterval(pollInterval);
          activeRunId = null;
        }
      } catch (err) {
        showToast('Failed to delete run: ' + err, true);
      }
    }

    async function startPipeline() {
      const url = document.getElementById('url').value.trim();
      const layout = document.getElementById('layout').value;
      const captionTheme = document.getElementById('captionTheme').value;
      const speed = parseFloat(document.getElementById('speed').value);
      const maxClips = parseInt(document.getElementById('maxClips').value, 10);
      const btn = document.getElementById('startBtn');

      if (!url) return showToast('Please enter a YouTube video URL', true);

      btn.disabled = true;
      btn.innerHTML = '<span>⏳</span><span>Starting Pipeline Engine...</span>';

      startTimer();

      try {
        const res = await fetch('/api/pipeline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, layout, captionTheme, speed, maxClips })
        });
        const data = await res.json();
        if (data.runId) {
          activeRunId = data.runId;
          showToast('Pipeline initiated! Run ID: ' + activeRunId.slice(0, 8));
          startPolling(activeRunId);
        } else {
          showToast(data.error || 'Failed to start pipeline', true);
          btn.disabled = false;
          btn.innerHTML = '<span>🚀</span><span>Generate Viral Vertical Reels</span>';
          stopTimer();
        }
      } catch (err) {
        showToast('Error: ' + err, true);
        btn.disabled = false;
        btn.innerHTML = '<span>🚀</span><span>Generate Viral Vertical Reels</span>';
        stopTimer();
      }
    }

    function startTimer() {
      secondsElapsed = 0;
      if (timerInterval) clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        secondsElapsed++;
        const mins = String(Math.floor(secondsElapsed / 60)).padStart(2, '0');
        const secs = String(secondsElapsed % 60).padStart(2, '0');
        document.getElementById('pipelineTimer').innerText = \`\${mins}:\${secs}\`;
      }, 1000);
    }

    function stopTimer() {
      if (timerInterval) clearInterval(timerInterval);
    }

    function startPolling(runId) {
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(async () => {
        try {
          const res = await fetch('/api/status/' + runId);
          if (!res.ok) return;
          const data = await res.json();
          updateUI(data);
          if (data.status === 'completed' || data.status === 'failed') {
            clearInterval(pollInterval);
            stopTimer();
            const btn = document.getElementById('startBtn');
            btn.disabled = false;
            btn.innerHTML = '<span>🚀</span><span>Generate Viral Vertical Reels</span>';
            loadPastRuns();
            if (data.status === 'completed') {
              showToast('🎉 All clips generated and ready to download!');
            } else {
              showToast('Pipeline failed. Check terminal logs.', true);
            }
          }
        } catch (e) {
          console.error(e);
        }
      }, 1500);
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
        else if (i === currentIndex && data.status === 'failed') el.classList.add('failed');
      });

      if (data.logs && data.logs.length) {
        const logBox = document.getElementById('logs');
        logBox.innerText = data.logs.join('\\n');
        logBox.scrollTop = logBox.scrollHeight;
      }

      if (data.clips && data.clips.length) {
        const container = document.getElementById('clipsContainer');
        container.innerHTML = data.clips.map((c, idx) => {
          const dur = Math.round(c.duration || (c.endTime - c.startTime));
          const startM = Math.floor(c.startTime / 60);
          const startS = Math.floor(c.startTime % 60);
          const endM = Math.floor(c.endTime / 60);
          const endS = Math.floor(c.endTime % 60);
          const timeFormatted = \`\${String(startM).padStart(2,'0')}:\${String(startS).padStart(2,'0')} - \${String(endM).padStart(2,'0')}:\${String(endS).padStart(2,'0')}\`;
          
          return \`
            <div class="clip-card">
              <div class="clip-header">
                <span class="viral-badge">🔥 Virality \${c.viralScore || 9}/10</span>
                <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700;">⏱️ \${dur}s</span>
              </div>
              <div class="clip-title">\${c.title}</div>
              <div class="clip-hook">"\${c.hookLine || c.title}"</div>
              <div class="clip-meta">
                <span>\${timeFormatted}</span>
                <span style="color: #a5b4fc; font-weight: 600;">Clip #\${idx + 1}</span>
              </div>
              <div class="clip-actions">
                \${c.videoUrl 
                  ? \`
                    <button class="btn-action play" onclick="playVideo('\${c.videoUrl}', '\${c.title.replace(/'/g, "\\\\'")}')">▶ Watch</button>
                    <a class="btn-action dl" href="\${c.downloadUrl || c.videoUrl + '?download=1'}" download style="text-decoration: none;">⬇ Download</a>
                    <button class="btn-action" style="background: rgba(255,255,255,0.06); color: var(--text);" onclick="copyLink('\${location.origin}\${c.videoUrl}')">📋 Link</button>
                  \`
                  : '<div style="font-size: 0.75rem; color: var(--text-muted); width: 100%; text-align: center; padding: 0.3rem 0;">⏳ Processing Reel...</div>'
                }
              </div>
            </div>
          \`;
        }).join('');

        // If video player is empty and first clip is ready, auto-load first clip
        const firstReady = data.clips.find(c => c.videoUrl);
        const player = document.getElementById('player');
        if (firstReady && player.style.display === 'none') {
          playVideo(firstReady.videoUrl, firstReady.title);
        }
      }
    }

    function playVideo(url, title) {
      const player = document.getElementById('player');
      const placeholder = document.getElementById('playerPlaceholder');
      const src = document.getElementById('playerSrc');
      const actions = document.getElementById('reelActions');
      const download = document.getElementById('downloadBtn');
      const titleEl = document.getElementById('nowPlayingTitle');

      src.src = url;
      player.style.display = 'block';
      placeholder.style.display = 'none';
      actions.style.display = 'block';
      download.href = url + (url.includes('?') ? '&download=1' : '?download=1');
      titleEl.innerText = title || 'Vertical Reel Preview';

      player.load();
      player.play().catch(() => {});
    }

    function loadRun(runId) {
      activeRunId = runId;
      startPolling(runId);
      showToast('Loaded run ' + runId.slice(0, 8));
    }

    function copyLink(url) {
      navigator.clipboard.writeText(url);
      showToast('Video link copied to clipboard!');
    }

    function copyLogs() {
      const text = document.getElementById('logs').innerText;
      navigator.clipboard.writeText(text);
      showToast('Logs copied to clipboard!');
    }

    function clearLogs() {
      document.getElementById('logs').innerText = 'Logs cleared.';
    }

    function showToast(msg, isError) {
      const t = document.getElementById('toast');
      const icon = document.getElementById('toastIcon');
      const text = document.getElementById('toastMsg');
      icon.innerText = isError ? '⚠️' : '✅';
      text.innerText = msg;
      t.style.display = 'flex';
      setTimeout(() => { t.style.display = 'none'; }, 3500);
    }

    function openSettingsModal() {
      document.getElementById('settingsModal').style.display = 'flex';
    }

    function closeSettingsModal() {
      document.getElementById('settingsModal').style.display = 'none';
    }

    async function saveSettings() {
      const key = document.getElementById('apiKeyInput').value.trim();
      if (!key) return showToast('Please enter an API key', true);
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ geminiApiKey: key })
        });
        const data = await res.json();
        if (data.success) {
          showToast('API Key saved and verified!');
          closeSettingsModal();
          checkHealth();
        } else {
          showToast(data.error || 'Failed to save', true);
        }
      } catch (err) {
        showToast('Error saving: ' + err, true);
      }
    }

    // Init
    handleUrlChange();
    checkHealth();
    loadPastRuns();
  </script>
</body>
</html>`;

  const listenPort = parseInt(process.env.PORT || String(port), 10);
  const server = Bun.serve({
    port: listenPort,
    hostname: "0.0.0.0",
    async fetch(req) {
      const url = new URL(req.url);

      // 1. Static HTML Frontend
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }

      // 2. Health Check
      if (url.pathname === "/api/health" && req.method === "GET") {
        const ffmpegBin = await getFfmpegBin();
        const pythonBin = await getPythonBin();
        const ytCmd = await getYtDlpCommand();
        return Response.json({
          status: "healthy",
          gemini: Boolean(config.geminiApiKey && config.geminiApiKey.length > 5),
          ffmpeg: ffmpegBin,
          python: pythonBin,
          ytDlp: ytCmd.join(" "),
          port: listenPort,
        });
      }

      // 3. Config Get & Update
      if (url.pathname === "/api/config" && req.method === "GET") {
        return Response.json({
          hasApiKey: Boolean(config.geminiApiKey),
          geminiModel: config.geminiModel,
          layout: config.layout,
          captionTheme: config.captionTheme,
          clipSpeed: config.clipSpeed,
        });
      }

      if (url.pathname === "/api/config" && req.method === "POST") {
        try {
          const body = (await req.json()) as Partial<Config>;
          if (body.geminiApiKey) {
            process.env.GEMINI_API_KEY = body.geminiApiKey;
            config = loadConfig({ geminiApiKey: body.geminiApiKey });
          }
          return Response.json({ success: true });
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 400 });
        }
      }

      // 4. List Past Pipeline Runs
      if (url.pathname === "/api/runs" && req.method === "GET") {
        const runs = checkpoint.getAllRuns();
        return Response.json(runs);
      }

      // 5. Delete Run
      if (url.pathname.startsWith("/api/runs/") && req.method === "DELETE") {
        const runId = url.pathname.replace("/api/runs/", "");
        try {
          cleanRunArtifacts(config.paths.data, runId, false);
          checkpoint.deleteRun(runId);
          return Response.json({ success: true, deleted: runId });
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 });
        }
      }

      // 6. Detailed Status of a Run
      if (url.pathname.startsWith("/api/status/")) {
        const runId = url.pathname.replace("/api/status/", "");
        const run = checkpoint.getRunInfo(runId);
        if (!run) return Response.json({ error: "Run not found" }, { status: 404 });

        // Retrieve clips and attach video streaming links
        const clipsPath = join(config.paths.data, "runs", runId, "clips.json");
        let clips: any[] = [];
        if (await fileExists(clipsPath)) {
          try {
            clips = await Bun.file(clipsPath).json();
            const outputDir = join(config.paths.output, run.videoId);
            const reelFiles = listFiles(outputDir, ".mp4");
            for (const c of clips) {
              const matchingReel = reelFiles.find((f: string) => f.includes(c.id));
              if (matchingReel) {
                c.videoUrl = `/api/video/${run.videoId}/${c.id}_reel.mp4`;
                c.downloadUrl = `/api/video/${run.videoId}/${c.id}_reel.mp4?download=1`;
              }
            }
          } catch {
            // ignore
          }
        }

        const stages = checkpoint.getAllStageResults(runId);
        const logs = runLogsMap.get(runId) || globalRecentLogs;

        return Response.json({
          ...run,
          stages,
          clips,
          logs: logs.length ? logs : [`Stage: ${run.currentStage}`, `Status: ${run.status}`],
        });
      }

      // 7. Stream or Download Video (Byte-Range Supported)
      if (url.pathname.startsWith("/api/video/")) {
        const parts = url.pathname.replace("/api/video/", "").split("/");
        const videoId = parts[0];
        const filename = parts[1];
        const filePath = join(config.paths.output, videoId, filename);

        if (await fileExists(filePath)) {
          const isDownload = url.searchParams.get("download") === "1";
          const headers: Record<string, string> = {
            "Content-Type": "video/mp4",
            "Accept-Ranges": "bytes",
          };
          if (isDownload) {
            headers["Content-Disposition"] = `attachment; filename="${filename}"`;
          } else {
            headers["Content-Disposition"] = "inline";
          }
          return new Response(Bun.file(filePath), { headers });
        }
        return new Response("Not found", { status: 404 });
      }

      // 8. Trigger Pipeline Run (Immediate UUID Return)
      if (url.pathname === "/api/pipeline" && req.method === "POST") {
        try {
          const body = (await req.json()) as {
            url: string;
            layout?: string;
            captionTheme?: string;
            maxClips?: number;
            speed?: number;
            geminiApiKey?: string;
          };

          if (!body.url || typeof body.url !== "string") {
            return Response.json({ error: "A valid YouTube URL is required." }, { status: 400 });
          }

          if (body.geminiApiKey) {
            config = loadConfig({ geminiApiKey: body.geminiApiKey });
          }

          if (!config.geminiApiKey) {
            return Response.json(
              {
                error:
                  "Google Gemini API Key is missing. Please configure it in Settings or set GEMINI_API_KEY environment variable.",
              },
              { status: 400 },
            );
          }

          const activeConfig = loadConfig({
            layout: (body.layout as any) || "blur-background",
            captionTheme: (body.captionTheme as any) || "hormozi",
            maxClips: body.maxClips ?? 3,
            clipSpeed: body.speed ?? 1.2,
          });

          activeOrchestrator = new PipelineOrchestrator(activeConfig, checkpoint);

          // Extract Video ID and create database record IMMEDIATELY to avoid race conditions
          const videoId = activeOrchestrator.extractVideoId(body.url);
          const initialRun = checkpoint.createRun(body.url, videoId, "");
          const runId = initialRun.id;
          activeRunId = runId;

          // Initialize log buffer for this run
          runLogsMap.set(runId, [
            `[${new Date().toLocaleTimeString()}] Pipeline initialized for: ${body.url}`,
            `[${new Date().toLocaleTimeString()}] Layout: ${activeConfig.layout} | Theme: ${activeConfig.captionTheme} | Speed: ${activeConfig.clipSpeed}x`,
          ]);

          // Run asynchronously in background with exact runId
          (async () => {
            try {
              await activeOrchestrator!.run(body.url, undefined, runId);
              log.info(`Run completed: ${runId}`);
            } catch (err) {
              log.error(`Pipeline failure for run ${runId}: ${err}`);
            }
          })();

          return Response.json({ success: true, runId });
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 });
        }
      }

      // 9. Resume Interrupted Run
      if (url.pathname.startsWith("/api/resume/") && req.method === "POST") {
        const runId = url.pathname.replace("/api/resume/", "");
        const run = checkpoint.getRunInfo(runId);
        if (!run) return Response.json({ error: "Run not found" }, { status: 404 });

        activeOrchestrator = new PipelineOrchestrator(config, checkpoint);
        activeRunId = runId;

        (async () => {
          try {
            await activeOrchestrator!.resume(runId);
          } catch (err) {
            log.error(`Resume error: ${err}`);
          }
        })();

        return Response.json({ success: true, runId });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  log.info(`🎬 Clips Studio running at http://localhost:${server.port}`);
  return server;
}
