interface PiperWasmModule {
  callMain(args: string[]): number
  print?: (message: string) => void
  printErr?: (message: string) => void
}

declare module '@diffusionstudio/piper-wasm/build/piper_phonemize.js' {
  const createPiperPhonemize: (options: {
    locateFile: (path: string) => string
    noInitialRun: boolean
    print: (message: string) => void
    printErr: (message: string) => void
  }) => Promise<PiperWasmModule>

  export default createPiperPhonemize
}
