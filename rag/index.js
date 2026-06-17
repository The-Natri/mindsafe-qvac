import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  loadModel,
  embed,
  unloadModel,
  ragChunk,
  ragSaveEmbeddings,
  ragSearch,
  ragDeleteEmbeddings,
  EMBEDDINGGEMMA_300M_Q4_0
} from '@qvac/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const METADATA_PATH = path.join(__dirname, 'metadata.json');

let embeddingModelId = null;

/**
 * Initializes the embedding engine by loading the embedding model once.
 * @returns {Promise<string>} The loaded model ID.
 */
export async function initEmbeddingEngine() {
  if (embeddingModelId) {
    return embeddingModelId;
  }
  embeddingModelId = await loadModel({
    modelSrc: EMBEDDINGGEMMA_300M_Q4_0,
    modelConfig: {
      device: "cpu"
    }
  }, { timeout: 180000 });
  return embeddingModelId;
}

/**
 * Shuts down the embedding engine by unloading the model.
 */
export async function shutdownEmbeddingEngine() {
  if (embeddingModelId) {
    const idToUnload = embeddingModelId;
    embeddingModelId = null;
    await unloadModel({ modelId: idToUnload });
  }
}

async function readMetadata() {
  try {
    const content = await fs.readFile(METADATA_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return {};
  }
}

async function writeMetadata(data) {
  await fs.writeFile(METADATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Ingests a document from a file path into the RAG system.
 * @param {string} filePath - Absolute or relative path to the document file.
 * @param {string} documentId - Identifier for the document.
 */
export async function ingestDocument(filePath, documentId) {
  if (!embeddingModelId) {
    throw new Error('Embedding engine is not initialized. Call initEmbeddingEngine() first.');
  }

  const startTime = Date.now();
  try {
    // Clean up any existing chunks for this document first to avoid duplicates/leaks
    await clearDocuments(documentId).catch(() => {});

    // Read file text using fs
    const text = await fs.readFile(filePath, 'utf-8');

    // Chunk using ragChunk
    const chunks = await ragChunk({
      documents: [text], // Wrapped plain string text in an array as expected by the examples
      chunkOpts: {
        splitStrategy: 'token',
        chunkSize: 200,
        chunkOverlap: 20
      }
    });

    // Embed each chunk and prepare document structure for database save
    const embeddedDocs = [];
    const chunkIds = [];
    for (const chunk of chunks) {
      const { embedding } = await embed({ modelId: embeddingModelId, text: chunk.content });
      const fullChunkId = `${documentId}::${chunk.id}`;
      embeddedDocs.push({
        id: fullChunkId,
        content: chunk.content,
        embedding,
        embeddingModelId: embeddingModelId
      });
      chunkIds.push(fullChunkId);
    }

    // Save with ragSaveEmbeddings()
    await ragSaveEmbeddings({
      documents: embeddedDocs
    });

    // Save chunk IDs to local metadata
    const metadata = await readMetadata();
    metadata[documentId] = chunkIds;
    await writeMetadata(metadata);

    const durationMs = Date.now() - startTime;
    // Log JSON: { event: "ingest_complete", documentId, chunks: N, durationMs: X }
    console.log(JSON.stringify({
      event: 'ingest_complete',
      documentId,
      chunks: chunks.length,
      durationMs
    }));
  } catch (error) {
    console.error(`Error in ingestDocument for ${documentId}:`, error);
    throw error;
  }
}

/**
 * Retrieves the top-K similar chunks for a given query.
 * @param {string} query - The search query.
 * @param {number} [topK=3] - Number of top results to retrieve.
 * @returns {Promise<Array<{ text: string, score: number, documentId: string }>>}
 */
export async function retrieveContext(query, topK = 3) {
  if (!embeddingModelId) {
    throw new Error('Embedding engine is not initialized. Call initEmbeddingEngine() first.');
  }

  try {
    // Embed query with embed() and store the result
    const { embedding } = await embed({ modelId: embeddingModelId, text: query });

    // Retrieve topK similar chunks and pass the embedding
    const results = await ragSearch({
      modelId: embeddingModelId,
      query,
      embedding,
      topK
    });

    // Return [{ text, score, documentId }]
    return results.map(r => ({
      text: r.content,
      score: r.score,
      documentId: r.id.includes('::') ? r.id.split('::')[0] : r.id
    }));
  } catch (error) {
    console.error('Error in retrieveContext:', error);
    throw error;
  }
}

/**
 * Removes all saved chunks for a given documentId from the vector database.
 * @param {string} documentId - Identifier for the document to clear.
 */
export async function clearDocuments(documentId) {
  const metadata = await readMetadata();
  const ids = metadata[documentId];
  if (ids && ids.length > 0) {
    try {
      await ragDeleteEmbeddings({ ids });
      delete metadata[documentId];
      await writeMetadata(metadata);
      console.log(JSON.stringify({
        event: 'clear_complete',
        documentId,
        chunksCleared: ids.length
      }));
    } catch (error) {
      console.error(`Error in clearDocuments for ${documentId}:`, error);
      throw error;
    }
  } else {
    // As a fallback, try deleting a standard range if metadata is not found or empty
    const fallbackIds = Array.from({ length: 100 }, (_, i) => `${documentId}::${i}`);
    try {
      await ragDeleteEmbeddings({ ids: fallbackIds });
    } catch (e) {
      // Ignore fallback delete errors
    }
    console.log(JSON.stringify({
      event: 'clear_complete',
      documentId,
      chunksCleared: 0,
      note: 'No metadata found, ran fallback cleanup'
    }));
  }
}
