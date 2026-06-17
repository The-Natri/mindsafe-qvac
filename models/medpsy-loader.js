import { loadModel, completion, unloadModel } from '@qvac/sdk';

const ggufPath = process.env.MEDPSY_MODEL_PATH;
if (!ggufPath) {
  console.error(JSON.stringify({ error: 'MEDPSY_MODEL_PATH environment variable is not defined.' }, null, 2));
  process.exit(1);
}

async function main() {
  try {
    // 1. Load the model and measure load time
    const loadStart = performance.now();
    const modelId = await loadModel({
      modelSrc: process.env.MEDPSY_MODEL_PATH,
      modelType: "llamacpp-completion",
      modelConfig: {
        ctx_size: 4096
      },
      onProgress: (progress) => {
        process.stdout.write(".")
      }
    }, {
      timeout: 180000
    })
    const modelLoadTimeMs = Math.round(performance.now() - loadStart);

    // Print a newline after progress dots
    console.log('\n');

    try {
      // 2. Run completion
      const prompt = 'I have been feeling anxious lately. What should I do?';
      const history = [
        { role: 'user', content: prompt }
      ];

      const completionStart = performance.now();
      const result = completion({
        modelId,
        history,
        stream: true
      });

      let firstTokenTimeMs = null;
      let fullResponseText = '';

      // Stream tokens
      for await (const token of result.tokenStream) {
        if (firstTokenTimeMs === null) {
          firstTokenTimeMs = Math.round(performance.now() - completionStart);
        }
        fullResponseText += token;
        process.stdout.write(token);
      }

      // Get final stats from completion
      const stats = await result.stats
      console.log("stats shape:", JSON.stringify({
        timeToFirstToken: stats?.timeToFirstToken,
        tokensPerSecond: stats?.tokensPerSecond,
        totalTokens: stats?.totalTokens
      }))

      // Unload the model
      await unloadModel({ modelId, clearStorage: false });

      // Print a newline followed by the JSON metrics
      console.log('\n');

      console.log(JSON.stringify({
        model_load_time_ms: modelLoadTimeMs,
        time_to_first_token_ms: stats?.timeToFirstToken ?? firstTokenTimeMs,
        tokens_per_second: stats?.tokensPerSecond ?? 0,
        full_response_text: fullResponseText
      }, null, 2));

    } catch (completionError) {
      try {
        await unloadModel({ modelId, clearStorage: false });
      } catch (unloadError) {}
      throw completionError;
    }

  } catch (error) {
    console.error(JSON.stringify({ error: error.message || error.toString() }, null, 2));
    process.exit(1);
  }
}

main();
