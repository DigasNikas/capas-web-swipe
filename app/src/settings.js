import { state, SETTINGS_KEY } from './state.js';
import { modalOverlay, definicoesModal, definicoesWarning, voteBar } from './dom.js';
import { animateModalClose } from './modals.js';

const VOTE_METHOD_KEYS = ['voteSwipe', 'voteButtons', 'voteKeyboard'];

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

export function applyTheme() {
  const light = state.settings.theme === 'light';
  document.body.classList.toggle('theme-light', light);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#ffffff' : '#13131a');
}

function updateWarning() {
  const onlyKeyboard = state.settings.voteKeyboard && !state.settings.voteSwipe && !state.settings.voteButtons;
  definicoesWarning.classList.toggle('hidden', !onlyKeyboard);
}

function syncSwitches() {
  definicoesModal.querySelectorAll('.switch').forEach(input => {
    const key = input.dataset.setting;
    input.checked = key === 'theme' ? state.settings.theme === 'light' : state.settings[key];
  });
  updateWarning();
}

export function openDefinicoes() {
  syncSwitches();
  definicoesModal.classList.remove('hidden');
  modalOverlay.classList.remove('hidden');
}

export function closeDefinicoes() {
  animateModalClose(definicoesModal, () => {
    definicoesModal.classList.add('hidden');
    modalOverlay.classList.add('hidden');
  });
}

export function handleSettingChange(input) {
  const key = input.dataset.setting;

  if (key === 'theme') {
    state.settings.theme = input.checked ? 'light' : 'dark';
    applyTheme();
    saveSettings();
    return;
  }

  // At least one vote method must stay active — refuse the change instead
  // of leaving the app with no way to vote.
  if (VOTE_METHOD_KEYS.includes(key) && !input.checked) {
    const othersActive = VOTE_METHOD_KEYS.some(k => k !== key && state.settings[k]);
    if (!othersActive) { input.checked = true; return; }
  }

  state.settings[key] = input.checked;

  if (key === 'voteButtons') {
    voteBar.classList.toggle('hidden', state.presentationMode || !state.settings.voteButtons);
  }

  updateWarning();
  saveSettings();
}
