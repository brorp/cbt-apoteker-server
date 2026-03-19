import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { MultipartFormFile } from "../utils/multipartForm.js";

const ALLOWED_MIME_TYPES = new Map<string, string>([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "questions");

export class QuestionImageError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "QuestionImageError";
    this.status = status;
  }
}

const ensureUploadDir = async () => {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
};

export const saveQuestionImage = async (
  file: MultipartFormFile,
): Promise<string> => {
  const extension = ALLOWED_MIME_TYPES.get(file.mimeType.toLowerCase());
  if (!extension) {
    throw new QuestionImageError(
      "Format gambar tidak didukung. Gunakan JPG, PNG, WEBP, atau GIF.",
      400,
    );
  }

  await ensureUploadDir();
  const filename = `${Date.now()}-${randomUUID()}${extension}`;
  const absolutePath = path.join(UPLOAD_DIR, filename);
  await fs.writeFile(absolutePath, file.buffer);

  return `/uploads/questions/${filename}`;
};

export const deleteQuestionImage = async (
  imageUrl: string | null | undefined,
): Promise<void> => {
  if (!imageUrl || !imageUrl.startsWith("/uploads/questions/")) {
    return;
  }

  const filename = imageUrl.replace("/uploads/questions/", "").trim();
  if (!filename) {
    return;
  }

  const absolutePath = path.join(UPLOAD_DIR, filename);
  try {
    await fs.unlink(absolutePath);
  } catch {
    // Ignore missing files to keep delete/update idempotent.
  }
};
