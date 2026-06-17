import { loadModel, completion, unloadModel } from '@qvac/sdk';
import { MINDSAFE_SYSTEM_PROMPT } from './system-prompt.js';
import cleanResponse from '../utils/response-cleaner.js';

let reasoningModelId = null;

/**
 * Initializes the reasoning engine by loading the MedPsy model once.
 * @returns {Promise<string>} The loaded model ID.
 */
export async function initReasoningEngine() {
  if (reasoningModelId) {
    return reasoningModelId;
  }
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
