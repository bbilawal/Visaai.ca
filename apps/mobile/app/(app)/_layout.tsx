import React, { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useSession } from '@/auth/session';
import { useI18n } from '@/i18n/i18n';
import { registerForPush } from '@/notifications/push';
import { colors, MIN_TOUCH_TARGET } from '@/theme/tokens';

/**
 * Authenticated app shell.
 *
 * Push registration happens here rather than at root: a token registered before
 * sign-in would be attached to no user (or worse, the previous one on a shared
 * device). Registering once a real, non-guest session exists keeps the
 * device→user mapping honest.
 */
function TabIcon({ label, focused }: { label: string; focused: boolean }): React.ReactElement {
  // Emoji glyphs avoid pulling an icon font into the bundle. They are marked
  // decorative so screen readers announce the tab's real label, not "postbox".
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{ fontSize: 18, opacity: focused ? 1 : 0.5 }}
    >
      {label}
    </Text>
  );
}

export default function AppLayout(): React.ReactElement {
  const { t } = useI18n();
  const { status } = useSession();

  useEffect(() => {
    if (status !== 'authenticated') return;
    void registerForPush();
  }, [status]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.faintText,
        tabBarStyle: {
          backgroundColor: colors.paperCanvas,
          borderTopColor: colors.hairline1,
          minHeight: MIN_TOUCH_TARGET + 8,
        },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: t('dashboard.title'),
          tabBarIcon: ({ focused }) => <TabIcon label="🗂" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="eligibility"
        options={{
          title: t('eligibility.title'),
          tabBarIcon: ({ focused }) => <TabIcon label="🧭" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="voice"
        options={{
          title: 'Voice',
          tabBarIcon: ({ focused }) => <TabIcon label="🎙" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="consultants"
        options={{
          title: t('booking.consultants'),
          tabBarIcon: ({ focused }) => <TabIcon label="👤" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('settings.title'),
          tabBarIcon: ({ focused }) => <TabIcon label="⚙️" focused={focused} />,
        }}
      />
      {/* Reachable by navigation and deep links, but not tab bar entries. */}
      <Tabs.Screen name="applications" options={{ href: null }} />
      <Tabs.Screen name="appointments" options={{ href: null }} />
      <Tabs.Screen name="billing" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
    </Tabs>
  );
}
