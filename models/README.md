# Models

This folder contains configurations and loading scripts for running local AI models (LLMs, text-to-speech, speech-to-text) via `@qvac/sdk`.

## MedPsy Loading Configuration

To load and run the MedPsy model successfully, the following configuration parameters are required for the `loadModel` call:

### 1. `modelType: "llamacpp-completion"`
* **Description**: Specifies the inference engine to use for loading the GGUF model.
* **Why it is needed**: It instructs the QVAC SDK to load the GGUF model using the custom `llama.cpp` completion engine. This is the canonical model type value and replaces the deprecated `"llm"` alias.

### 2. `modelConfig: { ctx_size: 4096 }`
* **Description**: Sets the context window size allocated for the loaded model instance.
* **Why it is needed**: MedPsy is a medical/psychology reasoning model that outputs detailed `<think>` chain-of-thought blocks before its final response. The default context window is too small to fit the combined prompt, thinking tokens, and final answer, causing a context window overflow error. Allocating a `ctx_size` of `4096` prevents this.

### 3. `rpcOptions: { timeout: 120000 }`
* **Description**: Sets the RPC request timeout (in milliseconds) and is passed as the **second parameter** to the `loadModel` call.
* **Why it is needed**: Initializing local llama.cpp backend instances and loading multi-gigabyte models into RAM/VRAM can take more time than the default 30-second RPC connection timeout, particularly on consumer hardware. Extending this timeout to `120000` (120 seconds) ensures the worker process starts up and loads the model without throwing timeout errors.

---

## Example Usage

```javascript
import { loadModel } from '@qvac/sdk';

const modelId = await loadModel({
  modelSrc: process.env.MEDPSY_MODEL_PATH,
  modelType: "llamacpp-completion",
  modelConfig: {
    ctx_size: 4096
  },
  onProgress: (progress) => {
    process.stdout.write(".");
  }
}, {
  timeout: 120000
});
```
