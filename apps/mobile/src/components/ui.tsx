import React, { useEffect } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing, typography, MIN_TOUCH_TARGET } from '@/theme/tokens';

/**
 * Shared UI primitives on the Monad tokens.
 *
 * Accessibility lives in the primitives rather than in each screen, because
 * a11y applied per-screen is a11y that regresses.
 *
 * IMPORTANT — `accessibilityLiveRegion` is Android-only. An earlier version of
 * this file relied on it alone and therefore announced NOTHING on iOS: no
 * validation error, no offline banner, no upload progress. Every async status
 * here now also calls `AccessibilityInfo.announceForAccessibility`, which is
 * the only cross-platform way to speak a change that did not move focus.
 */

/** Speak a status change on both platforms. */
function announce(message: string | null | undefined): void {
  if (!message) return;
  AccessibilityInfo.announceForAccessibility(message);
}

// ── Text ─────────────────────────────────────────────────────────────────
type Variant = keyof typeof typography;

/** Variants that are structural headings, so the rotor can jump between them. */
const HEADING_VARIANTS = new Set<Variant>(['display', 'title', 'heading']);

export function Txt({
  variant = 'body',
  color = colors.ink,
  style,
  children,
  ...rest
}: {
  variant?: Variant;
  color?: string;
  style?: StyleProp<TextStyle>;
  children: React.ReactNode;
} & React.ComponentProps<typeof Text>): React.ReactElement {
  const isHeading = HEADING_VARIANTS.has(variant);
  return (
    <Text
      // WCAG 1.4.4 wants 200%. The previous 1.8 cap silently denied the largest
      // accessibility text sizes; layouts flex instead of clamping the user.
      maxFontSizeMultiplier={2.2}
      accessibilityRole={isHeading ? 'header' : undefined}
      style={[typography[variant], { color }, style]}
      {...rest}
    >
      {children}
    </Text>
  );
}

// ── Button ───────────────────────────────────────────────────────────────
export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  accessibilityHint,
  testID,
  style,
}: ButtonProps): React.ReactElement {
  const isDisabled = disabled || loading;
  const palette = {
    primary: { bg: colors.ink, fg: colors.paperCanvas, border: colors.ink },
    secondary: { bg: colors.paperCanvas, fg: colors.ink, border: colors.hairline2 },
    ghost: { bg: 'transparent', fg: colors.ink, border: 'transparent' },
    danger: { bg: colors.rose, fg: '#ffffff', border: colors.rose },
  }[variant];

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          opacity: isDisabled ? 0.6 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <Txt variant="label" color={palette.fg}>
          {title}
        </Txt>
      )}
    </Pressable>
  );
}

/**
 * Inline navigation control. Exists because bare `<Link><Text>` renders a ~20pt
 * target with no role — below every platform minimum and easy to miss.
 */
export function LinkButton({
  title,
  onPress,
  testID,
}: {
  title: string;
  onPress: () => void;
  testID?: string;
}): React.ReactElement {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={title}
      hitSlop={12}
      style={styles.link}
    >
      <Txt variant="label" color={colors.subtleLink}>
        {title}
      </Txt>
    </Pressable>
  );
}

// ── Input ────────────────────────────────────────────────────────────────
export interface FieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
}

export function Field({
  label,
  error,
  hint,
  required,
  style,
  ...rest
}: FieldProps): React.ReactElement {
  useEffect(() => {
    // Errors must be spoken when they appear. `accessibilityHint` is silent
    // when the user has Speak Hints off, and is never re-read on change.
    if (error) announce(`${label}: ${error}`);
  }, [error, label]);

  // Required state and the error both belong in the LABEL: a hint is optional
  // for the screen reader to read, a label is not.
  const accessibleLabel = [label, required ? 'required' : null, error ? `error: ${error}` : null]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.field}>
      {/* Hidden from AT: the input carries the name, so exposing this too made
          every field announce its label twice. */}
      <Txt
        variant="label"
        color={colors.paleStone}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {label}
        {required ? ' *' : ''}
      </Txt>
      <TextInput
        accessibilityLabel={accessibleLabel}
        accessibilityHint={hint}
        accessibilityState={{ disabled: rest.editable === false }}
        placeholderTextColor={colors.faintText}
        maxFontSizeMultiplier={2.0}
        style={[styles.input, error ? styles.inputError : null, style]}
        {...rest}
      />
      {error ? (
        <Txt variant="caption" color={colors.rose} accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : hint ? (
        <Txt variant="caption" color={colors.paleStone}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

// ── Surfaces ─────────────────────────────────────────────────────────────
export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
  testID,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
}): React.ReactElement {
  if (onPress) {
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.bg2 }, style]}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View testID={testID} style={[styles.card, style]}>
      {children}
    </View>
  );
}

/**
 * Screen shell. Applies safe-area insets (both navigators run with
 * `headerShown: false`, so without this every title sits under the notch) and
 * keeps the focused input above the keyboard.
 */
export function Screen({
  children,
  scroll = true,
  testID,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  testID?: string;
}): React.ReactElement {
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: insets.top + spacing.lg,
    paddingBottom: insets.bottom + spacing['3xl'],
    paddingLeft: Math.max(insets.left, spacing.lg),
    paddingRight: Math.max(insets.right, spacing.lg),
  };

  const body = scroll ? (
    <ScrollView
      testID={testID}
      style={styles.screen}
      contentContainerStyle={[{ gap: spacing.md }, padding]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View testID={testID} style={[styles.screen, { gap: spacing.md }, padding]}>
      {children}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {body}
    </KeyboardAvoidingView>
  );
}

export function Banner({
  tone = 'info',
  title,
  body,
  testID,
}: {
  tone?: 'info' | 'warning' | 'error' | 'success';
  title: string;
  body?: string;
  testID?: string;
}): React.ReactElement {
  useEffect(() => {
    announce(body ? `${title}. ${body}` : title);
  }, [title, body]);

  const fg = {
    info: colors.ink,
    warning: colors.amber,
    error: colors.rose,
    success: colors.emerald,
  }[tone];

  return (
    <View
      testID={testID}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      // White fill, not bg-2: amber-on-bg-2 measured 4.49:1, just under AA.
      style={[styles.banner, { borderColor: fg }]}
    >
      <Txt variant="label" color={fg}>
        {title}
      </Txt>
      {body ? (
        <Txt variant="caption" color={colors.paleStone}>
          {body}
        </Txt>
      ) : null}
    </View>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }): React.ReactElement {
  return (
    <View
      // flex:1 — this is the whole-screen early return on most screens, and
      // without it the spinner hugs the top of the viewport.
      style={styles.fullScreenCentered}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      <ActivityIndicator color={colors.ink} />
      <Txt variant="caption" color={colors.paleStone} style={{ marginTop: spacing.sm }}>
        {label}
      </Txt>
    </View>
  );
}

/** Determinate progress with a spoken value — used by document upload. */
export function ProgressBar({
  label,
  fraction,
  testID,
}: {
  label: string;
  fraction: number;
  testID?: string;
}): React.ReactElement {
  const pct = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      accessibilityLiveRegion="polite"
      style={{ gap: spacing.xs }}
    >
      <Txt variant="label">{`${label} ${pct}%`}</Txt>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <View style={styles.centered}>
      <Txt variant="heading">{title}</Txt>
      {body ? (
        <Txt
          variant="body"
          color={colors.paleStone}
          style={{ textAlign: 'center', marginTop: spacing.sm }}
        >
          {body}
        </Txt>
      ) : null}
      {action ? <View style={{ marginTop: spacing.lg }}>{action}</View> : null}
    </View>
  );
}

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}): React.ReactElement {
  const fg = {
    neutral: colors.paleStone,
    success: colors.emerald,
    warning: colors.amber,
    danger: colors.rose,
  }[tone];
  return (
    <View style={[styles.badge, { borderColor: fg }]}>
      <Txt variant="caption" color={fg}>
        {label}
      </Txt>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperCanvas },
  button: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.btn,
    borderWidth: 1,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  link: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  field: { gap: spacing.xs },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    // WCAG 1.4.11 requires 3:1 for the boundary of a control. The Monad
    // hairline (rgba(0,0,0,.15)) is 1.41:1 — invisible as a field edge.
    borderColor: colors.fieldBorder,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    color: colors.ink,
    backgroundColor: '#ffffff',
    fontSize: typography.body.fontSize,
  },
  inputError: { borderColor: colors.rose },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.hairline2,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  banner: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: '#ffffff',
  },
  centered: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.xs },
  fullScreenCentered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.paperCanvas,
  },
  progressTrack: {
    height: 8,
    borderRadius: radii.sm,
    backgroundColor: colors.bg2,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.ink },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radii.tag,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
});
