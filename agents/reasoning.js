import { loadModel, completion, unloadModel } from '@qvac/sdk';
import { MINDSAFE_SYSTEM_PROMPT } from './system-prompt.js';
import cleanResponse from '../utils/response-cleaner.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

let reasoningModelId = null;
let modelLoadTimeMs = null;
let isFirstTurn = true;

/**
 * Initializes the reasoning engine by loading the MedPsy model once.
 * @returns {Promise<string>} The loaded model ID.
 */
export async function initReasoningEngine() {
  if (reasoningModelId) {
    return reasoningModelId;
  }
  const loadStart = performance.now();
  reasoningModelId = await loadModel({
    modelSrc: process.env.MEDPSY_MODEL_PATH,
    modelType: 'llamacpp-completion',
    modelConfig: {
      ctx_size: 4096,
      gpu_layers: 99,
      device: "gpu",
      reasoning_budget: 0
    }
  }, { timeout: 180000 });
  modelLoadTimeMs = Math.round(performance.now() - loadStart);
  return reasoningModelId;
}

/**
 * Shuts down the reasoning engine by unloading the MedPsy model.
 */
export async function shutdownReasoningEngine() {
  if (reasoningModelId) {
    const idToUnload = reasoningModelId;
    reasoningModelId = null;
    await unloadModel({ modelId: idToUnload });
  }
}

/**
 * Agent 3 of 3 (Reasoning Agent): structures the prompt,
 * generates a streamed, private completion using the pre-loaded reasoning engine model.
 *
 * @param {string} text - User's transcribed text.
 * @param {Array} ragContext - Context array retrieved from vector store.
 * @param {string} contextPrompt - User context prompt from Context Agent.
 * @returns {Promise<Object>} Structured reasoning completion result.
 */
export async function generateResponse(text, ragContext, contextPrompt) {
  if (typeof text !== 'string') {
    return {
      text: 'Error: Input text was not provided.',
      response: 'Error: Input text was not provided.',
      skipped: true,
      ttftMs: 0,
      tokensPerSec: 0
    };
  }

  if (!reasoningModelId) {
    throw new Error('Reasoning engine is not initialized. Call initReasoningEngine() first.');
  }

  // Use enhanced system prompt
  const enhancedSystemPrompt = contextPrompt 
    ? `${MINDSAFE_SYSTEM_PROMPT}\n\n${contextPrompt}`
    : MINDSAFE_SYSTEM_PROMPT;

  // Build the prompt
  let builtPrompt = enhancedSystemPrompt;
  if (ragContext && ragContext.length > 0) {
    const contextText = ragContext.map(chunk => chunk.text).join('\n');
    builtPrompt += `\n\nRelevant context from your past entries:\n${contextText}`;
  }

  const responseStart = performance.now();
  try {
    // Run completion with history and stream: true
    const run = completion({
      modelId: reasoningModelId,
      history: [
        { role: 'system', content: builtPrompt },
        { role: 'user', content: text }
      ],
      stream: true,
      max_tokens: 120,
      generationParams: {
        predict: 120,
        reasoning_budget: 0
      }
    });

    // Collect streamed tokens, get stats
    let fullText = '';
    for await (const token of run.tokenStream) {
      fullText += token;
    }

    const stats = await run.stats;
    const ttftMs = stats?.timeToFirstToken || 0;
    const tokensPerSec = stats?.tokensPerSecond || 0;

    // Clean the response using cleanResponse()
    const cleanedText = cleanResponse(fullText);

    // Log JSON: { event: "reasoning_complete", ttftMs: X, tokensPerSec: Y, responseLength: N }
    console.log(JSON.stringify({
      event: 'reasoning_complete',
      ttftMs,
      tokensPerSec,
      responseLength: cleanedText.length
    }));

    const totalLatencyMs = Math.round(performance.now() - responseStart);

    // If DEMO_LOG environment variable is active, append to docs/benchmark-log.json
    if (process.env.DEMO_LOG === 'true') {
      try {
        const logPath = path.resolve('docs/benchmark-log.json');
        let logs = [];
        if (fs.existsSync(logPath)) {
          const fileData = fs.readFileSync(logPath, 'utf8');
          try {
            logs = JSON.parse(fileData);
          } catch (e) {
            console.error('Failed to parse benchmark-log.json, starting fresh array', e);
          }
        }

        const countWords = (str) => {
          if (!str) return 0;
          return str.trim().split(/\s+/).filter(Boolean).length;
        };

        const getHardwareSpecs = () => {
          const cpu = os.cpus()[0]?.model || 'Unknown CPU';
          const ram_gb = Math.round(os.totalmem() / (1024 * 1024 * 1024));
          
          const release = os.release();
          const major = parseInt(release.split('.')[0], 10);
          const build = parseInt(release.split('.')[2], 10);
          let osName = os.platform();
          if (osName === 'win32') {
            osName = (major === 10 && build >= 22000) ? 'Windows 11' : `Windows ${release}`;
          } else if (osName === 'darwin') {
            osName = 'macOS';
          } else if (osName === 'linux') {
            osName = 'Linux';
          }

          let gpu = 'Unknown GPU';
          try {
            const output = execSync('wmic path win32_VideoController get name', { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
            const lines = output.split('\n').map(l => l.trim()).filter(l => l && !l.toLowerCase().includes('name'));
            if (lines.length > 0) {
              gpu = lines[0];
            }
          } catch (e) {
            // ignore
          }

          return { cpu, gpu, ram_gb, os: osName };
        };

        const entry = {
          timestamp: new Date().toISOString(),
          test: 'demo_recording_live',
          hardware: getHardwareSpecs(),
          model: 'MedPsy-1.7B-Q4_K_M-imat',
          prompt: text,
          prompt_tokens: stats?.promptTokens || countWords(text),
          response_tokens: stats?.generatedTokens || countWords(cleanedText),
          time_to_first_token_ms: ttftMs,
          tokens_per_second: tokensPerSec,
          total_latency_ms: totalLatencyMs
        };

        if (isFirstTurn && modelLoadTimeMs !== null) {
          const orderedEntry = {};
          for (const [key, val] of Object.entries(entry)) {
            if (key === 'time_to_first_token_ms') {
              orderedEntry['model_load_ms'] = modelLoadTimeMs;
            }
            orderedEntry[key] = val;
          }
          logs.push(orderedEntry);
        } else {
          logs.push(entry);
        }

        fs.writeFileSync(logPath, JSON.stringify(logs, null, 2), 'utf8');
        console.log(`Demo benchmark logged to ${logPath}`);
        isFirstTurn = false;
      } catch (err) {
        console.error('Error logging demo run capture:', err);
      }
    }

    // Return response object containing both properties for compatibility
    return {
      response: cleanedText,
      text: cleanedText,
      skipped: false,
      ttftMs,
      tokensPerSec
    };
  } catch (error) {
    console.error('Error in generateResponse:', error);
    // Handle errors gracefully
    return {
      response: 'I am having trouble connecting to my reasoning engine right now. Please try again.',
      text: 'I am having trouble connecting to my reasoning engine right now. Please try again.',
      skipped: true,
      ttftMs: 0,
      tokensPerSec: 0
    };
  }
}
