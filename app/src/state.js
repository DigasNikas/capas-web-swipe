export const ACTIVE_DATE_KEY = 'capas-active-date';
export const API_URL         = '/api';

export const SWIPE_THRESHOLD = 80;
export const ROTATION_FACTOR = 0.08;

// Matches landing's club colors exactly (landing/landing.css :root) —
// keep this in sync with app/style.css's --keep/--reject/--favorite/--skip.
export const FEEDBACK_COLORS = {
  left:  [220, 38,  38],  // Benfica  #dc2626
  right: [22,  163, 74],  // Sporting #16a34a
  up:    [82,  82,  91],  // Restantes #52525b
  down:  [29,  78,  216], // Porto    #1d4ed8
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
