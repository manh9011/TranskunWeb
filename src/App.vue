<script setup lang="ts">
import { computed, ref } from 'vue'
import { loadTranskunBuffers, type TranskunBuffers } from './transkun/buffers'
import { TranskunModel, TranskunHeadsModel } from './transkun/onnxModel'
import { TranskunTranscriber, type TranscribeProgress } from './transkun/transcriber'
import { loadAudioMono } from './transkun/audioLoad'
import { writeMidi } from './transkun/midiWriter'

const HF_BASE = 'https://huggingface.co/TuesdayCrowd/transkun-onnx/resolve/main/'

type Status = 'idle' | 'models' | 'decode' | 'transcribe' | 'done' | 'error'

const status = ref<Status>('idle')
const file = ref<File | null>(null)
const modelBase = ref(HF_BASE)
const showAdvanced = ref(false)
const logLines = ref<string[]>([])
const errorMessage = ref('')
const segDone = ref(0)
const segTotal = ref(0)
const stageLabel = ref('')
const noteCount = ref(0)
const midiUrl = ref<string | null>(null)
const midiFilename = ref('transcription.mid')
const durationSeconds = ref(0)
const elapsedSeconds = ref(0)
let timer: number | null = null

let buffersCache: TranskunBuffers | null = null
let modelCache: TranskunModel | null = null
let headsCache: TranskunHeadsModel | null = null
let modelBaseCached = ''

const stageNames: Record<TranscribeProgress['stage'], string> = {
  mel: 'Mel feature extraction',
  onnx: 'Running transformer model (ONNX)',
  viterbi: 'Semi-CRF decoding (Viterbi)',
  heads: 'Predicting velocity / auxiliary timing',
  merge: 'Merging segments'
}

const progressPercent = computed(() => (segTotal.value === 0 ? 0 : Math.round((segDone.value / segTotal.value) * 100)))
const isBusy = computed(() => status.value === 'models' || status.value === 'decode' || status.value === 'transcribe')

function log(line: string) {
  logLines.value.push(line)
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  file.value = input.files?.[0] ?? null
  resetResult()
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  const f = e.dataTransfer?.files?.[0]
  if (f) {
    file.value = f
    resetResult()
  }
}

function resetResult() {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
  status.value = 'idle'
  logLines.value = []
  errorMessage.value = ''
  segDone.value = 0
  segTotal.value = 0
  stageLabel.value = ''
  noteCount.value = 0
  elapsedSeconds.value = 0
  if (midiUrl.value) URL.revokeObjectURL(midiUrl.value)
  midiUrl.value = null
}

async function ensureModels() {
  if (buffersCache && modelCache && headsCache && modelBaseCached === modelBase.value) {
    return { buffers: buffersCache, model: modelCache, heads: headsCache }
  }
  log(`Loading front-end buffers from ${modelBase.value} ...`)
  const buffers = await loadTranskunBuffers(modelBase.value)
  log(`Loaded params.json, mel filterbank [${buffers.params.rfftBins}×${buffers.params.nMels}], ${buffers.windows.length} analysis windows, ${buffers.symbols.length} tracks.`)

  log('Loading transkun.onnx (transformer + semi-CRF scorer, ~53MB) ...')
  const model = new TranskunModel(modelBase.value + 'transkun.onnx')
  await model.load()
  log('transkun.onnx is ready.')

  log('Loading transkun-heads.onnx (velocity + aux timing, ~3.4MB) ...')
  const heads = new TranskunHeadsModel(modelBase.value + 'transkun-heads.onnx')
  await heads.load()
  log('transkun-heads.onnx is ready.')

  buffersCache = buffers
  modelCache = model
  headsCache = heads
  modelBaseCached = modelBase.value
  return { buffers, model, heads }
}

async function runTranscription() {
  if (!file.value) return
  resetResult()

  const startTime = performance.now()
  timer = window.setInterval(() => {
    elapsedSeconds.value = (performance.now() - startTime) / 1000
  }, 100)

  try {
    status.value = 'models'
    const { buffers, model, heads } = await ensureModels()

    status.value = 'decode'
    log(`Decoding audio "${file.value.name}" and resampling to ${buffers.params.fs} Hz, mono ...`)
    const audio = await loadAudioMono(file.value, buffers.params.fs)
    durationSeconds.value = audio.length / buffers.params.fs
    log(`Audio duration: ${durationSeconds.value.toFixed(1)}s (${audio.length.toLocaleString('en-US')} samples).`)

    status.value = 'transcribe'
    const transcriber = new TranskunTranscriber(buffers, model, heads)
    const result = await transcriber.transcribe(audio, (p) => {
      segDone.value = p.segmentsDone
      segTotal.value = p.segmentsTotal
      stageLabel.value = stageNames[p.stage]
    })

    const endTime = performance.now()
    const totalSec = (endTime - startTime) / 1000
    elapsedSeconds.value = totalSec

    log(`Decoding finished: ${result.notes.length} notes, ${result.pedal.length / 2} sustain pedal events.`)
    noteCount.value = result.notes.length

    const midiBytes = writeMidi(result.notes, result.pedal, buffers.params.fs)
    const blob = new Blob([midiBytes.slice().buffer as ArrayBuffer], { type: 'audio/midi' })
    midiUrl.value = URL.createObjectURL(blob)
    const base = file.value.name.replace(/\.[^.]+$/, '')
    midiFilename.value = `${base}.mid`

    status.value = 'done'
    log(`Completed in ${totalSec.toFixed(1)}s. MIDI file is ready for download.`)
  } catch (err) {
    console.error(err)
    errorMessage.value = err instanceof Error ? err.message : String(err)
    status.value = 'error'
  } finally {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}
</script>

<template>
  <div class="page">
    <header class="hero">
      <p class="eyebrow">BROWSER · ONNX RUNTIME WEB · SERVERLESS</p>
      <h1 class="title">Transkun</h1>
      <p class="subtitle">
        Transcribe piano to MIDI right in your browser — mel front end, transformer,
        and semi-CRF Viterbi decoder run locally with zero server uploads.
      </p>
      <svg class="keys" viewBox="0 0 640 28" preserveAspectRatio="none" aria-hidden="true">
        <rect v-for="i in 32" :key="i" :x="(i - 1) * 20" y="0" width="18" height="28"
          :fill="i % 3 === 0 ? 'var(--brass)' : 'var(--ivory)'" :opacity="i % 3 === 0 ? 0.9 : 0.16" />
      </svg>
    </header>

    <main class="card">
      <section
        class="dropzone"
        :class="{ 'has-file': file, busy: isBusy }"
        @dragover.prevent
        @drop="onDrop"
      >
        <label class="dropzone-label">
          <input type="file" accept=".wav,.mp3,.ogg,.flac,.m4a,audio/*" @change="onFileChange" :disabled="isBusy" />
          <template v-if="!file">
            <strong>Choose or drag & drop a WAV / MP3 file</strong>
            <span>Solo piano recordings yield the best results</span>
          </template>
          <template v-else>
            <strong>{{ file.name }}</strong>
            <span>{{ (file.size / 1024 / 1024).toFixed(2) }} MB — click to select another file</span>
          </template>
        </label>
      </section>

      <div class="advanced-toggle">
        <button class="link-button" @click="showAdvanced = !showAdvanced" type="button">
          {{ showAdvanced ? 'Hide' : 'Advanced options (model source)' }}
        </button>
      </div>
      <div v-if="showAdvanced" class="advanced-panel">
        <label class="field-label" for="model-base">Model Base URL (contains transkun.onnx, params.json, ...)</label>
        <input id="model-base" class="text-input" v-model="modelBase" :disabled="isBusy" />
        <p class="hint">
          Defaults to Hugging Face repository
          <a href="https://huggingface.co/TuesdayCrowd/transkun-onnx" target="_blank" rel="noopener">TuesdayCrowd/transkun-onnx</a>.
          To use local pre-downloaded files, place them in <code>public/models/transkun/</code> and change to
          <code>/models/transkun/</code>.
        </p>
      </div>

      <button class="primary-button" :disabled="!file || isBusy" @click="runTranscription">
        <span v-if="!isBusy">Transcribe to MIDI</span>
        <span v-else>Processing…</span>
      </button>

      <section v-if="isBusy || logLines.length" class="progress-block">
        <div class="piano-progress" v-if="segTotal > 0">
          <div class="piano-progress-fill" :style="{ width: progressPercent + '%' }"></div>
        </div>
        <p v-if="stageLabel" class="stage-label">
          {{ stageLabel }} — segment {{ segDone }}/{{ segTotal }} ({{ progressPercent }}%) — {{ elapsedSeconds.toFixed(1) }}s
        </p>
        <pre class="log">{{ logLines.join('\n') }}</pre>
      </section>

      <section v-if="status === 'error'" class="error-block">
        <strong>An error occurred.</strong>
        <p>{{ errorMessage }}</p>
      </section>

      <section v-if="status === 'done'" class="result-block">
        <div class="result-stats">
          <div>
            <span class="stat-value">{{ noteCount }}</span>
            <span class="stat-label">notes</span>
          </div>
          <div>
            <span class="stat-value">{{ durationSeconds.toFixed(1) }}s</span>
            <span class="stat-label">audio duration</span>
          </div>
          <div>
            <span class="stat-value">{{ elapsedSeconds.toFixed(1) }}s</span>
            <span class="stat-label">processing time</span>
          </div>
        </div>
        <a v-if="midiUrl" class="download-button" :href="midiUrl" :download="midiFilename">
          Download {{ midiFilename }}
        </a>
      </section>
    </main>

    <footer class="foot">
      <p>
        Original model: Yujia Yan, Frank Cwitkowitz, Zhiyao Duan — Transkun (Neural Semi-CRF, MIT).
        ONNX export + decoding docs: TuesdayCrowd/transkun-onnx. All inference runs locally via
        WebAssembly in your browser.
      </p>
      <p class="copyright">Copyright by manh9011</p>
    </footer>
  </div>
</template>

<style scoped>
.page {
  width: 100%;
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.hero {
  text-align: center;
}

.eyebrow {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--brass);
  margin: 0 0 12px;
}

.title {
  font-family: var(--font-display);
  font-size: clamp(48px, 9vw, 76px);
  font-weight: 600;
  margin: 0;
  color: var(--ivory);
  letter-spacing: -0.01em;
}

.subtitle {
  max-width: 520px;
  margin: 14px auto 0;
  color: var(--ivory-dim);
  line-height: 1.55;
  font-size: 15px;
}

.keys {
  display: block;
  width: 100%;
  max-width: 420px;
  height: 24px;
  margin: 28px auto 0;
  border-radius: 3px;
  overflow: hidden;
}

.card {
  background: var(--panel);
  border: 1px solid var(--hairline);
  border-radius: 14px;
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.dropzone {
  border: 1.5px dashed var(--hairline);
  border-radius: 10px;
  padding: 28px 20px;
  text-align: center;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.dropzone.has-file {
  border-color: var(--brass);
  background: rgba(201, 162, 75, 0.06);
}

.dropzone.busy {
  opacity: 0.6;
}

.dropzone-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: pointer;
}

.dropzone-label input {
  display: none;
}

.dropzone-label strong {
  font-size: 16px;
  color: var(--ivory);
}

.dropzone-label span {
  font-size: 13px;
  color: var(--ivory-dim);
}

.advanced-toggle {
  display: flex;
  justify-content: flex-end;
}

.link-button {
  background: none;
  border: none;
  color: var(--ivory-dim);
  font-size: 13px;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.link-button:hover {
  color: var(--brass-bright);
}

.advanced-panel {
  background: var(--panel-raised);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-label {
  font-size: 12px;
  color: var(--ivory-dim);
  font-family: var(--font-mono);
}

.text-input {
  background: var(--ebony);
  border: 1px solid var(--hairline);
  border-radius: 6px;
  padding: 10px 12px;
  color: var(--ivory);
  font-family: var(--font-mono);
  font-size: 13px;
}

.hint {
  font-size: 12px;
  color: var(--ivory-dim);
  margin: 4px 0 0;
  line-height: 1.5;
}

.hint code {
  color: var(--brass-bright);
  font-family: var(--font-mono);
}

.primary-button {
  background: var(--brass);
  color: var(--ebony);
  border: none;
  border-radius: 8px;
  padding: 14px 20px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.1s ease;
}

.primary-button:hover:not(:disabled) {
  background: var(--brass-bright);
}

.primary-button:active:not(:disabled) {
  transform: scale(0.99);
}

.primary-button:disabled {
  background: var(--panel-raised);
  color: var(--ivory-dim);
  cursor: not-allowed;
}

.progress-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.piano-progress {
  height: 10px;
  border-radius: 5px;
  background: var(--panel-raised);
  overflow: hidden;
}

.piano-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--brass), var(--brass-bright));
  transition: width 0.2s ease;
}

.stage-label {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ivory-dim);
  margin: 0;
}

.log {
  background: var(--ebony);
  border-radius: 8px;
  padding: 12px 14px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  color: var(--ivory-dim);
  max-height: 220px;
  overflow-y: auto;
  white-space: pre-wrap;
  margin: 0;
}

.error-block {
  background: rgba(198, 91, 78, 0.12);
  border: 1px solid rgba(198, 91, 78, 0.4);
  border-radius: 8px;
  padding: 14px 16px;
  color: var(--red);
}

.error-block strong {
  display: block;
  margin-bottom: 4px;
}

.result-block {
  display: flex;
  flex-direction: column;
  gap: 16px;
  border-top: 1px solid var(--hairline);
  padding-top: 18px;
}

.result-stats {
  display: flex;
  gap: 32px;
}

.result-stats > div {
  display: flex;
  flex-direction: column;
}

.stat-value {
  font-family: var(--font-display);
  font-size: 28px;
  color: var(--brass-bright);
}

.stat-label {
  font-size: 12px;
  color: var(--ivory-dim);
}

.download-button {
  display: inline-block;
  text-align: center;
  background: var(--green);
  color: var(--ebony);
  border-radius: 8px;
  padding: 12px 20px;
  font-weight: 600;
  text-decoration: none;
}

.foot {
  text-align: center;
  color: var(--ivory-dim);
  font-size: 12px;
  line-height: 1.6;
  max-width: 560px;
  margin: 0 auto;
}

.copyright {
  margin-top: 8px;
  font-weight: 500;
}
</style>
