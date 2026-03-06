import { ErrorCode, ExtensionError } from '@shared/errors';
import type { Action, ParsedResponse } from '@shared/types';
import { generateId } from '@shared/utils';
import type { ICommandParser, ParserConfig, ValidationResult } from './interfaces';
import { actionSchema, validateActionSchema } from './schemas';
import { sanitizeCommandAction } from './sanitizer';

const CODE_BLOCK_REGEX = /```(?:json)?\s*([\s\S]*?)```/gi;

const DEFAULT_CONFIG: ParserConfig = {
  strictMode: true,
  allowEvaluate: false,
  allowedDomains: [],
  blockedSelectors: [],
};

interface JsonCandidate {
  raw: string;
  parsed: unknown;
  score: number;
}


export class CommandParser implements ICommandParser {
  private readonly config: ParserConfig;

  constructor(config: Partial<ParserConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  parse(response: string): ParsedResponse {
    if (!response || response.trim().length === 0) {
      throw new ExtensionError(ErrorCode.AI_PARSE_ERROR, 'AI response is empty', true);
    }

    const parsedPayload = this.extractBestPayload(response);
    const normalized = this.normalizeParsedResponse(parsedPayload);
    const safeActions: Action[] = [];

    for (const rawAction of normalized.actions) {
      const schemaResult = actionSchema.safeParse(rawAction);
      if (!schemaResult.success) {
        if (this.config.strictMode) {
          const errors = schemaResult.error.issues.map((issue) => {
            const path = issue.path.length > 0 ? issue.path.join('.') : 'action';
            return `${path}: ${issue.message}`;
          });

          throw new ExtensionError(
            ErrorCode.ACTION_INVALID,
            errors[0] ?? 'Invalid action in AI response',
            true,
            { action: rawAction, errors },
          );
        }

        continue;
      }

      const action = schemaResult.data as unknown as Action;
      safeActions.push(this.sanitize(action));
    }

    return {
      ...normalized,
      actions: safeActions,
    };
  }

  validate(action: Action): ValidationResult {
    const schemaResult = validateActionSchema(action);
    const errors = schemaResult.errors ? [...schemaResult.errors] : [];

    if (errors.length === 0) {
      try {
        sanitizeCommandAction(action, this.config);
      } catch (error) {
        if (ExtensionError.isExtensionError(error)) {
          errors.push(error.message);
        } else if (error instanceof Error) {
          errors.push(error.message);
        } else {
          errors.push('Action failed security validation');
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  sanitize(action: Action): Action {
    return sanitizeCommandAction(action, this.config);
  }

  private extractBestPayload(input: string): unknown {
    const candidates = this.collectJsonCandidates(input);

    if (candidates.length === 0) {
      throw new ExtensionError(
        ErrorCode.AI_PARSE_ERROR,
        'No valid JSON payload found in AI response',
        true,
      );
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].parsed;
  }

  private collectJsonCandidates(input: string): JsonCandidate[] {
    const candidates: JsonCandidate[] = [];

    const trimmed = input.trim();
    const direct = this.tryParseJson(trimmed);
    if (direct !== null) {
      candidates.push({ raw: trimmed, parsed: direct, score: this.scorePayload(direct) + 10 });
    }

    for (const block of this.extractCodeBlocks(input)) {
      const parsed = this.tryParseJson(block);
      if (parsed !== null) {
        candidates.push({ raw: block, parsed, score: this.scorePayload(parsed) + 8 });
      }
    }

    for (const fragment of this.extractBalancedJsonFragments(input)) {
      const parsed = this.tryParseJson(fragment);
      if (parsed !== null) {
        candidates.push({ raw: fragment, parsed, score: this.scorePayload(parsed) });
      }
    }

    return candidates;
  }

  private normalizeParsedResponse(payload: unknown): ParsedResponse {
    if (Array.isArray(payload)) {
      return {
        actions: payload.map((item, index) => this.normalizeAction(item, index)),
      };
    }

    if (!this.isRecord(payload)) {
      throw new ExtensionError(
        ErrorCode.AI_PARSE_ERROR,
        'Parsed payload must be a JSON object or an array of actions',
        true,
      );
    }

    const actions = this.extractActions(payload);
    const thinking = typeof payload.thinking === 'string' ? payload.thinking : undefined;
    const summary = typeof payload.summary === 'string' ? payload.summary : undefined;

    const needsMoreInfo = this.isRecord(payload.needsMoreInfo)
      ? {
          question:
            typeof payload.needsMoreInfo.question === 'string'
              ? payload.needsMoreInfo.question
              : 'Need additional context',
          context:
            typeof payload.needsMoreInfo.context === 'string' ? payload.needsMoreInfo.context : '',
        }
      : undefined;

    return {
      thinking,
      summary,
      needsMoreInfo,
      actions,
    };
  }

  private extractActions(payload: Record<string, unknown>): Action[] {
    const rawActions = payload.actions;

    if (rawActions === undefined) {
      if (payload.needsMoreInfo !== undefined) {
        return [];
      }

      if (payload.type !== undefined) {
        return [this.normalizeAction(payload, 0)];
      }

      throw new ExtensionError(
        ErrorCode.AI_PARSE_ERROR,
        'JSON payload does not contain actions',
        true,
      );
    }

    if (!Array.isArray(rawActions)) {
      throw new ExtensionError(ErrorCode.AI_PARSE_ERROR, 'actions must be an array', true);
    }

    return rawActions.map((item, index) => this.normalizeAction(item, index));
  }

  private normalizeAction(raw: unknown, index: number): Action {
    if (!this.isRecord(raw)) {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        `Action at index ${index} must be an object`,
        true,
      );
    }

    if (typeof raw.type !== 'string' || raw.type.trim().length === 0) {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        `Action at index ${index} is missing a valid type`,
        true,
      );
    }

    const withId: Record<string, unknown> = {
      ...raw,
      id: typeof raw.id === 'string' && raw.id.trim().length > 0 ? raw.id : generateId(),
    };

    return withId as unknown as Action;
  }

  private extractCodeBlocks(input: string): string[] {
    const blocks: string[] = [];
    for (const match of input.matchAll(CODE_BLOCK_REGEX)) {
      if (match[1]) {
        blocks.push(match[1].trim());
      }
    }
    return blocks;
  }

  private extractBalancedJsonFragments(input: string): string[] {
    const fragments: string[] = [];
    const length = input.length;

    for (let start = 0; start < length; start += 1) {
      const starter = input[start];
      if (starter !== '{' && starter !== '[') {
        continue;
      }

      const end = this.findBalancedEnd(input, start);
      if (end !== -1) {
        fragments.push(input.slice(start, end + 1).trim());
      }
    }

    return fragments;
  }

  private findBalancedEnd(text: string, start: number): number {
    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i += 1) {
      const char = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === '{' || char === '[') {
        stack.push(char);
        continue;
      }

      if (char === '}' || char === ']') {
        const opening = stack.pop();
        if (!opening) {
          return -1;
        }

        const validPair =
          (opening === '{' && char === '}') ||
          (opening === '[' && char === ']');

        if (!validPair) {
          return -1;
        }

        if (stack.length === 0) {
          return i;
        }
      }
    }

    return -1;
  }

  private tryParseJson(input: string): unknown | null {
    if (input.length === 0) {
      return null;
    }

    try {
      return JSON.parse(input) as unknown;
    } catch {
      return null;
    }
  }

  private scorePayload(payload: unknown): number {
    if (Array.isArray(payload)) {
      return payload.length > 0 ? 60 : 5;
    }

    if (!this.isRecord(payload)) {
      return 0;
    }

    let score = 10;
    if (Array.isArray(payload.actions)) {
      score += 70;
    }
    if (typeof payload.summary === 'string') {
      score += 5;
    }
    if (typeof payload.thinking === 'string') {
      score += 3;
    }
    if (this.isRecord(payload.needsMoreInfo)) {
      score += 8;
    }
    if (typeof payload.type === 'string') {
      score += 20;
    }

    return score;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
