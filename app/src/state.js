export const ACTIVE_DATE_KEY = 'capas-active-date';
export const API_URL         = '/api';

export const SWIPE_THRESHOLD = 80;
export const ROTATION_FACTOR = 0.08;

export const FEEDBACK_COLORS = {
  left:  [239, 68,  68],
  right: [34,  197, 94],
  up:    [245, 158, 11],
  down:  [99,  102, 241],
};

export const ACTIONS = {
  right: { name: 'keep',     icon: '🦁', label: 'SPORTING', decision: 'sporting' },
  left:  { name: 'reject',   icon: '🦅', label: 'BENFICA',  decision: 'benfica'  },
  up:    { name: 'favorite', icon: '?',  label: 'RESTANTES', decision: 'others'   },
  down:  { name: 'skip',     icon: '🐉', label: 'PORTO',    decision: 'porto'    },
};

export const DECISION_TO_ACTION = Object.fromEntries(
  Object.values(ACTIONS).map(a => [a.decision, a.name])
);

export const state = {
  images:           [],
  dateGroups:       [],
  groupIndex:       0,
  queue:            [],
  catalogue:        [],
  presentationMode: true,
};
