import React from 'react';
import { Stack } from 'expo-router';
import { colors, typography } from '@/theme/tokens';

/**
 * Stack layout for the application detail routes.
 *
 * Two problems this fixes:
 *
 *  1. Without a layout here, expo-router hoisted `applications/[id]/*` to the
 *     nearest parent — the Tabs navigator — so the detail screens registered as
 *     sibling TABS. The `<Tabs.Screen name="applications" href={null} />` entry
 *     matched nothing, leaving extra buttons crammed into the tab bar.
 *  2. Both navigators ran with `headerShown: false` and nothing called
 *     `router.back()`, so there was NO back control on any detail screen. A push
 *     deep link dropped the user into a case with no way out.
 */
export default function ApplicationsLayout(): React.ReactElement {
  return (
    <Stack
      screenOptions={{
        // A real header gives the platform back affordance (and the swipe-back
        // gesture on iOS) for free, with the correct accessibility semantics.
        headerShown: true,
        headerBackTitle: 'Back',
        headerTintColor: colors.ink,
        headerStyle: { backgroundColor: colors.paperCanvas },
        headerTitleStyle: {
          color: colors.ink,
          fontSize: typography.heading.fontSize,
          fontWeight: typography.heading.fontWeight,
        },
        contentStyle: { backgroundColor: colors.paperCanvas },
      }}
    >
      <Stack.Screen name="[id]/index" options={{ title: 'Application' }} />
      <Stack.Screen name="[id]/documents" options={{ title: 'Documents' }} />
      <Stack.Screen name="[id]/messages" options={{ title: 'Messages' }} />
    </Stack>
  );
}
