import { inflateRawSync } from "node:zlib";

import type { OptionKey } from "../db/schema.js";

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const WORD_DOCUMENT_XML_PATH = "word/document.xml";
const OPTION_KEYS: OptionKey[] = ["a", "b", "c", "d", "e"];

export interface ImportedQuestionRow {
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  optionE: string;
  correctAnswer: OptionKey;
  explanation: string;
}

export class DocxQuestionImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocxQuestionImportError";
  }
}

const decodeXmlEntities = (value: string): string =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match, dec) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const getMatches = (value: string, expression: RegExp): string[] =>
  Array.from(value.matchAll(expression), (match) => match[0]);

const normalizeText = (value: string): string =>
  value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

const extractParagraphText = (paragraphXml: string): string => {
  const withLineBreaks = paragraphXml
    .replace(/<w:(?:tab)[^>]*\/>/g, "\t")
    .replace(/<w:(?:br|cr)[^>]*\/>/g, "\n");

  const runs = Array.from(
    withLineBreaks.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g),
    (match) => decodeXmlEntities(match[1]),
  );

  return normalizeText(runs.join(""));
};

const extractCellParagraphs = (cellXml: string): string[] =>
  getMatches(cellXml, /<w:p\b[\s\S]*?<\/w:p>/g)
    .map(extractParagraphText)
    .filter((value) => value.length > 0);

const findEndOfCentralDirectoryOffset = (buffer: Buffer): number => {
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return index;
    }
  }

  throw new DocxQuestionImportError(
    "Invalid .docx file. ZIP end-of-central-directory record was not found.",
  );
};

const extractZipEntryText = (buffer: Buffer, entryPath: string): string => {
  const eocdOffset = findEndOfCentralDirectoryOffset(buffer);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);

  let pointer = centralDirectoryOffset;

  for (let entryIndex = 0; entryIndex < totalEntries; entryIndex += 1) {
    if (buffer.readUInt32LE(pointer) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new DocxQuestionImportError(
        "Invalid .docx file. ZIP central directory is corrupted.",
      );
    }

    const compressionMethod = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const fileNameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localHeaderOffset = buffer.readUInt32LE(pointer + 42);
    const fileNameStart = pointer + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const fileName = buffer.toString("utf8", fileNameStart, fileNameEnd);

    if (fileName === entryPath) {
      if (buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
        throw new DocxQuestionImportError(
          "Invalid .docx file. ZIP local file header is corrupted.",
        );
      }

      const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      const compressedData = buffer.subarray(dataStart, dataEnd);

      if (compressionMethod === 0) {
        return compressedData.toString("utf8");
      }

      if (compressionMethod === 8) {
        return inflateRawSync(compressedData).toString("utf8");
      }

      throw new DocxQuestionImportError(
        `Unsupported .docx compression method: ${compressionMethod}.`,
      );
    }

    pointer = fileNameEnd + extraLength + commentLength;
  }

  throw new DocxQuestionImportError(
    "Invalid .docx file. word/document.xml was not found.",
  );
};

const parseAnswerLine = (answerLine: string, rowNumber: number): OptionKey => {
  const match = answerLine.match(/^jawaban\s*:\s*([a-e])\b/i);
  if (!match) {
    throw new DocxQuestionImportError(
      `Row ${rowNumber}: kolom Jawaban harus diawali format "Jawaban: A" sampai "Jawaban: E".`,
    );
  }

  return match[1].toLowerCase() as OptionKey;
};

const parseQuestionRow = (rowXml: string, rowNumber: number): ImportedQuestionRow => {
  const cells = getMatches(rowXml, /<w:tc\b[\s\S]*?<\/w:tc>/g);
  if (cells.length < 3) {
    throw new DocxQuestionImportError(
      `Row ${rowNumber}: template harus memiliki 3 kolom: No, Soal, dan Jawaban.`,
    );
  }

  const questionParagraphs = extractCellParagraphs(cells[1]);
  const answerParagraphs = extractCellParagraphs(cells[2]);

  if (questionParagraphs.length < 6) {
    throw new DocxQuestionImportError(
      `Row ${rowNumber}: kolom Soal harus berisi minimal 1 soal dan 5 opsi jawaban.`,
    );
  }

  if (answerParagraphs.length < 2) {
    throw new DocxQuestionImportError(
      `Row ${rowNumber}: kolom Jawaban harus berisi baris jawaban dan minimal 1 baris pembahasan.`,
    );
  }

  const questionText = questionParagraphs.slice(0, -5).join("\n\n").trim();
  const optionValues = questionParagraphs.slice(-5).map((value) => value.trim());
  const explanation = answerParagraphs.slice(1).join("\n\n").trim();

  if (!questionText) {
    throw new DocxQuestionImportError(`Row ${rowNumber}: teks soal tidak boleh kosong.`);
  }

  if (optionValues.some((value) => value.length === 0)) {
    throw new DocxQuestionImportError(
      `Row ${rowNumber}: semua opsi A sampai E harus terisi.`,
    );
  }

  if (!explanation) {
    throw new DocxQuestionImportError(`Row ${rowNumber}: pembahasan tidak boleh kosong.`);
  }

  const correctAnswer = parseAnswerLine(answerParagraphs[0], rowNumber);
  const optionsByKey = OPTION_KEYS.reduce<Record<OptionKey, string>>((acc, key, index) => {
    acc[key] = optionValues[index];
    return acc;
  }, {} as Record<OptionKey, string>);

  return {
    questionText,
    optionA: optionsByKey.a,
    optionB: optionsByKey.b,
    optionC: optionsByKey.c,
    optionD: optionsByKey.d,
    optionE: optionsByKey.e,
    correctAnswer,
    explanation,
  };
};

export const parseQuestionTemplateDocx = (buffer: Buffer): ImportedQuestionRow[] => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new DocxQuestionImportError("Uploaded .docx file is empty.");
  }

  const documentXml = extractZipEntryText(buffer, WORD_DOCUMENT_XML_PATH);
  const tables = getMatches(documentXml, /<w:tbl\b[\s\S]*?<\/w:tbl>/g);

  if (tables.length === 0) {
    throw new DocxQuestionImportError(
      "Template .docx tidak berisi tabel soal yang bisa diimpor.",
    );
  }

  const rows = getMatches(tables[0], /<w:tr\b[\s\S]*?<\/w:tr>/g);
  if (rows.length < 2) {
    throw new DocxQuestionImportError(
      "Template .docx harus memiliki header dan minimal 1 baris soal.",
    );
  }

  return rows.slice(1).map((rowXml, index) => parseQuestionRow(rowXml, index + 2));
};
