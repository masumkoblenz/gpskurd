import type * as OnnxRuntime from 'onnxruntime-web/wasm'
import createPiperPhonemize from '@diffusionstudio/piper-wasm/build/piper_phonemize.js'

type WorkerRequest =
  | { type: 'speak'; requestId: number; text: string }
  | { type: 'cancel'; requestId: number }

type WorkerReply =
  | { type: 'status'; requestId: number; status: 'loading-runtime' | 'loading-model' | 'synthesizing' }
  | { type: 'progress'; requestId: number; loaded: number; total: number }
  | { type: 'cached'; requestId: number }
  | { type: 'audio'; requestId: number; samples: ArrayBuffer; sampleRate: number }
  | { type: 'error'; requestId: number }

type WorkerReplyPayload = WorkerReply extends infer Reply
  ? Reply extends { requestId: number }
    ? Omit<Reply, 'requestId'>
    : never
  : never

type PiperConfig = {
  audio: { sample_rate: number }
  default_speaker_id?: number
  espeak: { voice: string }
  inference: { noise_scale: number; length_scale: number; noise_w: number }
  speaker_id_map?: Record<string, number>
}

type Engine = {
  runtime: typeof OnnxRuntime
  session: OnnxRuntime.InferenceSession
  piper: PiperWasmModule
  config: PiperConfig
}

type PiperWasmModule = Awaited<ReturnType<typeof createPiperPhonemize>>

type PhonemizerResult = {
  phoneme_ids: number[]
}

const MODEL_REVISION = '054099b3aa363625feb30c456a8f98ab27b72dc7'
const MODEL_URL = `https://huggingface.co/atenax/kurmanci-tts-piper/resolve/${MODEL_REVISION}/model.onnx`
const CONFIG_URL = `https://huggingface.co/atenax/kurmanci-tts-piper/resolve/${MODEL_REVISION}/model.onnx.json`
const MODEL_CACHE = `reber-kurmanci-piper-${MODEL_REVISION}`
const PIPER_WASM_BASE = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize'
const ONNX_WASM_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/'

const workerScope = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void) => void
  postMessage: (message: WorkerReply, transfer?: Transferable[]) => void
}

let enginePromise: Promise<Engine> | undefined
let engine: Engine | undefined
let queue: Array<Extract<WorkerRequest, { type: 'speak' }>> = []
let activeRequestIds = new Set<number>()
let cancelledRequestIds = new Set<number>()
let processing = false

function postToActiveRequests(message: WorkerReplyPayload) {
  for (const requestId of activeRequestIds) {
    if (!cancelledRequestIds.has(requestId)) {
      workerScope.postMessage({ ...message, requestId } as WorkerReply)
    }
  }
}

async function loadModelBuffer(): Promise<ArrayBuffer> {
  let cache: Cache | undefined

  try {
    cache = await caches.open(MODEL_CACHE)
    const cachedResponse = await cache.match(MODEL_URL)
    if (cachedResponse) {
      postToActiveRequests({ type: 'cached' })
      return await cachedResponse.arrayBuffer()
    }
  } catch {
    cache = undefined
  }

  const response = await fetch(MODEL_URL)
  if (!response.ok) throw new Error('model_download_failed')

  let cacheWrite: Promise<void> | undefined
  if (cache) {
    cacheWrite = cache.put(MODEL_URL, response.clone()).catch(() => undefined)
  }

  const total = Number(response.headers.get('content-length')) || 0
  const reader = response.body?.getReader()
  if (!reader) {
    const buffer = await response.arrayBuffer()
    postToActiveRequests({ type: 'progress', loaded: buffer.byteLength, total: total || buffer.byteLength })
    await cacheWrite
    return buffer
  }

  const chunks: Uint8Array[] = []
  const preallocated = total ? new Uint8Array(total) : undefined
  let loaded = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    if (preallocated) preallocated.set(value, loaded)
    else chunks.push(value)

    loaded += value.byteLength
    postToActiveRequests({ type: 'progress', loaded, total })
  }

  await cacheWrite
  if (preallocated) return preallocated.buffer

  const buffer = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }
  return buffer.buffer
}

async function loadEngine(): Promise<Engine> {
  if (engine) return engine
  if (!enginePromise) {
    enginePromise = (async () => {
      postToActiveRequests({ type: 'status', status: 'loading-runtime' })
      const [{ default: runtime }, configResponse] = await Promise.all([
        import('onnxruntime-web/wasm'),
        fetch(CONFIG_URL),
      ])

      if (!configResponse.ok) throw new Error('model_config_failed')

      const config = (await configResponse.json()) as PiperConfig
      runtime.env.wasm.wasmPaths = ONNX_WASM_BASE
      runtime.env.wasm.numThreads = 1

      const piper = await createPiperPhonemize({
        noInitialRun: true,
        locateFile: (path) => {
          if (path.endsWith('.wasm')) return `${PIPER_WASM_BASE}.wasm`
          if (path.endsWith('.data')) return `${PIPER_WASM_BASE}.data`
          return path
        },
        print: () => undefined,
        printErr: () => undefined,
      })

      postToActiveRequests({ type: 'status', status: 'loading-model' })
      const modelBuffer = await loadModelBuffer()
      const session = await runtime.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
      })

      return { runtime, session, piper, config }
    })().catch((error: unknown) => {
      enginePromise = undefined
      throw error
    })
  }

  engine = await enginePromise
  return engine
}

function phonemize(piper: PiperWasmModule, text: string, language: string): number[] {
  let result: PhonemizerResult | undefined
  const originalPrint = piper.print

  piper.print = (line: string) => {
    try {
      const parsed = JSON.parse(line) as PhonemizerResult
      if (Array.isArray(parsed.phoneme_ids)) result = parsed
    } catch {
      return
    }
  }

  try {
    piper.callMain([
      '-l', language,
      '--input', JSON.stringify([{ text: text.trim() }]),
      '--espeak_data', '/espeak-ng-data',
    ])
  } finally {
    piper.print = originalPrint
  }

  if (!result?.phoneme_ids.length) throw new Error('phonemize_failed')
  return result.phoneme_ids
}

async function synthesize(request: Extract<WorkerRequest, { type: 'speak' }>) {
  try {
    const currentEngine = await loadEngine()
    if (cancelledRequestIds.has(request.requestId)) return

    postToActiveRequests({ type: 'status', status: 'synthesizing' })
    const phonemeIds = phonemize(currentEngine.piper, request.text, currentEngine.config.espeak.voice)
    const input = BigInt64Array.from(phonemeIds, (id) => BigInt(id))
    const inputLengths = BigInt64Array.from([BigInt(phonemeIds.length)])
    const { noise_scale: noiseScale, length_scale: lengthScale, noise_w: noiseW } = currentEngine.config.inference

    const feeds: Record<string, OnnxRuntime.Tensor> = {
      input: new currentEngine.runtime.Tensor('int64', input, [1, phonemeIds.length]),
      input_lengths: new currentEngine.runtime.Tensor('int64', inputLengths, [1]),
      scales: new currentEngine.runtime.Tensor('float32', Float32Array.from([noiseScale, lengthScale, noiseW]), [3]),
    }

    if (Object.keys(currentEngine.config.speaker_id_map ?? {}).length > 0) {
      const speakerId = currentEngine.config.default_speaker_id ?? 54
      feeds.sid = new currentEngine.runtime.Tensor('int64', BigInt64Array.from([BigInt(speakerId)]), [1])
    }

    const result = await currentEngine.session.run(feeds)
    if (cancelledRequestIds.has(request.requestId)) return

    const samples = new Float32Array(result.output.data as Float32Array)
    workerScope.postMessage({
      type: 'audio',
      requestId: request.requestId,
      samples: samples.buffer,
      sampleRate: currentEngine.config.audio.sample_rate,
    }, [samples.buffer])
  } catch {
    if (!cancelledRequestIds.has(request.requestId)) {
      workerScope.postMessage({ type: 'error', requestId: request.requestId })
    }
  }
}

async function processQueue() {
  if (processing) return
  processing = true

  while (queue.length > 0) {
    const request = queue.shift()
    if (!request) continue

    if (!cancelledRequestIds.has(request.requestId)) await synthesize(request)
    activeRequestIds.delete(request.requestId)
    cancelledRequestIds.delete(request.requestId)
  }

  processing = false
}

workerScope.addEventListener('message', ({ data }) => {
  if (data.type === 'cancel') {
    cancelledRequestIds.add(data.requestId)
    activeRequestIds.delete(data.requestId)
    return
  }

  activeRequestIds.add(data.requestId)
  queue.push(data)
  void processQueue()
})
