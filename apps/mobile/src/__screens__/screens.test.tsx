import React from 'react';
import * as SecureStore from 'expo-secure-store';
import { analytics } from '@/analytics/analytics';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

/**
 * Screen-level tests.
 *
 * The suite previously had ZERO of these — `collectCoverageFrom` excluded
 * `app/` entirely, so "144 passing tests" covered helper modules while every
 * screen the user actually touches was unverified. An independent review found
 * four screens calling endpoints with the wrong request or response shape;
 * none of them could fail a test, because no test rendered them.
 *
 * These render real screens against a mocked API and assert what the user sees.
 */
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: '11111111-1111-4111-8111-111111111111' }),
  usePathname: () => '/(app)/dashboard',
  useSegments: () => ['(app)'],
  useRootNavigationState: () => ({ key: 'root' }),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Redirect: () => null,
  Stack: () => null,
  Tabs: Object.assign(() => null, { Screen: () => null }),
}));

const mockUser = { id: 'user-1', email: 'a@b.co', appRole: 'user' as const, isAnonymous: false };
jest.mock('@/auth/session', () => ({
  useSession: () => ({
    status: 'authenticated',
    session: null,
    user: mockUser,
    error: null,
    signOut: jest.fn(),
    refresh: jest.fn(),
    unlock: jest.fn(),
  }),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// The mocks are CREATED INSIDE the factory. `import` statements are hoisted
// above `const`, so a factory closing over an outer const would read it in the
// temporal dead zone by the time a screen imports the module.
jest.mock('@/api/endpoints', () => ({
  applicationsApi: {
    list: jest.fn(),
    create: jest.fn(),
    progress: jest.fn(),
    checklist: jest.fn(),
  },
  messagingApi: { notifications: jest.fn() },
  consultantsApi: { bookings: jest.fn(), browse: jest.fn(), slots: jest.fn(), book: jest.fn() },
  aiApi: { analyze: jest.fn(), vri: jest.fn() },
  referenceApi: { countries: jest.fn() },
}));

const { applicationsApi, messagingApi, consultantsApi, aiApi, referenceApi } = jest.requireMock(
  '@/api/endpoints',
) as {
  // Explicit keys, not Record<string, jest.Mock>: `noUncheckedIndexedAccess`
  // makes every indexed access possibly-undefined.
  applicationsApi: { list: jest.Mock; create: jest.Mock; progress: jest.Mock; checklist: jest.Mock };
  messagingApi: { notifications: jest.Mock };
  consultantsApi: { bookings: jest.Mock; browse: jest.Mock; slots: jest.Mock; book: jest.Mock };
  aiApi: { analyze: jest.Mock; vri: jest.Mock };
  referenceApi: { countries: jest.Mock };
};

/* eslint-disable @typescript-eslint/no-require-imports --
   These modules must load AFTER the jest.mock calls above, so they cannot be
   hoisted ES imports. */
const DashboardScreen = require('../../app/(app)/dashboard').default as React.ComponentType;
const EligibilityScreen = require('../../app/(app)/eligibility').default as React.ComponentType;
const ConsultantsScreen = require('../../app/(app)/consultants').default as React.ComponentType;

function wrap(node: React.ReactElement): React.ReactElement {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      {node}
    </SafeAreaProvider>
  );
}

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  // Drafts persist to the (mocked) keychain, so without this a value typed in
  // one test is restored into the next one's form — which is both a test
  // isolation bug and, incidentally, proof that draft restore works.
  (SecureStore as unknown as { __store: Map<string, string> }).__store.clear();
  // Screens emit analytics, which arms a 2s flush timer. Left running it keeps
  // the jest worker alive past the test ("failed to exit gracefully").
  analytics.__reset();
});

describe('DashboardScreen', () => {
  beforeEach(() => {
    messagingApi.notifications.mockResolvedValue([]);
    consultantsApi.bookings.mockResolvedValue([]);
  });

  it('renders the applications returned by the API', async () => {
    applicationsApi.list.mockResolvedValue([
      {
        id: 'app-1',
        destination_country: 'Canada',
        status: 'draft',
        assignment_status: 'UNASSIGNED',
        assigned_consultant: null,
        created_at: null,
      },
    ]);

    const view = await render(wrap(<DashboardScreen />));

    await waitFor(() => expect(view.getByTestId('application-app-1')).toBeTruthy());
    expect(view.getByText('Canada')).toBeTruthy();
  });

  it('shows the empty state when the user has no applications', async () => {
    applicationsApi.list.mockResolvedValue([]);
    const view = await render(wrap(<DashboardScreen />));
    await waitFor(() => expect(view.getByTestId('start-application')).toBeTruthy());
  });

  it('surfaces an API failure instead of showing an empty dashboard', async () => {
    // The silent-empty-state failure mode is exactly what hid four broken
    // contracts, so a load error must be visible.
    applicationsApi.list.mockRejectedValue(new Error('boom'));
    const view = await render(wrap(<DashboardScreen />));
    await waitFor(() => expect(view.getByText('Something went wrong')).toBeTruthy());
  });

  it('reads applications through the API, not a direct table query', async () => {
    applicationsApi.list.mockResolvedValue([]);
    await render(wrap(<DashboardScreen />));
    await waitFor(() => expect(applicationsApi.list).toHaveBeenCalled());
  });
});

describe('EligibilityScreen', () => {
  beforeEach(() => {
    referenceApi.countries.mockResolvedValue({ countries: [{ code: 'CA', name: 'Canada' }] });
  });

  it('sends the contract the API actually requires', async () => {
    // country + visaType + profile. The old screen posted { description } and
    // was rejected with a 400 on every attempt.
    aiApi.analyze.mockResolvedValue({ ok: true, research: {}, evaluation: {}, report: 'Report body' });
    const view = await render(wrap(<EligibilityScreen />));

    await fireEvent.changeText(view.getByTestId('country-input'), 'CA');
    await fireEvent.changeText(view.getByTestId('visa-type-input'), 'visitor');
    await fireEvent.changeText(
      view.getByTestId('situation-input'),
      'I am a software engineer planning a three week holiday.',
    );
    await fireEvent.press(view.getByTestId('analyze-button'));

    await waitFor(() =>
      expect(aiApi.analyze).toHaveBeenCalledWith({
        country: 'CA',
        visaType: 'visitor',
        profile: 'I am a software engineer planning a three week holiday.',
      }),
    );
  });

  it('renders the report and the AI disclaimer together', async () => {
    aiApi.analyze.mockResolvedValue({ ok: true, research: {}, evaluation: {}, report: 'Report body' });
    const view = await render(wrap(<EligibilityScreen />));

    await fireEvent.changeText(view.getByTestId('country-input'), 'CA');
    await fireEvent.changeText(view.getByTestId('visa-type-input'), 'visitor');
    await fireEvent.changeText(view.getByTestId('situation-input'), 'A sufficiently long description here.');
    await fireEvent.press(view.getByTestId('analyze-button'));

    await waitFor(() => expect(view.getByTestId('analysis-report')).toBeTruthy());
    // The disclaimer is a compliance requirement, not decoration.
    expect(view.getByText(/not legal advice/i)).toBeTruthy();
  });

  it('refuses to call the API with an incomplete form', async () => {
    const view = await render(wrap(<EligibilityScreen />));
    await fireEvent.press(view.getByTestId('analyze-button'));
    // The banner title is the generic error heading; the specific reason is its
    // body. Asserting on the heading keeps this test independent of copy.
    await waitFor(() => expect(view.getByText('Something went wrong')).toBeTruthy());
    expect(aiApi.analyze).not.toHaveBeenCalled();
  });
});

describe('ConsultantsScreen', () => {
  it('renders consultants from a BARE ARRAY response', async () => {
    // Reading `.items` off an array produced a permanent empty state and made
    // every downstream booking flow unreachable.
    consultantsApi.browse.mockResolvedValue([
      { id: 'c1', full_name: 'Dana Patel', headline: 'Study permits', rating_avg: 4.8 },
    ]);

    const view = await render(wrap(<ConsultantsScreen />));

    await waitFor(() => expect(view.getByTestId('consultant-c1')).toBeTruthy());
    expect(view.getByText('Dana Patel')).toBeTruthy();
  });

  it('shows the empty state only when the list is genuinely empty', async () => {
    consultantsApi.browse.mockResolvedValue([]);
    const view = await render(wrap(<ConsultantsScreen />));
    await waitFor(() => expect(view.getByText('No consultants available')).toBeTruthy());
  });
});
