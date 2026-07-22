const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const startBtn = document.querySelector('#startBtn');
const stopBtn = document.querySelector('#stopBtn');
const clearBtn = document.querySelector('#clearBtn');
const historyBtn = document.querySelector('#historyBtn');
const closeHistoryBtn = document.querySelector('#closeHistoryBtn');
const historyPanel = document.querySelector('#historyPanel');
const language = document.querySelector('#language');
const continuous = document.querySelector('#continuous');
const statusEl = document.querySelector('#status');
const finalTextEl = document.querySelector('#finalText');
const interimTextEl = document.querySelector('#interimText');
const translationTextEl = document.querySelector('#translationText');
const translationHistoryEl = document.querySelector('#translationHistory');
const captionsFeed = document.querySelector('#captionsFeed');
const liveCard = document.querySelector('.captionItem.live');

let recognition;
let liveEnglish = '';
let finalEnglishHistory = [];
let spanishHistory = [];
let lastTranslationSource = '';
let lastClosedSource = '';
let translateTimer;
let pauseTimer;
let manuallyStopped = false;

const PAUSE_TO_CLOSE_MS = 1250;
const MAX_VISIBLE_CLOSED_CAPTIONS = 4;

function setStatus(text, type = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`.trim();
}

function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function closeSentence(text) {
  const clean = normalizeText(text);
  if (!clean) return '';
  if (/[.!?…]$/.test(clean)) return clean;
  return `${clean}.`;
}

function renderLive(english = '') {
  interimTextEl.textContent = english || 'Aquí aparecerá el inglés detectado…';
}

function renderHistory() {
  finalTextEl.textContent = finalEnglishHistory.join('\n\n');
  translationHistoryEl.textContent = spanishHistory.join('\n\n');
}

function addVisibleCaption(spanish, english) {
  const item = document.createElement('article');
  item.className = 'captionItem done';

  const translated = document.createElement('div');
  translated.className = 'subtitleText doneText';
  translated.textContent = spanish;

  const source = document.createElement('div');
  source.className = 'sourceText';
  source.textContent = english;

  item.append(translated, source);
  liveCard.after(item);

  const oldItems = [...captionsFeed.querySelectorAll('.captionItem.done')];
  oldItems.slice(MAX_VISIBLE_CLOSED_CAPTIONS).forEach((node) => node.remove());
}

async function translateToSpanish(text, { updateLive = true } = {}) {
  const clean = normalizeText(text);
  if (!clean) return '';
  if (updateLive && clean === lastTranslationSource) return translationTextEl.textContent;

  if (updateLive) {
    lastTranslationSource = clean;
    translationTextEl.textContent = 'Traduciendo…';
  }

  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'en');
  url.searchParams.set('tl', 'es');
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', clean);

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('translation failed');
    const data = await response.json();
    const translated = data?.[0]?.map((part) => part?.[0]).join('').trim();
    const result = translated || 'No pude traducir eso.';
    if (updateLive) translationTextEl.textContent = result;
    return result;
  } catch {
    const error = 'No pude traducir. Revisa internet e intenta otra vez.';
    if (updateLive) translationTextEl.textContent = error;
    return error;
  }
}

function scheduleLiveTranslation(english) {
  clearTimeout(translateTimer);
  translateTimer = setTimeout(() => translateToSpanish(english), 350);
}

function schedulePauseClose(english) {
  clearTimeout(pauseTimer);
  pauseTimer = setTimeout(() => commitCaption(english), PAUSE_TO_CLOSE_MS);
}

async function commitCaption(rawEnglish) {
  const english = closeSentence(rawEnglish || liveEnglish);
  if (!english) return;

  const fingerprint = english.toLowerCase();
  if (fingerprint === lastClosedSource.toLowerCase()) return;
  lastClosedSource = english;

  clearTimeout(translateTimer);
  const spanish = closeSentence(await translateToSpanish(english, { updateLive: false }));

  spanishHistory.unshift(spanish);
  finalEnglishHistory.unshift(english);
  addVisibleCaption(spanish, english);
  renderHistory();

  liveEnglish = '';
  lastTranslationSource = '';
  translationTextEl.textContent = '…';
  renderLive('');
}

function createRecognition() {
  if (!SpeechRecognition) return null;

  const rec = new SpeechRecognition();
  rec.lang = language.value;
  rec.interimResults = true;
  rec.continuous = continuous.checked;
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    setStatus('Escuchando inglés y traduciendo al español…', 'listening');
  };

  rec.onresult = (event) => {
    let interim = '';
    let gotFinal = false;

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        liveEnglish = normalizeText(`${liveEnglish} ${transcript}`);
        gotFinal = true;
      } else {
        interim += transcript;
      }
    }

    const displayedEnglish = normalizeText(`${liveEnglish} ${interim}`);
    renderLive(displayedEnglish);
    scheduleLiveTranslation(displayedEnglish);
    schedulePauseClose(displayedEnglish);

    if (gotFinal && !interim.trim()) schedulePauseClose(liveEnglish);
  };

  rec.onerror = (event) => {
    const messages = {
      'not-allowed': 'No tengo permiso para usar el micrófono. Actívalo en Safari.',
      'no-speech': 'No detecté voz. Intenta hablar más cerca del micrófono.',
      network: 'Error de red del reconocimiento de voz del navegador.',
    };
    setStatus(messages[event.error] || `Error: ${event.error}`, 'error');
  };

  rec.onend = () => {
    startBtn.disabled = false;
    stopBtn.disabled = true;

    if (liveEnglish) commitCaption(liveEnglish);

    if (!manuallyStopped && continuous.checked) {
      try {
        rec.start();
      } catch {
        setStatus('Pausado. Presiona “Empezar” para continuar.');
      }
      return;
    }

    setStatus('Detenido.');
  };

  return rec;
}

startBtn.addEventListener('click', () => {
  if (!SpeechRecognition) {
    setStatus('Este navegador no soporta reconocimiento de voz. Prueba Safari actualizado o Chrome.', 'error');
    return;
  }

  manuallyStopped = false;
  recognition = createRecognition();

  try {
    recognition.start();
  } catch {
    setStatus('Ya estoy escuchando o el navegador bloqueó el inicio.', 'error');
  }
});

stopBtn.addEventListener('click', () => {
  manuallyStopped = true;
  clearTimeout(pauseTimer);
  if (liveEnglish) commitCaption(liveEnglish);
  recognition?.stop();
});

clearBtn.addEventListener('click', () => {
  liveEnglish = '';
  finalEnglishHistory = [];
  spanishHistory = [];
  lastTranslationSource = '';
  lastClosedSource = '';
  clearTimeout(translateTimer);
  clearTimeout(pauseTimer);
  translationTextEl.textContent = 'Aquí aparecerá la traducción…';
  renderLive('');
  renderHistory();
  captionsFeed.querySelectorAll('.captionItem.done').forEach((node) => node.remove());
  setStatus('Texto limpiado.');
});

historyBtn.addEventListener('click', () => {
  historyPanel.hidden = false;
});

closeHistoryBtn.addEventListener('click', () => {
  historyPanel.hidden = true;
});

language.addEventListener('change', () => {
  if (recognition) recognition.lang = language.value;
});

renderLive('');
renderHistory();
