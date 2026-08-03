import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Transkun runs entirely client-side: audio decoding, the mel front end, the two
// ONNX models (fetched at runtime from Hugging Face) and the semi-CRF Viterbi
// decode all happen in the browser. No backend needed.
export default defineConfig({
  plugins: [vue()],
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web']
  }
})
