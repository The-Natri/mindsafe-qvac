import fs from 'fs';
import path from 'path';
import { loadModel, ocr, OCR_LATIN_RECOGNIZER_1, unloadModel } from '@qvac/sdk';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

console.log('pdfParse type:', typeof pdfParse);

/**
 * Extracts text from an image using the local QVAC SDK.
 * @param {string} filePath - Path to the image file.
 * @returns {Promise<string>} Extracted text.
 */
export async function extractFromImage(filePath) {
  const modelId = await loadModel({
    modelSrc: OCR_LATIN_RECOGNIZER_1,
    modelType: 'onnx-ocr',
    modelConfig: { useGPU: false }
  });
  const { blocks } = ocr({ modelId, image: filePath });
  const result = await blocks;
  await unloadModel({ modelId, clearStorage: false });
  return result.map(b => b.text).join('\n');
}

/**
 * Extracts text from a file using local methods only.
 * - PDF: uses pdf-parse
 * - TXT: reads directly
 * - Images: routes to extractFromImage
 * @param {string} filePath - Absolute path to the file.
 * @returns {Promise<string>} Extracted text.
 */
export async function extractTextFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.txt') {
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      console.log(`OCR: read .txt file, ${text.length} chars`);
      return text;
    } catch (err) {
      console.error('OCR: failed to read .txt file:', err.message);
      throw err;
    }
  }

  if (ext === '.pdf') {
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      const rawText = data.text || '';
      console.log(`OCR: extracted ${rawText.length} chars from PDF (${data.numpages} pages)`);
      return rawText;
    } catch (err) {
      console.error('OCR: pdf-parse failed:', err.message);
      throw new Error(`Could not read PDF: ${err.message}. Try a text file instead.`);
    }
  }

  if (['.jpg', '.jpeg', '.png', '.webp', '.bmp'].includes(ext)) {
    return await extractFromImage(filePath);
  }

  throw new Error(`Unsupported file type: ${ext}. Use PDF or .txt.`);
}

/**
 * Helper — extract lines near medical keywords from raw text.
 * @param {string} text - Raw extracted text.
 * @param {string[]} keywords - Keywords to search for.
 * @returns {string} Comma-separated matching values.
 */
function extractField(text, keywords) {
  const lines = text.split('\n');
  const matches = [];
  lines.forEach((line, i) => {
    if (keywords.some(kw => line.toLowerCase().includes(kw))) {
      // Try "Key: Value" format first, then next line
      const colonVal = line.includes(':') ? line.split(':').slice(1).join(':').trim() : null;
      const val = (colonVal && colonVal.length > 2) ? colonVal : (lines[i + 1]?.trim() || line.trim());
      if (val && val.length > 2) matches.push(val);
    }
  });
  return [...new Set(matches)].slice(0, 5).join(', ');
}

/**
 * Parses raw OCR/extracted text into structured medical fields.
 * @param {string} rawText - Raw text string.
 * @returns {Object} { conditions, medications, allergies, notes }
 */
export function parseMedicalText(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { conditions: '', medications: '', allergies: '', notes: '' };
  }

  const conditions = extractField(rawText,
    ['diagnosis', 'condition', 'assessment', 'problem', 'disorder', 'disease']);
  const medications = extractField(rawText,
    ['medication', 'drug', 'prescription', 'medicine', 'tablet', 'capsule', 'mg', 'dosage']);
  const allergies = extractField(rawText,
    ['allerg', 'reaction', 'intoleran', 'sensitivity']);

  return {
    conditions,
    medications,
    allergies,
    notes: rawText.slice(0, 300).trim()
  };
}
