import { LLAMA_3_2_1B_INST_Q4_0 } from '@qvac/sdk';

/** Change this descriptor and settings when upgrading the on-device chat model. */
export const SKIN_AI_LOCAL_MODEL = {
  source: LLAMA_3_2_1B_INST_Q4_0,
  name: 'Llama 3.2 1B Instruct Q4_0',
  modelType: 'llm' as const,
  modelConfig: {
    // CPU avoids vendor-specific GPU/Vulkan crashes on unsupported Android devices.
    // Keep the first-run memory footprint conservative for mid-range phones.
    device: 'cpu' as const,
    // A 2K window supports a short multi-turn chat while staying modest on-device.
    ctx_size: 2048,
  },
};
