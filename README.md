# MindSafe

MindSafe is a fully offline, local-first mental wellness companion built on Tether's QVAC SDK.

## Features

- **Voice Conversation** — Real-time voice interaction with conversational mental wellness reasoning via a local MedPsy LLM
- **RAG-Based Context Memory** — Automatically indexes past journal entries in a local vector store to ground conversations with personal context
- **OCR Medical Intake** — Locally processes medical document uploads (PDF, images) to extract health info with zero cloud access
- **Region-Aware Crisis Detection** — A local safety classifier triggers localized helpline information and routing based on user timezone/region
- **100% Offline** — All inference runs on-device. No telemetry, no remote API calls

## Tech Stack

| Component | Model / Library |
|---|---|
| Shell / Runtime | Electron 42, Node.js ≥ 22.17 |
| LLM / Reasoning | MedPsy-1.7B-Q4_K_M-imat via `@qvac/sdk` `llamacpp-completion` |
| Speech-to-Text | Whisper Large v3 Turbo (`WHISPER_LARGE_V3_TURBO`) |
| Text-to-Speech | Supertonic TTS (`TTS_EN_SUPERTONIC_Q4_0`) |
| RAG Embeddings | EmbeddingGemma 300M Q4 (`EMBEDDINGGEMMA_300M_Q4_0`) |
| OCR | pdf-parse (PDF) + QVAC OCR (images) |

## Prerequisites

- **OS**: Windows 11
- **Node.js**: v22.17.0 or higher ([nodejs.org](https://nodejs.org))
- **MedPsy model file** (manual step — see below)

## Installation

```powershell
git clone https://github.com/The-Natri/mindsafe-qvac.git
cd mindsafe-qvac
npm install
```

> `npm install` also runs a postinstall script that downloads ~150 MB of ambient nature video/audio files into `electron/assets/`.

### MedPsy Model Setup

The MedPsy LLM is **not bundled**. Download it manually from HuggingFace:

```bash
# Requires huggingface-cli: pip install huggingface_hub
huggingface-cli download qvac/MedPsy-1.7B-GGUF medpsy-1.7b-q4_k_m-imat.gguf --local-dir .
```

Then set the environment variable to point to its location:

```powershell
$env:MEDPSY_MODEL_PATH = "C:\path\to\medpsy-1.7b-q4_k_m-imat.gguf"
```

The app defaults to `C:\MindSafe\models\medpsy-1.7b-q4_k_m-imat.gguf` if this variable is not set.

> **All other models** (Whisper, TTS, embedding) are automatically downloaded and cached to `~/.qvac/models/` on first app launch via the QVAC SDK. No manual steps required for these.

## Running the App

```powershell
npm start
```

## Tested Hardware

| | |
|---|---|
| CPU | Intel Core i7-12700H (12th Gen) |
| GPU | Intel Iris Xe Graphics |
| RAM | 16 GB |
| OS | Windows 11 |

**No dedicated GPU required.** All inference runs CPU-only.

## Data & Privacy

All speech, reasoning, OCR, and retrieval happens entirely on-device. No user data leaves the machine. See [`api-calls.json`](./api-calls.json) for the full remote API disclosure (none during normal operation).

## Benchmark Log

[`docs/benchmark-log.json`](./docs/benchmark-log.json) contains real performance measurements captured during actual runs and the demo recording — including cold-start model load times, time-to-first-token, and tokens/second.

## License

MIT
