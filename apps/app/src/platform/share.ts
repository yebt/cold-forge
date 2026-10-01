import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export type ShareOutcome = "shared" | "downloaded" | "cancelled";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(blob);
  });
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || /cancel/i.test(e.message));
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Shares a file: native share sheet on device (via a cache file), Web Share with files in
 * supporting browsers, otherwise a download.
 */
export async function shareFile(blob: Blob, filename: string, text?: string): Promise<ShareOutcome> {
  if (Capacitor.isNativePlatform()) {
    try {
      const written = await Filesystem.writeFile({
        path: filename,
        data: await blobToBase64(blob),
        directory: Directory.Cache,
      });
      await Share.share({ files: [written.uri], ...(text ? { text } : {}) });
      return "shared";
    } catch (e) {
      if (isAbort(e)) return "cancelled";
      throw e;
    }
  }

  const file = new File([blob], filename, { type: blob.type });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], ...(text ? { text } : {}) });
      return "shared";
    } catch (e) {
      if (isAbort(e)) return "cancelled";
      // Fall through to download.
    }
  }
  download(blob, filename);
  return "downloaded";
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
