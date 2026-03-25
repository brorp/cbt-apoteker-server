import { inflateRawSync } from "node:zlib";

import type { OptionKey } from "../db/schema.js";

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const WORD_DOCUMENT_XML_PATH = "word/document.xml";
const OPTION_KEYS: OptionKey[] = ["a", "b", "c", "d", "e"];
const ANSWER_LINE_PATTERN = /^jawaban\s*:\s*([a-e])\b([\s\S]*)$/i;

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

const extractTopLevelTagBlocks = (value: string, tagName: string): string[] => {
  const tagExpression = new RegExp(`<w:${tagName}\\b[^>]*\\/?>|<\\/w:${tagName}>`, "g");
  const results: string[] = [];

  let depth = 0;
  let startIndex = -1;

  for (const match of value.matchAll(tagExpression)) {
    const token = match[0];
    const tokenIndex = match.index ?? -1;
    const isClosingTag = token.startsWith(`</w:${tagName}`);
    const isSelfClosingTag = token.endsWith("/>");

    if (isClosingTag) {
      if (depth === 0) {
        continue;
      }

      depth -= 1;
      if (depth === 0 && startIndex >= 0) {
        results.push(value.slice(startIndex, tokenIndex + token.length));
        startIndex = -1;
      }

      continue;
    }

    if (isSelfClosingTag) {
      if (depth === 0) {
        results.push(token);
      }
      continue;
    }

    if (depth === 0) {
      startIndex = tokenIndex;
    }

    depth += 1;
  }

  return results;
};

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
  extractTopLevelTagBlocks(cellXml, "p")
    .map(extractParagraphText)
    .filter((value) => value.length > 0);

const normalizeHeaderCell = (value: string): string =>
  normalizeText(value).replace(/\s+/g, "").toLowerCase();

const isQuestionTable = (tableXml: string): boolean => {
  const rows = extractTopLevelTagBlocks(tableXml, "tr");
  if (rows.length === 0) {
    return false;
  }

  const headerCells = extractTopLevelTagBlocks(rows[0], "tc")
    .slice(0, 3)
    .map((cellXml) => normalizeHeaderCell(extractCellParagraphs(cellXml).join(" ")));

  return (
    headerCells.length >= 3 &&
    headerCells[0] === "no" &&
    headerCells[1] === "soal" &&
    headerCells[2] === "jawaban"
  );
};

const sanitizeOptionText = (value: string): string =>
  value.replace(/^[a-e][.)]\s*/i, "").trim();

const parseAnswerCell = (
  answerParagraphs: string[],
  rowNumber: number,
): { correctAnswer: OptionKey; explanation: string } => {
  if (answerParagraphs.length === 0) {
    throw new DocxQuestionImportError(
      `Row ${rowNumber}: kolom Jawaban harus berisi jawaban dan pembahasan.`,
    );
  }

  const [firstParagraph, ...remainingParagraphs] = answerParagraphs;
  const match = firstParagraph.match(ANSWER_LINE_PATTERN);

  if (!match) {
    throw new DocxQuestionImportError(
      `Row ${rowNumber}: kolom Jawaban harus diawali format "Jawaban: A" sampai "Jawaban: E".`,
    );
  }

  const inlineExplanation = normalizeText(match[2] ?? "");
  const explanationParagraphs = [
    ...(inlineExplanation ? [inlineExplanation] : []),
    ...remainingParagraphs,
  ].filter((value) => value.length > 0);

  const explanation = explanationParagraphs.join("\n\n").trim();
  if (!explanation) {
    throw new DocxQuestionImportError(`Row ${rowNumber}: pembahasan tidak boleh kosong.`);
  }

  return {
    correctAnswer: match[1].toLowerCase() as OptionKey,
    explanation,
  };
};

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

const parseQuestionRow = (rowXml: string, rowNumber: number): ImportedQuestionRow => {
  const cells = extractTopLevelTagBlocks(rowXml, "tc");
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

  const questionText = questionParagraphs.slice(0, -5).join("\n\n").trim();
  const optionValues = questionParagraphs
    .slice(-5)
    .map((value) => sanitizeOptionText(value));

  if (!questionText) {
    throw new DocxQuestionImportError(`Row ${rowNumber}: teks soal tidak boleh kosong.`);
  }

  if (optionValues.some((value) => value.length === 0)) {
    throw new DocxQuestionImportError(
      `Row ${rowNumber}: semua opsi A sampai E harus terisi.`,
    );
  }

  const { correctAnswer, explanation } = parseAnswerCell(answerParagraphs, rowNumber);
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
  const tables = extractTopLevelTagBlocks(documentXml, "tbl");

  if (tables.length === 0) {
    throw new DocxQuestionImportError(
      "Template .docx tidak berisi tabel soal yang bisa diimpor.",
    );
  }

  const questionTable = tables.find(isQuestionTable);
  if (!questionTable) {
    throw new DocxQuestionImportError(
      'Template .docx harus memiliki tabel dengan header "No", "Soal", dan "Jawaban".',
    );
  }

  const rows = extractTopLevelTagBlocks(questionTable, "tr");
  if (rows.length < 2) {
    throw new DocxQuestionImportError(
      "Template .docx harus memiliki header dan minimal 1 baris soal.",
    );
  }

  const questionRows = rows
    .slice(1)
    .map((rowXml, index) => ({ rowXml, rowNumber: index + 2 }))
    .filter(({ rowXml }) => {
      const cells = extractTopLevelTagBlocks(rowXml, "tc");
      return cells.length >= 3;
    });

  if (questionRows.length === 0) {
    throw new DocxQuestionImportError(
      "Template .docx tidak memiliki baris soal yang valid setelah header.",
    );
  }

  return questionRows.map(({ rowXml, rowNumber }) => parseQuestionRow(rowXml, rowNumber));
};
