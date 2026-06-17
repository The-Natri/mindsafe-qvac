import { loadModel, synthesizeSpeech, unloadModel, TTS_EN_SUPERTONIC_Q4_0 } from '@qvac/sdk';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const SUPERTONIC_SAMPLE_RATE = 44100;

/**
 * Converts Int16Array or sample number array to Buffer.
 * @param {number[]} samples
 * @returns {Buffer}
 */
function int16ArrayToBuffer(samples) {
  const buffer = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-32768, Math.min(32767, Math.round(samples[i] ?? 0)));
    buffer.writeInt16LE(value, i * 2);
  }
  return buffer;
}

/**
 * Creates a WAV header for 16-bit PCM mono audio.
 * @param {number} dataLength
 * @param {number} sampleRate
 * @returns {Buffer}
 */
function createWavHeader(dataLength, sampleRate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

/**
 * Synthesizes text to speech and saves it as a WAV file.
 * @param {string} text - The input text to synthesize.
 * @param {string} outputPath - The path where the WAV file should be saved.
 * @returns {Promise<string>} The path to the created WAV file.
 */
let ttsModelId = null;

/**
 * Initializes the TTS engine by loading TTS_EN_SUPERTONIC_Q4_0 once.
 * @returns {Promise<string>} The loaded model ID.
 */
export async function initTTSEngine() {
  if (ttsModelId) {
    return ttsModelId;
  }
  ttsModelId = await loadModel({
    modelSrc: TTS_EN_SUPERTONIC_Q4_0,
    modelConfig: {
      ttsEngine: "supertonic",
      language: "en",
      ttsNumInferenceSteps: 4
    }
  }, {
    timeout: 180000
  });
  return ttsModelId;
}

/**
 * Shuts down the TTS engine by unloading the model.
 */
export async function shutdownTTSEngine() {
  if (ttsModelId) {
    const idToUnload = ttsModelId;
    ttsModelId = null;
    await unloadModel({ modelId: idToUnload, clearStorage: false });
  }
}

function sanitizeForTTS(text) {
  return text
    .replace(/`/g, "'")
    .replace(/\u2018/g, "'")
    .replace(/\u2019/g, "'")
    .replace(/\u201C/g, '"')
    .replace(/\u201D/g, '"')
    .replace(/\u2014/g, ' - ')
    .replace(/\u2013/g, ' - ')
    .replace(/\*/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/[\u{1F300}-\u{1FFFF}]/gu, '')
    .replace(/[\u{1F000}-\u{1F02F}]/gu, '')
    .replace(/[\u{1F0A0}-\u{1F0FF}]/gu, '')
    .replace(/[\u{1F100}-\u{1F1FF}]/gu, '')
    .replace(/[\u{1F200}-\u{1F2FF}]/gu, '')
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Synthesizes text to speech and saves it as a WAV file using the pre-loaded engine.
 * @param {string} text - The input text to synthesize.
 * @param {string} outputPath - The path where the WAV file should be saved.
 * @returns {Promise<string>} The path to the created WAV file.
 */
export async function synthesizeText(text, outputPath) {
  if (!ttsModelId) {
    throw new Error("TTS engine is not initialized. Call initTTSEngine() first.");
  }
  try {
    const start = performance.now();
    const sanitized = sanitizeForTTS(text);

    // 1. Synthesize speech
    const result = synthesizeSpeech({
      modelId: ttsModelId,
      text: sanitized,
      stream: false
    });
    const audioBuffer = await result.buffer;

    // 2. Write audio buffer to WAV file using Node fs module
    const dir = path.dirname(outputPath);
    mkdirSync(dir, { recursive: true });
    const audioData = int16ArrayToBuffer(audioBuffer);
    const wavHeader = createWavHeader(audioData.length, SUPERTONIC_SAMPLE_RATE);
    const wavFile = Buffer.concat([wavHeader, audioData]);
    writeFileSync(outputPath, wavFile);

    const durationMs = Math.round(performance.now() - start);

    // 3. Log JSON event
    console.log(JSON.stringify({
      event: "tts_complete",
      durationMs,
      outputPath,
      textLength: text.length
    }, null, 2));

    return outputPath;

  } catch (error) {
    console.error(JSON.stringify({
      event: "tts_error",
      error: error.message || error.toString()
    }, null, 2));
    throw error;
  }
}

/**
 * Runs a quick test if TEST_TTS_TEXT env variable is set.
 */
export default async function runTest() {
  const testTtsText = process.env.TEST_TTS_TEXT;
  if (!testTtsText) {
    console.error("TEST_TTS_TEXT environment variable is not defined. Skipping test.");
    return;
  }

  const outputPath = 'C:\\MindSafe\\audio-samples\\tts-output.wav';
  console.log(`Starting test text-to-speech synthesis to: ${outputPath}`);
  try {
    await initTTSEngine();
    await synthesizeText(testTtsText, outputPath);
    console.log("Test synthesis completed successfully.");
    await shutdownTTSEngine();
  } catch (error) {
    console.error("Test synthesis failed:", error.message || error);
    try {
      await shutdownTTSEngine();
    } catch (shutdownErr) {}
  }
}

// Run test directly if executed as main entrypoint
const nodePath = process.argv[1];
if (nodePath && fileURLToPath(import.meta.url) === path.resolve(nodePath)) {
  runTest();
}
