import { existsSync } from "fs";
import { join } from "path";

let _pythonBin: string | null = null;
let _ffmpegBin: string | null = null;
let _ffprobeBin: string | null = null;
let _ytdlpBin: string[] | null = null;

/**
 * Returns the best Python executable available (python vs python3).
 */
export async function getPythonBin(): Promise<string> {
  if (_pythonBin) return _pythonBin;

  const candidates =
    process.platform === "win32" ? ["python", "python3", "py"] : ["python3", "python"];
  for (const bin of candidates) {
    try {
      const proc = Bun.spawn([bin, "--version"], { stdout: "pipe", stderr: "pipe" });
      const exitCode = await proc.exited;
      if (exitCode === 0) {
        _pythonBin = bin;
        return bin;
      }
    } catch {
      // try next
    }
  }

  // Fallback to default
  _pythonBin = process.platform === "win32" ? "python" : "python3";
  return _pythonBin;
}

/**
 * Returns the path to the ffmpeg executable.
 */
export function getFfmpegBin(): string {
  if (_ffmpegBin) return _ffmpegBin;

  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    _ffmpegBin = process.env.FFMPEG_PATH;
    return _ffmpegBin;
  }

  // Check known paths on Windows / macOS / Linux
  const knownPaths = [
    "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ];

  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const wingetDir = join(process.env.LOCALAPPDATA, "Microsoft/WinGet/Packages");
    // Add possible winget ffmpeg bin
    try {
      const { readdirSync } = require("fs");
      if (existsSync(wingetDir)) {
        const entries = readdirSync(wingetDir) as string[];
        const ffmpegDir = entries.find((e: string) => e.includes("Gyan.FFmpeg"));
        if (ffmpegDir) {
          const sub = readdirSync(join(wingetDir, ffmpegDir)) as string[];
          const fullBuild = sub.find((s: string) => s.includes("full_build"));
          if (fullBuild) {
            const exe = join(wingetDir, ffmpegDir, fullBuild, "bin", "ffmpeg.exe");
            if (existsSync(exe)) knownPaths.unshift(exe);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  for (const p of knownPaths) {
    if (existsSync(p)) {
      _ffmpegBin = p;
      return _ffmpegBin;
    }
  }

  _ffmpegBin = "ffmpeg";
  return _ffmpegBin;
}

/**
 * Returns the path to the ffprobe executable.
 */
export function getFfprobeBin(): string {
  if (_ffprobeBin) return _ffprobeBin;

  if (process.env.FFPROBE_PATH && existsSync(process.env.FFPROBE_PATH)) {
    _ffprobeBin = process.env.FFPROBE_PATH;
    return _ffprobeBin;
  }

  const knownPaths = [
    "/opt/homebrew/opt/ffmpeg-full/bin/ffprobe",
    "/usr/local/bin/ffprobe",
    "/usr/bin/ffprobe",
  ];

  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const wingetDir = join(process.env.LOCALAPPDATA, "Microsoft/WinGet/Packages");
    try {
      const { readdirSync } = require("fs");
      if (existsSync(wingetDir)) {
        const entries = readdirSync(wingetDir) as string[];
        const ffmpegDir = entries.find((e: string) => e.includes("Gyan.FFmpeg"));
        if (ffmpegDir) {
          const sub = readdirSync(join(wingetDir, ffmpegDir)) as string[];
          const fullBuild = sub.find((s: string) => s.includes("full_build"));
          if (fullBuild) {
            const exe = join(wingetDir, ffmpegDir, fullBuild, "bin", "ffprobe.exe");
            if (existsSync(exe)) knownPaths.unshift(exe);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  for (const p of knownPaths) {
    if (existsSync(p)) {
      _ffprobeBin = p;
      return _ffprobeBin;
    }
  }

  _ffprobeBin = "ffprobe";
  return _ffprobeBin;
}

/**
 * Returns the command prefix to run yt-dlp (e.g. ["yt-dlp"] or ["python", "-m", "yt_dlp"]).
 */
export async function getYtDlpCommand(): Promise<string[]> {
  if (_ytdlpBin) return _ytdlpBin;

  // Try yt-dlp binary
  try {
    const proc = Bun.spawn(["yt-dlp", "--version"], { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      _ytdlpBin = ["yt-dlp"];
      return _ytdlpBin;
    }
  } catch {
    // not in path
  }

  // Try python -m yt_dlp
  const py = await getPythonBin();
  try {
    const proc = Bun.spawn([py, "-m", "yt_dlp", "--version"], { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      _ytdlpBin = [py, "-m", "yt_dlp"];
      return _ytdlpBin;
    }
  } catch {
    // not in python
  }

  _ytdlpBin = ["yt-dlp"];
  return _ytdlpBin;
}
