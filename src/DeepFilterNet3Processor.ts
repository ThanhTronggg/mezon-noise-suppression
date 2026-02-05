import { AssetLoader, getAssetLoader, AssetConfig } from './asset-loader/AssetLoader';
import { createWorkletModule } from './utils/workerUtils';
import type { ProcessorAssets, DeepFilterNet3ProcessorConfig } from './interfaces';
import { WorkletMessageTypes } from './constants';
// @ts-ignore - Worklet code imported as string via rollup
import workletCode from './worklet/DeepFilterWorklet.ts?worklet-code';

export type { DeepFilterNet3ProcessorConfig };

export class DeepFilterNet3Processor {
  private static preloadPromise: Promise<ProcessorAssets> | null = null;
  private static preloadConfig: AssetConfig | undefined;
  private assetLoader: AssetLoader;
  private assets: ProcessorAssets | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private isInitialized = false;
  private bypassEnabled = false;
  private config: DeepFilterNet3ProcessorConfig;

  private constructor(config: DeepFilterNet3ProcessorConfig = {}) {
    this.config = {
      sampleRate: config.sampleRate ?? 48000,
      noiseReductionLevel: config.noiseReductionLevel ?? 50,
      assetConfig: config.assetConfig
    };
    this.assetLoader = getAssetLoader(config.assetConfig);
  }

  static async create(config: DeepFilterNet3ProcessorConfig = {}): Promise<DeepFilterNet3Processor> {
    const processor = new DeepFilterNet3Processor(config);
    await processor.initialize();
    return processor;
  }

  static preload(config?: DeepFilterNet3ProcessorConfig): Promise<ProcessorAssets> {
    const targetAssetConfig = config?.assetConfig;
    const loader = getAssetLoader(targetAssetConfig);
    const assetUrls = loader.getAssetUrls();

    const currentCdnUrl = targetAssetConfig?.cdnUrl ?? 'https://cdn.mezon.ai/AI/models/datas/noise_suppression/deepfilternet3';
    const cachedCdnUrl = DeepFilterNet3Processor.preloadConfig?.cdnUrl ?? 'https://cdn.mezon.ai/AI/models/datas/noise_suppression/deepfilternet3';

    if (DeepFilterNet3Processor.preloadPromise && currentCdnUrl === cachedCdnUrl) {
      return DeepFilterNet3Processor.preloadPromise;
    }

    DeepFilterNet3Processor.preloadConfig = targetAssetConfig;

    DeepFilterNet3Processor.preloadPromise = (async () => {
      const [wasmBytes, modelBytes] = await Promise.all([
        loader.fetchAsset(assetUrls.wasm),
        loader.fetchAsset(assetUrls.model)
      ]);
      const wasmModule = await WebAssembly.compile(wasmBytes);
      return { wasmModule, modelBytes };
    })();

    return DeepFilterNet3Processor.preloadPromise;
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      this.assets = await DeepFilterNet3Processor.preload(this.config);
      this.isInitialized = true;
    } catch (error) {
      throw error;
    }
  }

  async createAudioWorkletNode(audioContext: AudioContext): Promise<AudioWorkletNode> {
    this.ensureInitialized();

    if (!this.assets) {
      throw new Error('Assets not loaded');
    }

    await createWorkletModule(audioContext, workletCode);

    this.workletNode = new AudioWorkletNode(audioContext, 'deepfilter-audio-processor', {
      processorOptions: {
        wasmModule: this.assets.wasmModule,
        modelBytes: this.assets.modelBytes,
        suppressionLevel: this.config.noiseReductionLevel
      }
    });

    return this.workletNode;
  }

  setSuppressionLevel(level: number): void {
    if (!this.workletNode || typeof level !== 'number' || isNaN(level)) return;

    const clampedLevel = Math.max(0, Math.min(100, Math.floor(level)));
    this.workletNode.port.postMessage({
      type: WorkletMessageTypes.SET_SUPPRESSION_LEVEL,
      value: clampedLevel
    });
  }

  destroy(): void {
    if (!this.isInitialized) return;

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    this.assets = null;
    this.isInitialized = false;
  }

  isReady(): boolean {
    return this.isInitialized && this.workletNode !== null;
  }

  setNoiseSuppressionEnabled(enabled: boolean): void {
    if (!this.workletNode) return;

    this.bypassEnabled = !enabled;

    this.workletNode.port.postMessage({
      type: WorkletMessageTypes.SET_BYPASS,
      value: !enabled
    });
  }

  isNoiseSuppressionEnabled(): boolean {
    return !this.bypassEnabled;
  }

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Processor not initialized. Use DeepFilterNet3Processor.create() to instantiate.');
    }
  }
}
