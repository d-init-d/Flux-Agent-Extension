import type { PageContext, Session } from '@shared/types';
import type { ContextBuilderOptions } from './interfaces';

const DEFAULT_MAX_ELEMENTS = 40;
const DEFAULT_MAX_CONTEXT_LENGTH = 12_000;
const SCREENSHOT_PREVIEW_LENGTH = 600;
const MAX_MESSAGE_COUNT = 20;
const MAX_ACTION_COUNT = 20;
const MAX_HEADING_COUNT = 20;
const MAX_LINK_COUNT = 30;
const MAX_FORM_COUNT = 10;

export const DEFAULT_CONTEXT_BUILDER_OPTIONS: ContextBuilderOptions = {
  includeScreenshot: false,
  includeDOM: true,
  maxElements: DEFAULT_MAX_ELEMENTS,
  includeNetwork: false,
};

interface BuildOptions {
  maxContextLength?: number;
}

export class ContextBuilder {
  buildContext(
    pageContext: PageContext,
    session: Session,
    options: Partial<ContextBuilderOptions> = {},
    buildOptions: BuildOptions = {},
  ): string {
    const resolvedOptions = this.resolveOptions(options);
    const maxContextLength =
      buildOptions.maxContextLength ?? DEFAULT_MAX_CONTEXT_LENGTH;

    const sections: string[] = [
      this.buildPageSection(pageContext),
      this.buildSessionSection(session),
      this.buildMessagesSection(session),
      this.buildVariablesSection(session),
      this.buildActionHistorySection(session),
    ];

    if (resolvedOptions.includeDOM) {
      sections.push(this.buildDOMSection(pageContext, resolvedOptions.maxElements));
    }

    if (resolvedOptions.includeScreenshot && pageContext.screenshot) {
      sections.push(this.buildScreenshotSection(pageContext.screenshot));
    }

    if (resolvedOptions.includeNetwork) {
      sections.push(this.buildNetworkSection(session.variables.network));
    }

    return this.truncate(
      sections.filter((value) => value.length > 0).join('\n\n---\n\n'),
      maxContextLength,
    );
  }

  private resolveOptions(options: Partial<ContextBuilderOptions>): ContextBuilderOptions {
    return {
      includeScreenshot:
        options.includeScreenshot ?? DEFAULT_CONTEXT_BUILDER_OPTIONS.includeScreenshot,
      includeDOM: options.includeDOM ?? DEFAULT_CONTEXT_BUILDER_OPTIONS.includeDOM,
      maxElements: this.normalizeMaxElements(options.maxElements),
      includeNetwork: options.includeNetwork ?? DEFAULT_CONTEXT_BUILDER_OPTIONS.includeNetwork,
    };
  }

  private normalizeMaxElements(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return DEFAULT_CONTEXT_BUILDER_OPTIONS.maxElements;
    }

    return Math.floor(value);
  }

  private buildPageSection(pageContext: PageContext): string {
    const viewport = pageContext.viewport;
    const summary = pageContext.summary ? this.sanitize(pageContext.summary) : '(none)';

    return [
      '## Page Context',
      `- URL: ${this.sanitize(pageContext.url)}`,
      `- Title: ${this.sanitize(pageContext.title)}`,
      `- Summary: ${summary}`,
      `- Viewport: ${viewport.width}x${viewport.height} @ (${viewport.scrollX}, ${viewport.scrollY})`,
      `- Scroll Height: ${viewport.scrollHeight}`,
      `- Interactive Elements: ${pageContext.interactiveElements.length}`,
      `- Headings: ${pageContext.headings.length}`,
      `- Links: ${pageContext.links.length}`,
      `- Forms: ${pageContext.forms.length}`,
    ].join('\n');
  }

  private buildSessionSection(session: Session): string {
    return [
      '## Session State',
      `- Session ID: ${this.sanitize(session.config.id)}`,
      `- Name: ${this.sanitize(session.config.name ?? '(unnamed)')}`,
      `- Status: ${session.status}`,
      `- Provider: ${session.config.provider}`,
      `- Model: ${this.sanitize(session.config.model)}`,
      `- Current Turn: ${session.currentTurn}`,
      `- Target Tab: ${session.targetTabId ?? 'none'}`,
      `- Error Count: ${session.errorCount}`,
      `- Started At: ${new Date(session.startedAt).toISOString()}`,
      `- Last Activity: ${new Date(session.lastActivityAt).toISOString()}`,
    ].join('\n');
  }

  private buildMessagesSection(session: Session): string {
    if (session.messages.length === 0) {
      return '## Recent Messages\n- (none)';
    }

    const recentMessages = session.messages.slice(-MAX_MESSAGE_COUNT);
    const lines: string[] = ['## Recent Messages'];

    for (const message of recentMessages) {
      const content = this.stringifyMessageContent(message.content);
      const timestamp = message.timestamp ? new Date(message.timestamp).toISOString() : 'unknown';
      lines.push(
        `- [${message.role}] (${timestamp}): ${this.truncate(this.sanitize(content), 300)}`,
      );
    }

    return lines.join('\n');
  }

  private buildVariablesSection(session: Session): string {
    const keys = Object.keys(session.variables);
    if (keys.length === 0) {
      return '## Variables\n- (none)';
    }

    const serialized = this.safeStringify(session.variables, 2);
    return [
      '## Variables',
      '```json',
      this.truncate(serialized, 1500),
      '```',
    ].join('\n');
  }

  private buildActionHistorySection(session: Session): string {
    if (session.actionHistory.length === 0) {
      return '## Action History\n- (none)';
    }

    const recentActions = session.actionHistory.slice(-MAX_ACTION_COUNT);
    const lines: string[] = ['## Action History'];

    for (const record of recentActions) {
      const actionType = record.action.type;
      const actionId = this.sanitize(record.action.id);
      const outcome = record.result.success ? 'success' : 'failed';
      const errorMessage = record.result.error?.message
        ? ` error="${this.truncate(this.sanitize(record.result.error.message), 120)}"`
        : '';

      lines.push(
        `- [${new Date(record.timestamp).toISOString()}] ${actionType} (${actionId}) -> ${outcome} (${record.result.duration}ms)${errorMessage}`,
      );
    }

    return lines.join('\n');
  }

  private buildDOMSection(pageContext: PageContext, maxElements: number): string {
    const lines: string[] = ['## DOM Snapshot'];
    const interactiveElements = pageContext.interactiveElements.slice(0, maxElements);

    if (interactiveElements.length === 0) {
      lines.push('- Interactive Elements: (none)');
    } else {
      lines.push('- Interactive Elements:');
      for (const element of interactiveElements) {
        const descriptor = [
          `${element.index}. <${this.sanitize(element.tag)}>`,
          `text="${this.truncate(this.sanitize(element.text), 100)}"`,
          element.type ? `type=${this.sanitize(element.type)}` : null,
          element.role ? `role=${this.sanitize(element.role)}` : null,
          element.placeholder ? `placeholder="${this.truncate(this.sanitize(element.placeholder), 60)}"` : null,
          element.ariaLabel ? `aria="${this.truncate(this.sanitize(element.ariaLabel), 60)}"` : null,
          `visible=${element.isVisible}`,
          `enabled=${element.isEnabled}`,
        ]
          .filter((value): value is string => value !== null)
          .join(' ');

        lines.push(`  - ${descriptor}`);
      }

      const hiddenCount = pageContext.interactiveElements.length - interactiveElements.length;
      if (hiddenCount > 0) {
        lines.push(`  - ... ${hiddenCount} more interactive element(s) omitted`);
      }
    }

    const headings = pageContext.headings.slice(0, MAX_HEADING_COUNT);
    if (headings.length > 0) {
      lines.push('- Headings:');
      for (const heading of headings) {
        lines.push(
          `  - h${heading.level}: ${this.truncate(this.sanitize(heading.text), 120)}`,
        );
      }
    }

    const links = pageContext.links.slice(0, MAX_LINK_COUNT);
    if (links.length > 0) {
      lines.push('- Links:');
      for (const link of links) {
        lines.push(
          `  - text="${this.truncate(this.sanitize(link.text), 90)}" href="${this.truncate(this.sanitize(link.href), 120)}"`,
        );
      }
    }

    const forms = pageContext.forms.slice(0, MAX_FORM_COUNT);
    if (forms.length > 0) {
      lines.push('- Forms:');
      for (const form of forms) {
        lines.push(
          `  - action="${this.truncate(this.sanitize(form.action), 100)}" method=${this.sanitize(form.method)} fields=${form.fields.length}`,
        );
      }
    }

    return lines.join('\n');
  }

  private buildScreenshotSection(screenshot: string): string {
    return [
      '## Screenshot',
      this.truncate(this.sanitize(screenshot), SCREENSHOT_PREVIEW_LENGTH),
    ].join('\n');
  }

  private buildNetworkSection(networkData: unknown): string {
    if (networkData === undefined) {
      return '## Network\n- (not available)';
    }

    const serialized = this.safeStringify(networkData, 2);
    return [
      '## Network',
      '```json',
      this.truncate(serialized, 2000),
      '```',
    ].join('\n');
  }

  private stringifyMessageContent(content: Session['messages'][number]['content']): string {
    if (typeof content === 'string') {
      return content;
    }

    return content
      .map((block) => {
        if (block.type === 'text') {
          return block.text ?? '';
        }

        if (block.type === 'image') {
          return `[image:${block.image_url?.url ? 'attached' : 'missing-url'}]`;
        }

        return '[unknown-content]';
      })
      .join(' ');
  }

  private sanitize(value: string): string {
    return value
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    const omitted = value.length - maxLength;
    return `${value.slice(0, maxLength)} ... (truncated ${omitted} chars)`;
  }

  private safeStringify(value: unknown, spacing: number): string {
    const seen = new WeakSet<object>();

    return JSON.stringify(
      value,
      (_key, currentValue: unknown) => {
        if (typeof currentValue === 'object' && currentValue !== null) {
          if (seen.has(currentValue)) {
            return '[Circular]';
          }
          seen.add(currentValue);
        }

        if (typeof currentValue === 'string') {
          return this.truncate(this.sanitize(currentValue), 500);
        }

        return currentValue;
      },
      spacing,
    );
  }
}
