import { resolveCategories } from '../../shared/categories.js';
import type { ApplicationSettings, ModelOption } from '../../shared/settings.js';
import { createClassifier } from './codex/classifier.js';
import { createPatternMatcher } from './codex/pattern-matcher.js';
import { codexEnvironment, runCodex } from './codex/runner.js';
import { claudeEnvironment, runClaude } from './claude/runner.js';

export function classificationBackend(settings: ApplicationSettings) {
  const provider = settings.classificationProvider ?? 'codex';
  const options = provider === 'claude'
    ? { bin: settings.claudeBin ?? 'claude', model: settings.claudeModel ?? '', timeoutMs: settings.claudeTimeoutMs ?? 120000 }
    : { bin: settings.codexBin, model: settings.codexModel, timeoutMs: settings.codexTimeoutMs };
  const run = provider === 'claude' ? runClaude : runCodex;
  return {
    provider, ...options, environment: provider === 'claude' ? claudeEnvironment : codexEnvironment,
    classify: createClassifier(options, settings.classificationPrompt, run, resolveCategories(settings)),
    matchPatterns: createPatternMatcher(options, run),
  };
}

// Claude CLI has no model-list command. Aliases resolve using the installed CLI;
// users can also enter a full model ID available to their account.
export const claudeModels: ModelOption[] = ['sonnet', 'opus', 'haiku'].map((model) => ({
  model, displayName: `Claude ${model[0].toUpperCase()}${model.slice(1)}`, isDefault: false,
}));
