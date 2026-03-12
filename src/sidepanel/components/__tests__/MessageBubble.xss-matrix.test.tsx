import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MessageBubble, type MessageBubbleProps } from '../MessageBubble';

const SAFE_HREF_PATTERN = /^(?:https?:|mailto:|#|\/(?!\/))/i;

const DANGEROUS_SELECTOR = [
  'script',
  'iframe',
  'img',
  'svg',
  'object',
  'embed',
  'form',
  'input',
  'style',
  'video',
  'audio',
  'math',
  '*[onclick]',
  '*[onerror]',
  '*[onload]',
  '*[onmouseover]',
  '*[srcset]',
  '*[srcdoc]',
].join(', ');

function renderAssistantMarkdown(markdown: string) {
  const message: MessageBubbleProps = {
    id: 'assistant-xss-matrix',
    variant: 'assistant',
    timestamp: '2026-03-06T09:41:04.000Z',
    markdown,
  };

  return render(<MessageBubble {...message} />);
}

function expectNoExecutableMarkup(container: HTMLElement) {
  expect(container.querySelector(DANGEROUS_SELECTOR)).toBeNull();

  for (const anchor of container.querySelectorAll('a')) {
    const href = anchor.getAttribute('href');

    if (href === null) {
      expect(anchor).not.toHaveAttribute('target');
      expect(anchor).not.toHaveAttribute('rel');
      continue;
    }

    expect(href).toMatch(SAFE_HREF_PATTERN);
    expect(anchor).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(anchor).toHaveAttribute('target', '_blank');
  }
}

describe('MessageBubble XSS site matrix', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const cases: Array<{
    name: string;
    markdown: string;
    verify: (container: HTMLElement) => void;
  }> = [
    {
      name: 'forum markdown script injection is stripped',
      markdown: 'Forum post<script>alert(1)</script>still visible',
      verify: (container) => {
        expect(container).toHaveTextContent('Forum poststill visible');
      },
    },
    {
      name: 'cms iframe embed is stripped',
      markdown: 'CMS intro<iframe src="https://evil.example/embed"></iframe>CMS outro',
      verify: (container) => {
        expect(container).toHaveTextContent('CMS introCMS outro');
      },
    },
    {
      name: 'e-commerce review image onerror is stripped',
      markdown: 'Great price <img src="x" onerror="alert(1)" /> confirmed',
      verify: (container) => {
        expect(container).toHaveTextContent('Great price confirmed');
      },
    },
    {
      name: 'docs portal svg payload is stripped',
      markdown: 'Architecture <svg onload="alert(1)"><circle /></svg> notes',
      verify: (container) => {
        expect(container).toHaveTextContent('Architecture notes');
      },
    },
    {
      name: 'legacy blog object and embed payloads are stripped',
      markdown: 'Media<object data="x"></object><embed src="x" />fallback',
      verify: (container) => {
        expect(container).toHaveTextContent('Mediafallback');
      },
    },
    {
      name: 'forum markdown javascript link loses href',
      markdown: '[Forum profile](javascript:alert(1))',
      verify: () => {
        const link = screen.getByText('Forum profile').closest('a');
        expect(link).not.toHaveAttribute('href');
      },
    },
    {
      name: 'cms markdown mixed-case javascript link loses href',
      markdown: '[CMS CTA](JaVaScRiPt:alert(1))',
      verify: () => {
        const link = screen.getByText('CMS CTA').closest('a');
        expect(link).not.toHaveAttribute('href');
      },
    },
    {
      name: 'protocol-relative link loses href',
      markdown: '[CDN mirror](//evil.example/payload)',
      verify: () => {
        const link = screen.getByText('CDN mirror').closest('a');
        expect(link).not.toHaveAttribute('href');
      },
    },
    {
      name: 'data URI anchor loses href',
      markdown: '<a href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;">Coupon image</a>',
      verify: () => {
        const link = screen.getByText('Coupon image').closest('a');
        expect(link).not.toHaveAttribute('href');
      },
    },
    {
      name: 'entity-encoded javascript anchor loses href',
      markdown: '<a href="jav&#x61;script:alert(1)">Encoded docs link</a>',
      verify: () => {
        const link = screen.getByText('Encoded docs link').closest('a');
        expect(link).not.toHaveAttribute('href');
      },
    },
    {
      name: 'percent-encoded javascript anchor loses href',
      markdown: '<a href="javascript%3Aalert(1)">Percent link</a>',
      verify: () => {
        const link = screen.getByText('Percent link').closest('a');
        expect(link).not.toHaveAttribute('href');
      },
    },
    {
      name: 'safe https vendor doc link remains hardened',
      markdown: '<a href="https://example.com/docs">Vendor docs</a>',
      verify: () => {
        const link = screen.getByText('Vendor docs').closest('a');
        expect(link).toHaveAttribute('href', 'https://example.com/docs');
      },
    },
    {
      name: 'safe relative help center link remains hardened',
      markdown: '<a href="/help/article">Help article</a>',
      verify: () => {
        const link = screen.getByText('Help article').closest('a');
        expect(link).toHaveAttribute('href', '/help/article');
      },
    },
    {
      name: 'safe mailto support link remains hardened',
      markdown: '[Email support](mailto:security@example.com)',
      verify: () => {
        const link = screen.getByText('Email support').closest('a');
        expect(link).toHaveAttribute('href', 'mailto:security@example.com');
      },
    },
    {
      name: 'malformed html injection does not create script elements',
      markdown: 'Broken <<script>alert(1)</script> markup',
      verify: (container) => {
        expect(container).toHaveTextContent('Broken < markup');
      },
    },
    {
      name: 'iframe srcdoc payload is stripped',
      markdown: '<iframe srcdoc="<script>alert(1)</script>"></iframe>Preview safe',
      verify: (container) => {
        expect(container).toHaveTextContent('Preview safe');
      },
    },
    {
      name: 'form injection markup is stripped',
      markdown:
        '<form action="https://evil.example"><input name="q" value="steal" /></form>Review body',
      verify: (container) => {
        expect(container).toHaveTextContent('Review body');
      },
    },
    {
      name: 'style tag with javascript url is stripped',
      markdown: 'Theme<style>body{background:url(javascript:alert(1))}</style>end',
      verify: (container) => {
        expect(container).toHaveTextContent('Themeend');
      },
    },
    {
      name: 'docs code fence keeps script text inert',
      markdown: '~~~html\n<script>alert(1)</script>\n~~~',
      verify: (container) => {
        expect(container.querySelector('pre')).not.toBeNull();
        expect(container).toHaveTextContent('<script>alert(1)</script>');
      },
    },
    {
      name: 'blockquote citation drops inline onclick while preserving safe href',
      markdown: '> quoted <a href="https://example.com/citation" onclick="alert(1)">citation</a>',
      verify: () => {
        const link = screen.getByText('citation').closest('a');
        expect(link).toHaveAttribute('href', 'https://example.com/citation');
        expect(link).not.toHaveAttribute('onclick');
      },
    },
  ];

  it.each(cases)('$name', ({ markdown, verify }) => {
    const { container } = renderAssistantMarkdown(markdown);

    expectNoExecutableMarkup(container);
    verify(container);
  });
});
