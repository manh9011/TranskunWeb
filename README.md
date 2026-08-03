# Transkun ONNX — Piano → MIDI Transcription Demo in the Browser

A **fully client-side** demo (Vite + Vue 3 + TypeScript) that loads WAV/MP3 audio,
runs the mel front-end, the Transkun transformer model (ONNX via
`onnxruntime-web`/WebAssembly), and the semi-CRF Viterbi decoder directly in the
browser, then exports the result as a `.mid` file.

No backend is required, and no audio is uploaded to any server. The two `.onnx`
models are downloaded directly from Hugging Face
(`TuesdayCrowd/transkun-onnx`) when you click **Transcribe**.

## Getting Started

```bash
npm install
npm run dev
```

Open the Vite development URL (default: `http://localhost:5173`), select a piano
WAV or MP3 file, and click **Transcribe to MIDI**.

On the first run, the application downloads approximately 60 MB of model data
from Hugging Face:

- `transkun.onnx` (~53 MB)
- `transkun-heads.onnx` (~3.4 MB)
- Mel front-end parameter buffers

The initial download may take some time, but it only happens once per browser
session.

```bash
npm run build      # Build production files into dist/
npm run preview    # Preview the production build
npm run typecheck  # Run TypeScript type checking (vue-tsc)
```

## Project Structure

All inference logic is located in `src/transkun/` and is a **line-by-line port**
of the reference C# implementation from the
`TuesdayCrowd/audio-claudio` repository. This is the same decoder used to export
and validate `transkun-onnx` on Hugging Face, achieving **100% F1 parity** with
the original PyTorch implementation.

| File | Purpose | Ported from (C#) |
|------|---------|------------------|
| `fft.ts` | Radix-2 FFT (unnormalized) | `Radix2Fft.cs` |
| `melFrontEnd.ts` | Framing, gain normalization, 6 analysis windows, RFFT, mel filterbank | `TranskunMelFrontEnd.cs` |
| `viterbi.ts` | Semi-CRF Viterbi decoder (`S` scores → note intervals) | `SemiCrfViterbi.cs` |
| `onnxModel.ts` | Runs `transkun.onnx` (featuresBatch → S, ctx) and `transkun-heads.onnx` | `TranskunModel.cs`, `TranskunHeads.cs` |
| `transcriber.ts` | 16 s / 8 s chunk processing, `forcedStartPos` carry-over, stitching, overlap resolution | `TranskunTranscriber.cs` |
| `midiWriter.ts` | Writes Standard MIDI File (Format 0) from note events and sustain pedal | — |
| `audioLoad.ts` | Decodes WAV/MP3 to mono 44.1 kHz using the Web Audio API | `Framing.ReconstructMono` |
| `buffers.ts` | Loads `params.json`, `freq2mels.f32`, `windows.f32`, `symbols.i32` | `TranskunBuffers.cs` |

`App.vue` provides the user interface, including drag-and-drop file loading,
per-segment progress updates, processing logs, and MIDI download.

## Using Local Models (Offline / Self-Hosted)

By default, the application downloads model files from:

```
https://huggingface.co/TuesdayCrowd/transkun-onnx/resolve/main/
```

To run completely offline after building, download the following files into
`public/models/transkun/` (see `public/models/transkun/README.md`):

```
transkun.onnx
transkun-heads.onnx
freq2mels.f32
windows.f32
symbols.i32
params.json
```

Then open **Advanced Options** in the application and change the Base URL to:

```
/models/transkun/
```

## Limitations

- This export contains **only the transformer model**. Since `torch.fft.rfft`
  and the semi-CRF backtracking step cannot be exported to ONNX, the mel
  front-end and Viterbi decoder are reimplemented manually (TypeScript here,
  C# in the reference implementation), following the specification described in
  `DECODE_SPEC.md` from the Hugging Face repository.

- Inference runs on the CPU via WebAssembly. Multi-threading is intentionally
  disabled to avoid requiring COOP/COEP headers. Long audio files may therefore
  take anywhere from several seconds to several minutes to process. Progress is
  displayed for each 16-second segment.

- Only the sustain pedal (CC64) is written to the exported MIDI file. Soft
  pedal (CC67) events are decoded internally but are not exported, matching the
  behavior of the reference implementation.

- A modern browser with WebAssembly and the Web Audio API is required.

## Credits

- **Transkun model and architecture**
  - **Yujia Yan, Frank Cwitkowitz, Zhiyao Duan**
  - *Skipping the Frame-Level: Event-Based Piano Transcription with Neural Semi-CRFs* (NeurIPS 2021)
  - *Scoring Intervals Using Non-Hierarchical Transformer for Piano Transcription* (ISMIR 2024)
  - MIT License
  - Original repository:
    https://github.com/Yujia-Yan/Skipping-The-Frame-Level

- **ONNX export and decoding specification**
  - `TuesdayCrowd/transkun-onnx` on Hugging Face
  - An independent project and not affiliated with the original authors.

- **Reference decoder implementation**
  - `TuesdayCrowd/audio-claudio`
  - C#
  - Unlicense (Public Domain)