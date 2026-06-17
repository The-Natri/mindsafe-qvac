import { fileURLToPath } from 'url';
import path from 'path';
import process from 'process';

import { transcribeAudio, initSTTEngine, shutdownSTTEngine } from './audio/stt.js';
import { synthesizeText, initTTSEngine, shutdownTTSEngine } from './audio/tts.js';
import { processInput } from './agents/intake.js';
import { generateResponse, initReasoningEngine, shutdownReasoningEngine } from './agents/reasoning.js';
import { retrieveContext, initEmbeddingEngine, shutdownEmbeddingEngine } from './rag/index.js';

import { loadUserContext, buildContextPrompt } from './agents/context.js'
import { saveConversation, saveMood, saveTrainingData, getJournalEntries, searchJournal, exportJournal } from './agents/memory.js'
import { getCrisisUIData, getCrisisMessage } from './agents/support.js'

export const initLLMEngine = initReasoningEngine;

/**
 * Initializes MindSafe by loading all four engines in parallel.
 */
export async function initMindSafe() {
  console.log('Loading all models in parallel...');
  await Promise.all([
    initEmbeddingEngine(),
    initLLMEngine(),
    initTTSEngine(),
    initSTTEngine()
  ]);
  console.log('All models loaded and ready');
}

/**
 * Shuts down MindSafe by unloading all four engines.
 */
export async function shutdownMindSafe() {
  await Promise.all([
    shutdownReasoningEngine(),
    shutdownEmbeddingEngine(),
    shutdownTTSEngine(),
    shutdownSTTEngine()
  ]);
}

/**
 * Runs a single conversation turn from audio input to response audio.
 * @param {string} audioInputPath - Path to the user's input WAV file.
 * @param {string} audioOutputPath - Path where response WAV should be saved.
 * @returns {Promise<Object>} The conversation result containing text and paths.
 */
export async function runConversationTurn(audioInputPath, audioOutputPath) {
  const turnStart = performance.now();

  // 1. Transcribe audioInputPath using transcribeAudio
  const sttStart = performance.now();
  const transcribedText = await transcribeAudio(audioInputPath);
  const sttMs = Math.round(performance.now() - sttStart);

  // 2. Runs parallel retrieval and reasoning
  const pipelineStart = performance.now();
  const [ragContext, userContext] = await Promise.all([
    retrieveContext(transcribedText),
    loadUserContext()
  ])

  const contextPrompt = buildContextPrompt(userContext)

  const messages = [
    { role: 'system', content: contextPrompt },
    { role: 'user', content: transcribedText }
  ];
  console.log('=== FULL PROMPT TO MEDPSY ===')
  console.log(JSON.stringify(messages, null, 2).slice(0, 1000))
  console.log('=== END PROMPT ===')

  const response = await generateResponse(
    transcribedText,
    ragContext,
    contextPrompt
  )

  const responseText = response.text;
  const pipelineMs = Math.round(performance.now() - pipelineStart);

  // 3. Synthesizes the response text to audioOutputPath using synthesizeText
  const ttsStart = performance.now();
  await synthesizeText(responseText, audioOutputPath);
  const ttsMs = Math.round(performance.now() - ttsStart);

  const totalDurationMs = Math.round(performance.now() - turnStart);

  // STEP 4 - Add async memory save after TTS completes (fire and forget)
  Promise.all([
    saveConversation({
      transcribedText,
      responseText: response.text,
      timestamp: Date.now(),
      moodScore: null,
      isCrisis: false
    }),
    saveTrainingData({
      input: transcribedText,
      output: response.text,
      timestamp: Date.now()
    })
  ]).catch(err => console.log('Memory save error:', err.message))

  // 4. Logs JSON: { event: "turn_complete", transcribedText, responseText, totalDurationMs, sttMs, pipelineMs, ttsMs }
  console.log(JSON.stringify({
    event: "turn_complete",
    transcribedText,
    responseText,
    totalDurationMs,
    sttMs,
    pipelineMs,
    ttsMs
  }, null, 2));

  // 5. Returns { transcribedText, responseText, audioOutputPath }
  return { transcribedText, responseText, audioOutputPath };
}

// Run direct demo if executed directly
const nodePath = process.argv[1];
if (nodePath && fileURLToPath(import.meta.url) === path.resolve(nodePath)) {
  async function runDemo() {
    console.log('--- Starting MindSafe Demo E2E ---');
    try {
      await initMindSafe();

      const inputPath = 'C:\\MindSafe\\audio-samples\\test.wav';
      const outputPath = 'C:\\MindSafe\\audio-samples\\response.wav';

      const result = await runConversationTurn(inputPath, outputPath);
      console.log('\n--- Demo Turn Result ---');
      console.log(JSON.stringify(result, null, 2));

      await shutdownMindSafe();
      console.log('--- Demo Completed Successfully ---');
    } catch (error) {
      console.error('Demo run failed:', error);
      process.exit(1);
    }
  }
  runDemo();
}

