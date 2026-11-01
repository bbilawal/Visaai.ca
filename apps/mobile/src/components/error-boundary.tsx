import React from 'react';
import { View } from 'react-native';
import { reportHandledError } from '@/observability/crash-reporting';
import { Button, Txt } from './ui';
import { colors, spacing } from '@/theme/tokens';

/**
 * Last line of defence against a render throw.
 *
 * Without a boundary, ANY exception thrown while rendering unmounts the whole
 * React tree and leaves a permanent white screen — no message, no retry, and
 * (before crash reporting existed) no signal that it ever happened. For an app
 * holding someone's immigration case, "the app is just white now" is the worst
 * possible failure mode: the user cannot tell whether their data survived.
 *
 * A class component is required — there is still no hook equivalent of
 * componentDidCatch.
 */
interface Props {
  children: React.ReactNode;
  /** Test seam so the fallback can be asserted without a real throw. */
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // The component stack is developer detail, not user data — but it is
    // scrubbed downstream anyway (see crash-reporting.sanitizeEvent).
    reportHandledError(error, { boundary: 'root', stack: info.componentStack ?? 'unknown' });
  }

  private reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  override render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.container} testID="error-boundary-fallback">
        <Txt variant="title" accessibilityRole="header">
          Something went wrong
        </Txt>
        <Txt variant="body" color={colors.paleStone} style={{ textAlign: 'center' }}>
          Your information is safe. Nothing you have saved was lost.
        </Txt>
        {/* The message itself is not shown: it can contain identifiers, and a
            stack trace is meaningless to the person holding the phone. */}
        <Button title="Try again" onPress={this.reset} testID="error-boundary-retry" />
      </View>
    );
  }
}

const styles = {
  container: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: colors.paperCanvas,
  },
};
