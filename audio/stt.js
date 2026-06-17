import { loadModel, transcribe, unloadModel, WHISPER_LARGE_V3_TURBO } from '@qvac/sdk';
import { fileURLToPath } from 'url';
import path from 'path';
import process from 'process';

let sttModelId = null;

export async function initSTTEngine() {
  if (sttModelId) {
    return sttModelId;
  }
  sttModelId = await loadModel({
    modelSrc: WHISPER_LARGE_V3_TURBO,
    modelType: "whispercpp-transcription",
    modelConfig: {
      language: "en",
      initial_prompt: "This is a conversation with MindSafe, a mental health companion. The user's name is Naveen. The user may share personal names, feelings, and experiences about anxiety, stress, relationships, and emotions.",
      suppress_blank: true,
      no_context: false,
      temperature: 0.0,
      n_threads: 8,
      vad_params: {
        threshold: 0.5,
        min_speech_duration_ms: 500,
        min_silence_duration_ms: 500,
        speech_pad_ms: 350
      },
      contextParams: {
        use_gpu: false,
        flash_attn: false
      }
    }
  }, { timeout: 180000 });
  return sttModelId;
}

export async function shutdownSTTEngine() {
  if (sttModelId) {
    const idToUnload = sttModelId;
    sttModelId = null;
    await unloadModel({ modelId: idToUnload, clearStorage: false });
  }
}

/**
 * Transcribes an audio file using the local Whisper model via QVAC SDK.
 * @param {string} filePath - Path to the audio file.
 * @returns {Promise<string>} The transcribed text.
 */
export async function transcribeAudio(filePath) {
  if (!sttModelId) {
    await initSTTEngine();
  }
  try {
    // Perform transcription and measure duration
    const start = performance.now();
    
    // Note: The QVAC SDK's transcribe function expects 'audioChunk' (which takes either a
    // local file path string or a Buffer) rather than 'audioPath'. We verify 'audioChunk'
    // is working correctly and document it here.
    const result = {
      text: await transcribe({
        modelId: sttModelId,
        audioChunk: filePath
      })
    };
    
    const durationMs = Math.round(performance.now() - start);

    // Log event metrics
    console.log(JSON.stringify({
      event: 'stt_complete',
      durationMs,
      text: result.text
    }, null, 2));

    // Return the transcribed text
    return result.text;

  } catch (error) {
    console.error(JSON.stringify({
      event: 'stt_error',
      error: error.message || error.toString()
    }, null, 2));
    throw error;
  }
}

/**
 * Runs a test transcription if TEST_AUDIO_PATH is defined.
 */
export default async function runTest() {
  const testAudioPath = process.env.TEST_AUDIO_PATH;
  if (!testAudioPath) {
    console.error('TEST_AUDIO_PATH environment variable is not defined. Skipping test.');
    return;
  }

  console.log(`Starting test transcription of: ${testAudioPath}`);
  try {
    const text = await transcribeAudio(testAudioPath);
    console.log(`Test completed successfully. Output: "${text}"`);
    await shutdownSTTEngine();
  } catch (error) {
    console.error('Test run failed:', error.message || error);
    await shutdownSTTEngine().catch(() => {});
  }
}

// Run test directly if executed as main entrypoint
const nodePath = process.argv[1];
if (nodePath && fileURLToPath(import.meta.url) === path.resolve(nodePath)) {
  runTest();
}

