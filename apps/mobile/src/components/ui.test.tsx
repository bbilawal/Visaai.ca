import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render, cleanup, fireEvent } from '@testing-library/react-native';
import { Badge, Banner, Button, Card, EmptyState, Field, Loading, Txt } from './ui';
import { colors, MIN_TOUCH_TARGET } from '@/theme/tokens';

/**
 * Component + accessibility tests (Phase 15).
 *
 * These assert the a11y contract of the primitives, not their styling: if a
 * control loses its role, its label, its disabled/busy state, or its minimum
 * touch target, a screen-reader or motor-impaired user loses access to it and
 * nothing else in the suite would notice.
 *
 * RNTL v14's `render` is async and does not populate the module-level `screen`
 * for a following test, so every test queries the object it rendered. Explicit
 * cleanup between tests keeps trees from stacking up.
 */

afterEach(cleanup);

/** Relative luminance per WCAG 2.x. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

describe('Button', () => {
  it('exposes a button role and its label', async () => {
    const view = await render(<Button title="Continue" onPress={jest.fn()} />);
    expect(view.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });

  it('fires onPress', async () => {
    const onPress = jest.fn();
    const view = await render(<Button title="Continue" onPress={onPress} testID="btn" />);
    await fireEvent.press(view.getByTestId('btn'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire while loading, and announces itself as busy', async () => {
    const onPress = jest.fn();
    const view = await render(<Button title="Save" onPress={onPress} loading testID="btn" />);
    await fireEvent.press(view.getByTestId('btn'));
    expect(onPress).not.toHaveBeenCalled();
    expect(view.getByTestId('btn').props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true,
    });
  });

  it('does not fire when disabled', async () => {
    const onPress = jest.fn();
    const view = await render(<Button title="Save" onPress={onPress} disabled testID="btn" />);
    await fireEvent.press(view.getByTestId('btn'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it.each(['primary', 'secondary', 'ghost', 'danger'] as const)(
    'meets the minimum touch target (%s variant)',
    async (variant) => {
      const view = await render(
        <Button title="T" onPress={jest.fn()} variant={variant} testID="btn" />,
      );
      const style = view.getByTestId('btn').props.style;
      const flat = Array.isArray(style) ? Object.assign({}, ...style.flat(2)) : style;
      expect(flat.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    },
  );
});

describe('Field', () => {
  it('labels the input for assistive tech', async () => {
    const view = await render(<Field label="Email" value="" onChangeText={jest.fn()} />);
    expect(view.getByLabelText('Email')).toBeTruthy();
  });

  it('puts the error in the LABEL, not the hint', async () => {
    // A hint is silent when "Speak Hints" is off and is never re-read on change,
    // so an error exposed only as a hint is an error a screen-reader user may
    // never hear.
    const view = await render(
      <Field label="Email" value="" onChangeText={jest.fn()} error="Required" />,
    );
    expect(view.getByLabelText('Email, error: Required')).toBeTruthy();
  });

  it('announces the error so it is spoken on both platforms', async () => {
    // accessibilityLiveRegion is ANDROID-ONLY; without an explicit announce the
    // error was silent on iOS.
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await render(<Field label="Email" value="" onChangeText={jest.fn()} error="Required" />);
    expect(spy).toHaveBeenCalledWith('Email: Required');
    spy.mockRestore();
  });

  it('marks a required field as required for assistive tech', async () => {
    const view = await render(
      <Field label="Email" value="" onChangeText={jest.fn()} required />,
    );
    expect(view.getByLabelText('Email, required')).toBeTruthy();
  });

  it('announces the error politely when it appears', async () => {
    const view = await render(<Field label="Email" value="" onChangeText={jest.fn()} error="Required" />);
    expect(view.getByText('Required').props.accessibilityLiveRegion).toBe('polite');
  });

  it('meets the minimum touch target', async () => {
    const view = await render(<Field label="Email" value="" onChangeText={jest.fn()} testID="f" />);
    const style = view.getByTestId('f').props.style;
    const flat = Array.isArray(style) ? Object.assign({}, ...style.flat(2)) : style;
    expect(flat.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });
});

describe('Banner', () => {
  it('speaks its content on appear (iOS has no live-region support)', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await render(<Banner tone="warning" title="You're offline" body="We'll retry" />);
    expect(spy).toHaveBeenCalledWith("You're offline. We'll retry");
    spy.mockRestore();
  });

  it('is announced as an alert when it appears', async () => {
    // Asserted on the props rather than via getByRole: RNTL's role query maps
    // only the roles with a host-component equivalent, and `alert` is not one
    // of them — the prop is still what RN forwards to the platform a11y tree.
    const view = await render(<Banner tone="error" title="Upload failed" testID="banner" />);
    const banner = view.getByTestId('banner');
    expect(banner.props.accessibilityRole).toBe('alert');
    expect(banner.props.accessibilityLiveRegion).toBe('polite');
  });
});

describe('Card', () => {
  it('is a plain container without onPress', async () => {
    const view = await render(
      <Card testID="c">
        <Txt>content</Txt>
      </Card>,
    );
    expect(view.getByTestId('c').props.accessibilityRole).toBeUndefined();
  });

  it('becomes a labelled button when pressable', async () => {
    const onPress = jest.fn();
    const view = await render(
      <Card testID="c" onPress={onPress} accessibilityLabel="Open application">
        <Txt>content</Txt>
      </Card>,
    );
    await fireEvent.press(view.getByTestId('c'));
    expect(onPress).toHaveBeenCalled();
    expect(view.getByLabelText('Open application')).toBeTruthy();
  });
});

describe('Loading / EmptyState / Badge', () => {
  it('exposes a progressbar with a label', async () => {
    const view = await render(<Loading label="Loading applications" />);
    expect(view.getByLabelText('Loading applications')).toBeTruthy();
  });

  it('renders the empty state title and action', async () => {
    const view = await render(
      <EmptyState
        title="No applications"
        body="Start one"
        action={<Button title="Start" onPress={jest.fn()} />}
      />,
    );
    expect(view.getByText('No applications')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Start' })).toBeTruthy();
  });

  it('renders a badge label', async () => {
    const view = await render(<Badge label="draft" />);
    expect(view.getByText('draft')).toBeTruthy();
  });
});

describe('Text scaling', () => {
  it('allows at least 200% dynamic type (WCAG 1.4.4)', async () => {
    // The previous 1.8 cap denied the largest accessibility text sizes outright.
    const view = await render(<Txt>Hello</Txt>);
    expect(view.getByText('Hello').props.maxFontSizeMultiplier).toBeGreaterThanOrEqual(2.0);
  });
});

describe('Colour contrast (WCAG 2.2 AA — 1.4.3)', () => {
  it('body text on the canvas meets 4.5:1', () => {
    expect(contrastRatio(colors.ink, colors.paperCanvas)).toBeGreaterThanOrEqual(4.5);
  });

  it('secondary text on the canvas meets 4.5:1', () => {
    expect(contrastRatio(colors.paleStone, colors.paperCanvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.faintText, colors.paperCanvas)).toBeGreaterThanOrEqual(4.5);
  });

  it('primary button text on its own fill meets 4.5:1', () => {
    expect(contrastRatio(colors.paperCanvas, colors.ink)).toBeGreaterThanOrEqual(4.5);
  });

  it('status colours meet 4.5:1 on the canvas', () => {
    for (const status of [colors.rose, colors.emerald, colors.amber]) {
      expect(contrastRatio(status, colors.paperCanvas)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('status colours meet 4.5:1 on the BANNER fill they actually render on', () => {
    // The earlier version only checked paper-canvas; amber on the old bg-2 fill
    // was 4.49:1 — a real miss hidden by testing the wrong background.
    for (const status of [colors.rose, colors.emerald, colors.amber]) {
      expect(contrastRatio(status, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('field borders meet the 3:1 non-text contrast minimum (1.4.11)', () => {
    // A text field's border is its only visual boundary.
    expect(contrastRatio(colors.fieldBorder, '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(colors.fieldBorder, colors.paperCanvas)).toBeGreaterThanOrEqual(3);
  });

  it('message timestamps are readable on the sender bubble fill', () => {
    // faintText on atmosphereWash measured 3.68:1; paleStone is 6.02:1.
    expect(contrastRatio(colors.paleStone, colors.atmosphereWash)).toBeGreaterThanOrEqual(4.5);
  });

  it('danger button text on its fill meets 4.5:1', () => {
    expect(contrastRatio('#ffffff', colors.rose)).toBeGreaterThanOrEqual(4.5);
  });
});
