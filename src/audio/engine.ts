import * as Tone from 'tone'

export type AudioEngineStatus =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'ready'; source: 'sampler' | 'synth' }
  | { kind: 'error'; message: string; fallbackSource?: 'synth' }

export type AudioEngine = {
  status: AudioEngineStatus
  ensureReady: () => Promise<void>
  attack: (relativeNote: string, transposeSemitones: number) => Promise<void>
  release: (relativeNote: string, transposeSemitones: number) => void
  attackRelease: (
    relativeNote: string,
    durationSeconds: number,
    transposeSemitones: number,
    atTime?: number,
  ) => Promise<void>
  dispose: () => void
}

let singleton: AudioEngineImpl | null = null

export function getAudioEngine(): AudioEngine {
  if (!singleton) singleton = new AudioEngineImpl()
  return singleton
}

class AudioEngineImpl implements AudioEngine {
  status: AudioEngineStatus = { kind: 'idle' }

  private sampler: Tone.Sampler | null = null
  private synth: Tone.PolySynth | null = null
  private limiter: Tone.Limiter | null = null

  async ensureReady(): Promise<void> {
    if (this.status.kind === 'ready') return
    if (this.status.kind === 'starting') return

    this.status = { kind: 'starting' }
    try {
      await Tone.start()

      // Output chain
      if (!this.limiter) {
        this.limiter = new Tone.Limiter(-6).toDestination()
      }

      // Prefer PCM sampler (piano). We reference Tone.js' publicly hosted Salamander set.
      // If network/CORS fails, we fall back to a synth so the app remains usable offline.
      if (!this.sampler) {
        const baseUrl = 'https://tonejs.github.io/audio/salamander/'
        this.sampler = new Tone.Sampler({
          urls: {
            A0: 'A0.mp3',
            C1: 'C1.mp3',
            'D#1': 'Ds1.mp3',
            'F#1': 'Fs1.mp3',
            A1: 'A1.mp3',
            C2: 'C2.mp3',
            'D#2': 'Ds2.mp3',
            'F#2': 'Fs2.mp3',
            A2: 'A2.mp3',
            C3: 'C3.mp3',
            'D#3': 'Ds3.mp3',
            'F#3': 'Fs3.mp3',
            A3: 'A3.mp3',
            C4: 'C4.mp3',
            'D#4': 'Ds4.mp3',
            'F#4': 'Fs4.mp3',
            A4: 'A4.mp3',
            C5: 'C5.mp3',
            'D#5': 'Ds5.mp3',
            'F#5': 'Fs5.mp3',
            A5: 'A5.mp3',
            C6: 'C6.mp3',
            'D#6': 'Ds6.mp3',
            'F#6': 'Fs6.mp3',
            A6: 'A6.mp3',
            C7: 'C7.mp3',
            'D#7': 'Ds7.mp3',
            'F#7': 'Fs7.mp3',
            A7: 'A7.mp3',
            C8: 'C8.mp3',
          },
          baseUrl,
          release: 1.2,
        })
        this.sampler.connect(this.limiter)
      }

      try {
        await Tone.loaded()
        this.status = { kind: 'ready', source: 'sampler' }
        return
      } catch {
        // Continue to fallback
      }

      if (!this.synth) {
        this.synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.003, decay: 0.2, sustain: 0.08, release: 0.7 },
        })
        this.synth.connect(this.limiter)
      }

      this.status = {
        kind: 'error',
        message: 'PCM音源の読み込みに失敗したため、簡易シンセ音にフォールバックしました。',
        fallbackSource: 'synth',
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.status = { kind: 'error', message: msg }
    }
  }

  async attack(relativeNote: string, transposeSemitones: number): Promise<void> {
    await this.ensureReady()
    const actual = Tone.Frequency(relativeNote).transpose(transposeSemitones).toNote()

    if (this.status.kind === 'ready' && this.status.source === 'sampler') {
      this.sampler?.triggerAttack(actual)
      return
    }
    this.synth?.triggerAttack(actual)
  }

  release(relativeNote: string, transposeSemitones: number): void {
    const actual = Tone.Frequency(relativeNote).transpose(transposeSemitones).toNote()
    if (this.status.kind === 'ready' && this.status.source === 'sampler') {
      this.sampler?.triggerRelease(actual)
      return
    }
    this.synth?.triggerRelease(actual)
  }

  async attackRelease(
    relativeNote: string,
    durationSeconds: number,
    transposeSemitones: number,
    atTime?: number,
  ): Promise<void> {
    await this.ensureReady()
    const actual = Tone.Frequency(relativeNote).transpose(transposeSemitones).toNote()
    const time = atTime ?? Tone.now()

    if (this.status.kind === 'ready' && this.status.source === 'sampler') {
      this.sampler?.triggerAttackRelease(actual, durationSeconds, time)
      return
    }
    this.synth?.triggerAttackRelease(actual, durationSeconds, time)
  }

  dispose(): void {
    this.sampler?.dispose()
    this.synth?.dispose()
    this.limiter?.dispose()
    this.sampler = null
    this.synth = null
    this.limiter = null
    this.status = { kind: 'idle' }
  }
}

