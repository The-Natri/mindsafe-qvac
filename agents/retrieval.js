import { retrieveContext } from '../rag/index.js';

/**
 * Agent 2 of 3 (Retrieval Agent): Retrieves relevant historical context
 * matching the user's current query from the RAG vector store, if needed.
 *
 * @param {Object} intakeResult - Classification metadata from Agent 1 (intake).
 * @returns {Promise<Object>} Structured retrieval context result.
 */
export async function getRelevantContext(intakeResult) {
  if (!intakeResult) {
    return { context: [], skipped: true, reason: 'error' };
  }

  // 1. If intakeResult.isCrisis is true, return immediately
  if (intakeResult.isCrisis) {
    return { context: [], skipped: true, reason: 'crisis' };
  }

  // 2. If intakeResult.requiresRAG is false, return skipped
  if (!intakeResult.requiresRAG) {
    return { context: [], skipped: true, reason: 'not_needed' };
  }

  const startTime = Date.now();
  try {
    const query = intakeResult.originalText || '';
    // 3. Call retrieveContext using intakeResult.originalText as query, topK=3
    const results = await retrieveContext(query, 3);

    // 4. Filter results to only chunks with score > 0.5
    const filteredResults = results.filter(chunk => chunk.score > 0.5);

    const durationMs = Date.now() - startTime;

    // 6. Log JSON: { event: "retrieval_complete", chunksFound: N, chunksUsed: M, durationMs: X }
    console.log(JSON.stringify({
      event: 'retrieval_complete',
      chunksFound: results.length,
      chunksUsed: filteredResults.length,
      durationMs
    }));

    // 5. Return retrieval result
    return {
      context: filteredResults,
      skipped: false,
      reason: null
    };
  } catch (error) {
    console.error('Error in getRelevantContext:', error);
    // Handle errors gracefully - on failure return skipped with error reason
    return {
      context: [],
      skipped: true,
      reason: 'error'
    };
  }
}
