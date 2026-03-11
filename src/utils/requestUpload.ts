import type { Request } from "express";

const CRLF = Buffer.from("\r\n");
const DOUBLE_CRLF = Buffer.from("\r\n\r\n");
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

export interface UploadedBinaryFile {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  fields: Record<string, string>;
}

class UploadRequestError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "UploadRequestError";
    this.statusCode = statusCode;
  }
}

const getContentType = (req: Request): string =>
  typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : "";

const parseBoundary = (contentType: string): string | null => {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return match?.[1] ?? match?.[2] ?? null;
};

const splitBuffer = (buffer: Buffer, separator: Buffer): Buffer[] => {
  const chunks: Buffer[] = [];
  let start = 0;

  while (start <= buffer.length) {
    const index = buffer.indexOf(separator, start);
    if (index === -1) {
      chunks.push(buffer.subarray(start));
      break;
    }

    chunks.push(buffer.subarray(start, index));
    start = index + separator.length;
  }

  return chunks;
};

const trimMultipartPart = (value: Buffer): Buffer => {
  let trimmed = value;

  if (trimmed.subarray(0, 2).equals(CRLF)) {
    trimmed = trimmed.subarray(2);
  }

  if (trimmed.subarray(-2).equals(CRLF)) {
    trimmed = trimmed.subarray(0, trimmed.length - 2);
  }

  if (trimmed.subarray(-2).toString("utf8") === "--") {
    trimmed = trimmed.subarray(0, trimmed.length - 2);
  }

  return trimmed;
};

const readRequestBuffer = async (req: Request): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_UPLOAD_SIZE_BYTES) {
        reject(new UploadRequestError("File terlalu besar. Maksimum 10 MB.", 413));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", (error) => reject(error));
  });

const parseMultipartUpload = async (
  req: Request,
  boundary: string,
): Promise<UploadedBinaryFile> => {
  const body = await readRequestBuffer(req);
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(body, boundaryBuffer);
  const fields: Record<string, string> = {};
  let file: UploadedBinaryFile | null = null;

  for (const part of parts) {
    const trimmedPart = trimMultipartPart(part);
    if (trimmedPart.length === 0) {
      continue;
    }

    const headerEnd = trimmedPart.indexOf(DOUBLE_CRLF);
    if (headerEnd === -1) {
      continue;
    }

    const headerText = trimmedPart.subarray(0, headerEnd).toString("utf8");
    const content = trimmedPart.subarray(headerEnd + DOUBLE_CRLF.length);
    const disposition = headerText.match(
      /content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i,
    );

    if (!disposition) {
      continue;
    }

    const fieldName = disposition[1];
    const fileName = disposition[2];
    const mimeType =
      headerText.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() ??
      "application/octet-stream";

    if (fileName) {
      file = {
        buffer: content,
        originalName: fileName,
        mimeType,
        fields,
      };
      continue;
    }

    fields[fieldName] = content.toString("utf8").trim();
  }

  if (!file) {
    throw new UploadRequestError(
      "File .docx tidak ditemukan. Gunakan field multipart bernama `file`.",
    );
  }

  file.fields = fields;
  return file;
};

const parseRawUpload = async (req: Request, contentType: string): Promise<UploadedBinaryFile> => {
  const buffer = await readRequestBuffer(req);

  if (buffer.length === 0) {
    throw new UploadRequestError("Body file upload kosong.");
  }

  const fileNameHeader =
    (typeof req.headers["x-file-name"] === "string" && req.headers["x-file-name"]) ||
    (typeof req.headers["x-filename"] === "string" && req.headers["x-filename"]) ||
    "questions.docx";

  return {
    buffer,
    originalName: fileNameHeader,
    mimeType: contentType || "application/octet-stream",
    fields: {},
  };
};

export const getUploadedBinaryFile = async (req: Request): Promise<UploadedBinaryFile> => {
  const contentType = getContentType(req);

  if (contentType.includes("multipart/form-data")) {
    const boundary = parseBoundary(contentType);
    if (!boundary) {
      throw new UploadRequestError("Boundary multipart/form-data tidak ditemukan.");
    }

    return parseMultipartUpload(req, boundary);
  }

  if (
    contentType.includes(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ) ||
    contentType.includes("application/octet-stream")
  ) {
    return parseRawUpload(req, contentType);
  }

  throw new UploadRequestError(
    "Content-Type tidak didukung. Gunakan multipart/form-data atau kirim file .docx langsung sebagai body request.",
  );
};

export const isUploadRequestError = (
  error: unknown,
): error is UploadRequestError => error instanceof UploadRequestError;
