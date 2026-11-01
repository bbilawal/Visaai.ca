import { Redirect } from 'expo-router';
import React from 'react';

/**
 * Entry route. The real destination is decided by the guard in _layout.tsx
 * (signed out → sign-in, locked → unlock, otherwise → dashboard); this simply
 * hands control to it rather than duplicating the decision.
 */
export default function Index(): React.ReactElement {
  return <Redirect href="/(app)/dashboard" />;
}
