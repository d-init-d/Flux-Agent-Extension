import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../Card';

describe('Card', () => {
  // -------------------------------------------------------------------------
  // Basic rendering
  // -------------------------------------------------------------------------

  it('renders children', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLDivElement>();
    render(<Card ref={ref}>Ref test</Card>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  // -------------------------------------------------------------------------
  // Variant classes
  // -------------------------------------------------------------------------

  it.each([
    ['default', 'border-border'],
    ['bordered', 'border-2'],
    ['elevated', 'shadow-md'],
  ] as const)('applies variant class for variant="%s"', (variant, expected) => {
    const { container } = render(<Card variant={variant}>V</Card>);
    expect(container.firstElementChild?.className).toContain(expected);
  });

  // -------------------------------------------------------------------------
  // Padding classes
  // -------------------------------------------------------------------------

  it.each([
    ['none', 'rounded-xl'],
    ['sm', 'p-3'],
    ['md', 'p-4'],
    ['lg', 'p-6'],
  ] as const)('applies padding class for padding="%s"', (padding, expected) => {
    const { container } = render(<Card padding={padding}>P</Card>);
    expect(container.firstElementChild?.className).toContain(expected);
  });

  it('does not add padding class for padding="none"', () => {
    const { container } = render(<Card padding="none">NoPad</Card>);
    const classes = container.firstElementChild?.className ?? '';
    expect(classes).not.toContain('p-3');
    expect(classes).not.toContain('p-4');
    expect(classes).not.toContain('p-6');
  });

  // -------------------------------------------------------------------------
  // Custom className
  // -------------------------------------------------------------------------

  it('merges custom className', () => {
    const { container } = render(<Card className="custom">C</Card>);
    expect(container.firstElementChild?.className).toContain('custom');
  });
});

// ===========================================================================
// CardHeader
// ===========================================================================

describe('CardHeader', () => {
  it('renders children', () => {
    render(<CardHeader>Header content</CardHeader>);
    expect(screen.getByText('Header content')).toBeInTheDocument();
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLDivElement>();
    render(<CardHeader ref={ref}>H</CardHeader>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('merges custom className', () => {
    const { container } = render(<CardHeader className="hdr">H</CardHeader>);
    expect(container.firstElementChild?.className).toContain('hdr');
  });
});

// ===========================================================================
// CardTitle
// ===========================================================================

describe('CardTitle', () => {
  it('renders as h3 by default', () => {
    render(<CardTitle>Title</CardTitle>);
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('Title');
  });

  it('renders as h2 when as="h2"', () => {
    render(<CardTitle as="h2">Title</CardTitle>);
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('renders as h4 when as="h4"', () => {
    render(<CardTitle as="h4">Title</CardTitle>);
    expect(screen.getByRole('heading', { level: 4 })).toBeInTheDocument();
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLHeadingElement>();
    render(<CardTitle ref={ref}>T</CardTitle>);
    expect(ref.current).toBeInstanceOf(HTMLHeadingElement);
  });

  it('merges custom className', () => {
    render(<CardTitle className="ttl">T</CardTitle>);
    expect(screen.getByRole('heading').className).toContain('ttl');
  });
});

// ===========================================================================
// CardDescription
// ===========================================================================

describe('CardDescription', () => {
  it('renders a paragraph element', () => {
    const { container } = render(<CardDescription>Desc</CardDescription>);
    const p = container.querySelector('p');
    expect(p).toBeInTheDocument();
    expect(p).toHaveTextContent('Desc');
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLParagraphElement>();
    render(<CardDescription ref={ref}>D</CardDescription>);
    expect(ref.current).toBeInstanceOf(HTMLParagraphElement);
  });

  it('merges custom className', () => {
    const { container } = render(<CardDescription className="desc">D</CardDescription>);
    const p = container.querySelector('p');
    expect(p?.className).toContain('desc');
  });
});

// ===========================================================================
// CardContent
// ===========================================================================

describe('CardContent', () => {
  it('renders children', () => {
    render(<CardContent>Body here</CardContent>);
    expect(screen.getByText('Body here')).toBeInTheDocument();
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLDivElement>();
    render(<CardContent ref={ref}>C</CardContent>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('merges custom className', () => {
    const { container } = render(<CardContent className="cnt">C</CardContent>);
    expect(container.firstElementChild?.className).toContain('cnt');
  });
});

// ===========================================================================
// CardFooter
// ===========================================================================

describe('CardFooter', () => {
  it('renders children', () => {
    render(<CardFooter>Footer</CardFooter>);
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLDivElement>();
    render(<CardFooter ref={ref}>F</CardFooter>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('merges custom className', () => {
    const { container } = render(<CardFooter className="ftr">F</CardFooter>);
    expect(container.firstElementChild?.className).toContain('ftr');
  });
});

// ===========================================================================
// Composition test
// ===========================================================================

describe('Card composition', () => {
  it('renders a complete card with all sub-components', () => {
    render(
      <Card variant="bordered" padding="md">
        <CardHeader>
          <CardTitle as="h2">Project Alpha</CardTitle>
          <CardDescription>A great project</CardDescription>
        </CardHeader>
        <CardContent>Main content here</CardContent>
        <CardFooter>
          <button>Save</button>
        </CardFooter>
      </Card>,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Project Alpha' })).toBeInTheDocument();
    expect(screen.getByText('A great project')).toBeInTheDocument();
    expect(screen.getByText('Main content here')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
