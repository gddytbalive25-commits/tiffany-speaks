export type SpeechResult = { transcript: string };
export type SpeechResultEvent = Event & {
  resultIndex: number;
  results: ArrayLike<ArrayLike<SpeechResult> & { isFinal: boolean }>;
};

export type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type RecognitionConstructor = new () => Recognition;
type SpeechWindow = Window & {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
};

export function createRecognition(): Recognition | null {
  if (typeof window === 'undefined') return null;
  const speechWindow = window as SpeechWindow;
  const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  return SpeechRecognition ? new SpeechRecognition() : null;
}

export function speakText(text: string): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.94;
  window.speechSynthesis.speak(utterance);
  return true;
}
