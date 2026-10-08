import { createLogger } from "../utils/logger";
import { ensureDir } from "../utils/fs";
import { getYtDlpCommand } from "../utils/exec";
import { join } from "path";
import type { VideoMetadata } from "../pipeline/types";

const log = createLogger("downloader");

export class Downloader {
  async download(
    videoUrl: string,
    outputDir: string,
    cookiesBrowser?: string,
  ): Promise<VideoMetadata> {
    ensureDir(outputDir);
    log.info(`Fetching metadata for ${videoUrl}`);

    const ytCmd = await getYtDlpCommand();

    // 1. Fetch metadata
    let metaJson = "";
    let metadataFetched = false;

    // Try with cookies if provided
    if (cookiesBrowser) {
      try {
        const metaProc = Bun.spawn(
          [
            ...ytCmd,
            "--cookies-from-browser",
            cookiesBrowser,
            "--dump-json",
            "--no-download",
            videoUrl,
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        const out = await new Response(metaProc.stdout).text();
        const exit = await metaProc.exited;
        if (exit === 0 && out.trim()) {
          metaJson = out;
          metadataFetched = true;
        }
      } catch {
        log.warn(`Cookies from browser '${cookiesBrowser}' failed, retrying without cookies...`);
      }
    }

    // Standard metadata fetch without cookies
    if (!metadataFetched) {
      const metaProc = Bun.spawn([...ytCmd, "--dump-json", "--no-download", videoUrl], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = await new Response(metaProc.stdout).text();
      const err = await new Response(metaProc.stderr).text();
      const exit = await metaProc.exited;
      if (exit !== 0) throw new Error(`yt-dlp metadata failed: ${err}`);
      metaJson = out;
    }

    const meta = JSON.parse(metaJson);
    const videoId = meta.id as string;
    const title = (meta.title as string) || "untitled";
    const duration = (meta.duration as number) || 0;
    const uploadDate = (meta.upload_date as string) || "";

    const outputPath = join(outputDir, `${videoId}.mp4`);

    if (await Bun.file(outputPath).exists()) {
      log.info(`Video already downloaded: ${outputPath}`);
      return { videoId, title, duration, uploadDate, filePath: outputPath };
    }

    log.info(`Downloading: ${title} (${Math.round(duration / 60)} min)`);

    const dlArgs = [
      ...ytCmd,
      "-f",
      "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
      "--remux-video",
      "mp4",
      "-o",
      outputPath,
      "--no-playlist",
      videoUrl,
    ];

    if (cookiesBrowser) {
      dlArgs.splice(ytCmd.length, 0, "--cookies-from-browser", cookiesBrowser);
    }

    let dlProc = Bun.spawn(dlArgs, {
      stdout: "inherit",
      stderr: "pipe",
    });
    let dlExit = await dlProc.exited;

    // If cookies failed during download, retry without cookies
    if (dlExit !== 0 && cookiesBrowser) {
      log.warn("Download with browser cookies failed. Retrying without cookies...");
      const retryArgs = [
        ...ytCmd,
        "-f",
        "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
        "--remux-video",
        "mp4",
        "-o",
        outputPath,
        "--no-playlist",
        videoUrl,
      ];
      dlProc = Bun.spawn(retryArgs, { stdout: "inherit", stderr: "pipe" });
      dlExit = await dlProc.exited;
    }

    if (dlExit !== 0) {
      const errText = await new Response(dlProc.stderr).text();
      throw new Error(`yt-dlp download failed with exit code ${dlExit}: ${errText}`);
    }

    if (!(await Bun.file(outputPath).exists())) {
      throw new Error(`Download completed but file not found: ${outputPath}`);
    }

    log.info(`Downloaded: ${outputPath}`);
    return { videoId, title, duration, uploadDate, filePath: outputPath };
  }

  async listChannelVideos(channelUrl: string, limit?: number): Promise<string[]> {
    log.info(`Fetching video list from channel: ${channelUrl}`);
    const ytCmd = await getYtDlpCommand();
    const args = [...ytCmd, "--flat-playlist", "--dump-json", "--no-download"];
    if (limit) args.push("--playlist-end", String(limit));
    args.push(channelUrl);

    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const urls: string[] = [];
    for (const line of stdout.trim().split("\n")) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line) as { id?: string; url?: string };
        const id = entry.id || entry.url;
        if (id) {
          const formatted = id.startsWith("http") ? id : `https://www.youtube.com/watch?v=${id}`;
          if (!urls.includes(formatted)) {
            urls.push(formatted);
          }
        }
      } catch {
        // skip malformed lines
      }
    }

    const finalUrls = limit ? urls.slice(0, limit) : urls;
    log.info(`Found ${finalUrls.length} videos`);
    return finalUrls;
  }
}
