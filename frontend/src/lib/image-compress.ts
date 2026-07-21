import imageCompression from "browser-image-compression";

const MAX_SIZE_KB = 500;
const MAX_WIDTH = 800;

export async function compressImage(file: File): Promise<File> {
  return imageCompression(file, {
    maxSizeMB: MAX_SIZE_KB / 1024,
    maxWidthOrHeight: MAX_WIDTH,
    useWebWorker: true,
    fileType: "image/jpeg",
    initialQuality: 0.7,
  });
}

export function validateImageFile(file: File): string | null {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) {
    return "仅支持 JPEG / PNG / WebP 格式";
  }
  if (file.size === 0) {
    return "图片文件为空";
  }
  if (file.size > 10 * 1024 * 1024) {
    return "图片大小不能超过 10MB";
  }
  return null;
}
