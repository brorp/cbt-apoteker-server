import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import type { OptionKey } from "../db/schema.js";

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const WORD_DOCUMENT_XML_PATH = "word/document.xml";
const OPTION_KEYS: OptionKey[] = ["a", "b", "c", "d", "e"];
const ANSWER_LINE_PATTERN = /^jawaban\s*[:=]\s*([a-e])([\s\S]*)$/i;
const EMPTY_ANSWER_LINE_PATTERN = /^jawaban\s*[:=]\s*$/i;
const OPTION_MARKER_PATTERN = /^([a-e])[.)](?:\s*(.*))?$/i;
const DOCX_ANSWER_OVERRIDES: Record<string, Record<string, OptionKey>> = {
  // Full TO CBT 2 source file contains 3 rows with "Jawaban:" but no answer letter.
  // Scope the recovery to the exact file fingerprint so normal imports stay strict.
  "43da7bceddf093cc5af6bc2f3727846b1ca01dd5b3e7546339c9a2727b6cbed5": {
    "di sebuah gudang penyimpanan industri farmasi, ditemukan satu kontainer asing. setelah diperiksa, ternyata kontainer tersebut berisi produk dari produksi batch sebelumnya. pada kontainer tersebut tidak terdapat label yang menunjukkan identitas produk. hal ini melanggar aturan apa?": "a",
    "seorang apoteker di rumah sakit akan melakukan pemantauan lingkungan di area compounding steril. urutan pemantauan lingkungan yang benar adalah?": "a",
    "sebuah industri farmasi memproduksi antibiotik sefalosporin. berikut ini merupakan urutan tekanan udara yang tepat untuk ruang pengemasan primer, ruang antara, ruang pengemasan sekunder, ruang antara, dan lingkungan luar adalah?": "a",
  },
};

interface ParagraphEntry {
  text: string;
  hasHighlight: boolean;
}

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
    .replace(/[\u200b-\u200d\uFEFF]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

const normalizeQuestionKey = (value: string): string =>
  normalizeText(value).replace(/\s+/g, " ").toLowerCase();

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

const extractCellParagraphEntries = (cellXml: string): ParagraphEntry[] =>
  extractTopLevelTagBlocks(cellXml, "p")
    .map((paragraphXml) => ({
      text: extractParagraphText(paragraphXml),
      hasHighlight: /<w:highlight\b/.test(paragraphXml),
    }))
    .filter((entry) => entry.text.length > 0);

const extractCellParagraphs = (cellXml: string): string[] =>
  extractCellParagraphEntries(cellXml).map((entry) => entry.text);

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

const joinParagraphTexts = (entries: ParagraphEntry[]): string =>
  entries.map((entry) => entry.text).join("\n\n").trim();

const resolveHighlightedOption = (
  entriesByKey: Record<OptionKey, ParagraphEntry[]>,
): OptionKey | null => {
  const highlightedKeys = OPTION_KEYS.filter((key) =>
    entriesByKey[key].some((entry) => entry.hasHighlight),
  );

  return highlightedKeys.length === 1 ? highlightedKeys[0] : null;
};

const buildMatrixOptionValue = (headers: string[], values: string[]): string => {
  const usableHeaders =
    headers.length > 1 && /pilihan jawaban/i.test(headers[0]) ? headers.slice(1) : headers;

  if (usableHeaders.length === values.length) {
    return usableHeaders.map((header, index) => `${header}: ${values[index]}`).join(" | ");
  }

  return values.join(" | ");
};

const parseLabeledQuestionContent = (
  questionEntries: ParagraphEntry[],
): {
  questionText: string;
  optionValues: Record<OptionKey, string>;
  fallbackCorrectAnswer: OptionKey | null;
} | null => {
  const preambleEntries: ParagraphEntry[] = [];
  const optionEntriesByKey = OPTION_KEYS.reduce<Record<OptionKey, ParagraphEntry[]>>(
    (acc, key) => {
      acc[key] = [];
      return acc;
    },
    {} as Record<OptionKey, ParagraphEntry[]>,
  );

  let currentKey: OptionKey | null = null;

  for (const entry of questionEntries) {
    const markerMatch = entry.text.match(OPTION_MARKER_PATTERN);
    if (markerMatch) {
      currentKey = markerMatch[1].toLowerCase() as OptionKey;

      const inlineText = normalizeText(markerMatch[2] ?? "");
      if (inlineText) {
        optionEntriesByKey[currentKey].push({
          ...entry,
          text: inlineText,
        });
      }

      continue;
    }

    if (currentKey) {
      optionEntriesByKey[currentKey].push(entry);
      continue;
    }

    preambleEntries.push(entry);
  }

  const hasAllOptionGroups = OPTION_KEYS.every((key) => optionEntriesByKey[key].length > 0);
  if (!hasAllOptionGroups) {
    return null;
  }

  let questionStemEntries = [...preambleEntries];
  let matrixHeaders: string[] = [];

  if (
    preambleEntries.length >= 5 &&
    /pilihan jawaban/i.test(preambleEntries[preambleEntries.length - 5]?.text ?? "")
  ) {
    matrixHeaders = preambleEntries.slice(-5).map((entry) => entry.text);
    questionStemEntries = preambleEntries.slice(0, -5);
  }

  const questionText = joinParagraphTexts(questionStemEntries);
  if (!questionText) {
    return null;
  }

  const optionValues = OPTION_KEYS.reduce<Record<OptionKey, string>>((acc, key) => {
    const values = optionEntriesByKey[key].map((entry) => sanitizeOptionText(entry.text));
    acc[key] = matrixHeaders.length > 0 ? buildMatrixOptionValue(matrixHeaders, values) : values.join("\n\n").trim();
    return acc;
  }, {} as Record<OptionKey, string>);

  if (OPTION_KEYS.some((key) => optionValues[key].length === 0)) {
    return null;
  }

  return {
    questionText,
    optionValues,
    fallbackCorrectAnswer: resolveHighlightedOption(optionEntriesByKey),
  };
};

const parseDefaultQuestionContent = (
  questionEntries: ParagraphEntry[],
  rowNumber: number,
): {
  questionText: string;
  optionValues: Record<OptionKey, string>;
  fallbackCorrectAnswer: OptionKey | null;
} => {
  if (questionEntries.length < 6) {
    throw new DocxQuestionImportError(
      `Row ${rowNumber}: kolom Soal harus berisi minimal 1 soal dan 5 opsi jawaban.`,
    );
  }

  const questionText = joinParagraphTexts(questionEntries.slice(0, -5));
  if (!questionText) {
    throw new DocxQuestionImportError(`Row ${rowNumber}: teks soal tidak boleh kosong.`);
  }

  const optionEntriesByKey = OPTION_KEYS.reduce<Record<OptionKey, ParagraphEntry[]>>(
    (acc, key, index) => {
      acc[key] = [questionEntries[questionEntries.length - 5 + index]];
      return acc;
    },
    {} as Record<OptionKey, ParagraphEntry[]>,
  );

  const optionValues = OPTION_KEYS.reduce<Record<OptionKey, string>>((acc, key) => {
    acc[key] = sanitizeOptionText(optionEntriesByKey[key][0]?.text ?? "");
    return acc;
  }, {} as Record<OptionKey, string>);

  if (OPTION_KEYS.some((key) => optionValues[key].length === 0)) {
    throw new DocxQuestionImportError(
      `Row ${rowNumber}: semua opsi A sampai E harus terisi.`,
    );
  }

  return {
    questionText,
    optionValues,
    fallbackCorrectAnswer: resolveHighlightedOption(optionEntriesByKey),
  };
};

const parseQuestionContent = (
  questionEntries: ParagraphEntry[],
  rowNumber: number,
): {
  questionText: string;
  optionValues: Record<OptionKey, string>;
  fallbackCorrectAnswer: OptionKey | null;
} => parseLabeledQuestionContent(questionEntries) ?? parseDefaultQuestionContent(questionEntries, rowNumber);

const parseAnswerCell = (
  answerEntries: ParagraphEntry[],
  rowNumber: number,
  questionText: string,
  fallbackCorrectAnswer: OptionKey | null,
  docAnswerOverrides: Record<string, OptionKey>,
): { correctAnswer: OptionKey; explanation: string } => {
  const overrideCorrectAnswer = docAnswerOverrides[normalizeQuestionKey(questionText)] ?? null;

  if (answerEntries.length === 0) {
    if (fallbackCorrectAnswer) {
      return {
        correctAnswer: fallbackCorrectAnswer,
        explanation: "",
      };
    }

    if (overrideCorrectAnswer) {
      return {
        correctAnswer: overrideCorrectAnswer,
        explanation: "",
      };
    }

    throw new DocxQuestionImportError(
      `Row ${rowNumber}: huruf jawaban tidak ditemukan di kolom Jawaban.`,
    );
  }

  const [firstParagraph, ...remainingParagraphs] = answerEntries.map((entry) => entry.text);
  const match = firstParagraph.match(ANSWER_LINE_PATTERN);

  if (match) {
    const inlineExplanation = normalizeText(match[2] ?? "");
    const explanationParagraphs = [
      ...(inlineExplanation ? [inlineExplanation] : []),
      ...remainingParagraphs,
    ].filter((value) => value.length > 0);

    return {
      correctAnswer: match[1].toLowerCase() as OptionKey,
      explanation: explanationParagraphs.join("\n\n").trim(),
    };
  }

  if (EMPTY_ANSWER_LINE_PATTERN.test(firstParagraph)) {
    if (fallbackCorrectAnswer) {
      return {
        correctAnswer: fallbackCorrectAnswer,
        explanation: remainingParagraphs.join("\n\n").trim(),
      };
    }

    if (overrideCorrectAnswer) {
      return {
        correctAnswer: overrideCorrectAnswer,
        explanation: remainingParagraphs.join("\n\n").trim(),
      };
    }

    throw new DocxQuestionImportError(
      `Row ${rowNumber}: huruf jawaban tidak ditemukan di kolom Jawaban.`,
    );
  }

  throw new DocxQuestionImportError(
    `Row ${rowNumber}: kolom Jawaban harus diawali format "Jawaban: A" sampai "Jawaban: E".`,
  );
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

const parseQuestionRow = (
  rowXml: string,
  rowNumber: number,
  docAnswerOverrides: Record<string, OptionKey>,
): ImportedQuestionRow => {
  const cells = extractTopLevelTagBlocks(rowXml, "tc");
  if (cells.length < 3) {
    throw new DocxQuestionImportError(
      `Row ${rowNumber}: template harus memiliki 3 kolom: No, Soal, dan Jawaban.`,
    );
  }

  const questionEntries = extractCellParagraphEntries(cells[1]);
  const answerEntries = extractCellParagraphEntries(cells[2]);

  const { questionText, optionValues, fallbackCorrectAnswer } = parseQuestionContent(
    questionEntries,
    rowNumber,
  );
  const { correctAnswer, explanation } = parseAnswerCell(
    answerEntries,
    rowNumber,
    questionText,
    fallbackCorrectAnswer,
    docAnswerOverrides,
  );

  return {
    questionText,
    optionA: optionValues.a,
    optionB: optionValues.b,
    optionC: optionValues.c,
    optionD: optionValues.d,
    optionE: optionValues.e,
    correctAnswer,
    explanation,
  };
};

export const parseQuestionTemplateDocx = (buffer: Buffer): ImportedQuestionRow[] => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new DocxQuestionImportError("Uploaded .docx file is empty.");
  }

  const documentXml = extractZipEntryText(buffer, WORD_DOCUMENT_XML_PATH);
  const docFingerprint = createHash("sha256").update(buffer).digest("hex");
  const docAnswerOverrides = DOCX_ANSWER_OVERRIDES[docFingerprint] ?? {};
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

  const importedRows: ImportedQuestionRow[] = [];
  const rowErrors: string[] = [];

  for (const { rowXml, rowNumber } of questionRows) {
    try {
      importedRows.push(parseQuestionRow(rowXml, rowNumber, docAnswerOverrides));
    } catch (error) {
      rowErrors.push(error instanceof Error ? error.message : `Row ${rowNumber}: failed to parse.`);
    }
  }

  if (rowErrors.length > 0) {
    throw new DocxQuestionImportError(
      `Template .docx memiliki ${rowErrors.length} baris yang tidak bisa diimpor: ${rowErrors.join(" | ")}`,
    );
  }

  return importedRows;
};
