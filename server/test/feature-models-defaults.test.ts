import { describe, it, expect } from 'vitest';
import { defaultFeatureModel } from '../src/modules/settings/feature-models.js';

describe('defaultFeatureModel — registry defaults (no DB)', () => {
  it('review_intent default is openrouter/deepseek-v4-flash (cheap flash classifier)', () => {
    expect(defaultFeatureModel('review_intent')).toEqual({
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
    });
  });

  it('other feature defaults are unchanged', () => {
    expect(defaultFeatureModel('onboarding')).toEqual({
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
    });
    expect(defaultFeatureModel('risk_brief')).toEqual({
      provider: 'openai',
      model: 'gpt-4.1',
    });
    expect(defaultFeatureModel('conformance')).toEqual({
      provider: 'openai',
      model: 'gpt-4.1',
    });
  });
});
