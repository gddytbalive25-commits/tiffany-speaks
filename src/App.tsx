import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Cue } from './lib/grammar';
import { getGrammarCues } from './lib/grammar';
import { CATALOG } from './lib/catalog';
import { createRecognition, speakText, type Recognition } from './lib/speech';
import { listClips, removeClip, saveClip, type SavedClip } from './lib/clips';

type View = 'call' | 'sign' | 'train' | 'library' | 'plans' | 'help';
type TranscriptItem = { id: string; time: number; source: string; text: string; cues: Cue[] };
type SessionInfo = { buyerId: string; plus: boolean; email: string | null };
type Offerings = { oneTimeReady: boolean; subscriptionReady: boolean; stripeReady: boolean; mode: 'test' | 'live' | 'not configured' };
type Purchase = { id: string; plan: string; status: string; amount: number | null; currency: string | null; createdAt: string };
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const FREE_CLIP_LIMIT = 10;
const TRANSCRIPT_LIMIT = 100;
const AVATAR = '/images/tiffany-avatar.jpg';
const VIEW_LABELS: Record<View, string> = {
  call: 'Call', sign: 'Sign', train: 'Train', library: 'Library', plans: 'Plans', help: 'Setup',
};

function formatTime(epoch: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(epoch);
}

function describeMediaError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Camera access was declined. You can allow it in your browser’s site settings and try again.';
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'No camera was found on this device.';
  return 'The camera could not be opened. Check site permissions and try again.';
}

function MarkerList({ cues }: { cues: Cue[] }) {
  return (
    <div className="cue-list" aria-label="ASL discussion cues — reference only">
      {cues.map((cue) => (
        <div className="cue-chip" key={cue.key}>
          <span className="cue-dot" aria-hidden="true" />
          <span><strong>{cue.label}</strong><small>{cue.detail}</small></span>
        </div>
      ))}
      <p className="micro-note">Reference cues only—not a validated ASL translation.</p>
    </div>
  );
}

function SavedClipCard({ clip, onDelete }: { clip: SavedClip; onDelete: () => void }) {
  const url = useMemo(() => URL.createObjectURL(clip.blob), [clip]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <article className="saved-clip">
      <video className="clip-player" src={url} controls playsInline preload="metadata" aria-label={`Practice clip: ${clip.label}`} />
      <div className="clip-meta">
        <div><strong>{clip.label}</strong><small>Saved on this device · {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(clip.createdAt)}</small></div>
        <button className="text-button danger-text" onClick={onDelete} type="button">Delete</button>
      </div>
    </article>
  );
}

export default function App() {
  const [view, setView] = useState<View>('call');
  const [callActive, setCallActive] = useState(false);
  const [callStatus, setCallStatus] = useState('Ready when you are');
  const [callMessage, setCallMessage] = useState('Put your phone call on speaker. Tiffany Speaks listens through your device microphone.');
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [phrase, setPhrase] = useState('');
  const [manualPhrase, setManualPhrase] = useState('');
  const [spokenPhrase, setSpokenPhrase] = useState('');
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraMessage, setCameraMessage] = useState('Camera is off. Turn it on when you are ready to practice.');
  const [clips, setClips] = useState<SavedClip[]>([]);
  const [recording, setRecording] = useState(false);
  const [recordingLabel, setRecordingLabel] = useState('');
  const [trainingMessage, setTrainingMessage] = useState('Your labelled clips stay in this browser on this device.');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'free' | 'plus'>('all');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [buyerEmail, setBuyerEmail] = useState('');
  const [offerings, setOfferings] = useState<Offerings>({ oneTimeReady: false, subscriptionReady: false, stripeReady: false, mode: 'not configured' });
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [billingMessage, setBillingMessage] = useState('');
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [toast, setToast] = useState('');
  const recognitionRef = useRef<Recognition | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const activeRef = useRef(false);

  const addTranscript = useCallback((source: string, text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setTranscript((items) => [{ id: crypto.randomUUID(), time: Date.now(), source, text: clean, cues: getGrammarCues(clean) }, ...items].slice(0, TRANSCRIPT_LIMIT));
  }, []);

  const loadLocalClips = useCallback(async () => {
    try {
      setClips(await listClips());
    } catch (error) {
      setTrainingMessage(error instanceof Error ? error.message : 'Could not load local practice clips.');
    }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const response = await fetch('/api/session', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Session service is unavailable.');
      const info = await response.json() as SessionInfo;
      setSession(info);
      setBuyerEmail(info.email ?? '');
    } catch {
      setSession(null);
    }
  }, []);

  const loadOfferings = useCallback(async () => {
    try {
      const response = await fetch('/api/payments/offerings');
      if (response.ok) setOfferings(await response.json() as Offerings);
    } catch {
      // The rest of the app remains usable while the billing service is unavailable.
    }
  }, []);

  const loadPurchases = useCallback(async () => {
    try {
      const response = await fetch('/api/orders', { credentials: 'same-origin' });
      if (response.ok) setPurchases(await response.json() as Purchase[]);
    } catch {
      setBillingMessage('Purchase history is temporarily unavailable.');
    }
  }, []);

  useEffect(() => {
    setSpeechAvailable(Boolean(createRecognition()));
    void loadLocalClips();
    void refreshSession();
    void loadOfferings();
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    const installedEvent = () => { setInstalled(true); setInstallPrompt(null); };
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', installedEvent);
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', installedEvent);
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
    };
    // Initialization should not re-run when browser state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    cameraStream?.getTracks().forEach((track) => track.stop());
  }, [cameraStream]);

  useEffect(() => {
    if (videoRef.current && cameraStream) videoRef.current.srcObject = cameraStream;
  }, [cameraStream, view]);

  useEffect(() => {
    if (view === 'plans') {
      void loadPurchases();
      void refreshSession();
      void loadOfferings();
    }
  }, [view, loadOfferings, loadPurchases, refreshSession]);

  const stopListening = useCallback(() => {
    activeRef.current = false;
    setCallActive(false);
    setInterimText('');
    setCallStatus('Ready when you are');
    try { recognitionRef.current?.stop(); } catch { /* Already inactive. */ }
    recognitionRef.current = null;
  }, []);

  const stopCamera = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    cameraStream?.getTracks().forEach((track) => track.stop());
    setCameraStream(null);
    setCameraMessage('Camera is off. Turn it on when you are ready to practice.');
  }, [cameraStream]);

  const navigate = (next: View) => {
    if (next !== 'call') stopListening();
    if (next !== 'sign' && next !== 'train') stopCamera();
    setView(next);
  };

  const toggleListening = async () => {
    if (callActive) {
      stopListening();
      setCallMessage('Listening stopped. Your transcript stays visible on this screen.');
      return;
    }
    const recognition = createRecognition();
    if (!recognition) {
      setSpeechAvailable(false);
      setCallMessage('Speech recognition is not available in this browser. Try a supported browser or continue by typing a sample phrase below.');
      return;
    }
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    activeRef.current = true;
    recognition.onresult = (event) => {
      let finalText = '';
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += `${result[0]?.transcript ?? ''} `;
        else interim += `${result[0]?.transcript ?? ''} `;
      }
      setInterimText(interim.trim());
      if (finalText.trim()) addTranscript('Caller audio · browser transcript', finalText);
    };
    recognition.onerror = (event) => {
      const error = event.error ?? 'unknown';
      setCallMessage(error === 'not-allowed'
        ? 'Microphone access was denied. Allow microphone access in your browser’s site settings and try again.'
        : `Speech recognition stopped (${error}). Browser speech services can vary by device and connection.`);
      activeRef.current = false;
      setCallActive(false);
    };
    recognition.onend = () => {
      if (activeRef.current) {
        activeRef.current = false;
        setCallActive(false);
        setCallStatus('Ready when you are');
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setCallActive(true);
      setCallStatus('Listening to speakerphone');
      setCallMessage('Listening through the device microphone. Keep the phone call on speaker and the volume comfortably audible.');
    } catch {
      activeRef.current = false;
      setCallActive(false);
      setCallMessage('Could not start speech recognition. Check microphone permission and whether another session is active.');
    }
  };

  const enableCamera = async () => {
    if (cameraStream) {
      stopCamera();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMessage('Camera access is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      setCameraStream(stream);
      setCameraMessage('Camera is on. This preview is not analyzed for sign recognition.');
    } catch (error) {
      setCameraMessage(describeMediaError(error));
    }
  };

  const speakSelectedPhrase = () => {
    const clean = manualPhrase.trim();
    if (!clean) {
      setToast('Type or choose the words you signed first.');
      return;
    }
    setSpokenPhrase(clean);
    addTranscript('Your sign · entered manually', clean);
    const available = speakText(clean);
    setToast(available ? 'Speaking this text on your device. Caller audio routing depends on your phone and call setup.' : 'Text-to-speech is unavailable on this device.');
  };

  const previewCallPhrase = () => {
    const clean = phrase.trim();
    if (!clean) return;
    addTranscript('Practice phrase · typed', clean);
    setPhrase('');
  };

  const startRecording = () => {
    if (!cameraStream) {
      setTrainingMessage('Turn on the camera before recording a practice clip.');
      return;
    }
    if (!recordingLabel.trim()) {
      setTrainingMessage('Add a short label for the sign before you record.');
      return;
    }
    if (!session?.plus && clips.length >= FREE_CLIP_LIMIT) {
      setTrainingMessage(`The free plan includes up to ${FREE_CLIP_LIMIT} local practice clips. View plans to see the Plus options.`);
      return;
    }
    if (!('MediaRecorder' in window)) {
      setTrainingMessage('Video recording is not supported in this browser.');
      return;
    }
    try {
      const type = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
      const recorder = new MediaRecorder(cameraStream, { mimeType: type });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      recorder.onstop = async () => {
        if (chunks.length === 0) {
          setTrainingMessage('No clip data was captured. Check storage permission and try again.');
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
        try {
          await saveClip({ id: crypto.randomUUID(), label: recordingLabel.trim(), createdAt: Date.now(), blob, mimeType: blob.type });
          await loadLocalClips();
          setTrainingMessage('Practice clip saved on this device. It does not train a recognition model.');
          setRecordingLabel('');
        } catch (error) {
          setTrainingMessage(error instanceof Error ? error.message : 'The clip could not be saved locally.');
        }
      };
      recorder.start(250);
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setTrainingMessage('Recording locally. Stop when you are finished.');
    } catch {
      setTrainingMessage('The browser could not start video recording. Check available storage and camera permission.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    setRecording(false);
  };

  const deleteClip = async (clip: SavedClip) => {
    if (!window.confirm(`Delete the local practice clip “${clip.label}”? This cannot be undone.`)) return;
    try {
      await removeClip(clip.id);
      await loadLocalClips();
      setTrainingMessage('Clip deleted from this device.');
    } catch (error) {
      setTrainingMessage(error instanceof Error ? error.message : 'Could not delete the clip.');
    }
  };

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') setInstalled(true);
    setInstallPrompt(null);
  };

  const beginCheckout = async (plan: 'one_time' | 'subscription') => {
    const checkoutTab = window.open('about:blank', '_blank');
    setBillingMessage('Opening secure Stripe test checkout in a new tab…');
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, email: buyerEmail.trim() }),
      });
      const result = await response.json() as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error ?? 'Checkout is not available yet.');
      if (checkoutTab) {
        checkoutTab.opener = null;
        checkoutTab.location.href = result.url;
      } else {
        window.location.assign(result.url);
      }
    } catch (error) {
      checkoutTab?.close();
      setBillingMessage(error instanceof Error ? error.message : 'Checkout could not be started.');
    }
  };

  const visibleCatalog = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return CATALOG.filter((item) => {
      const allowed = item.tier === 'free' || session?.plus || filter !== 'all' && filter === 'plus';
      const matchesFilter = filter === 'all' || filter === item.tier;
      const matchesQuery = !query || `${item.gloss} ${item.category}`.toLocaleLowerCase().includes(query);
      return allowed && matchesFilter && matchesQuery;
    });
  }, [filter, search, session?.plus]);

  const contentTitle = view === 'call' ? 'Call audio → sign guidance'
    : view === 'sign' ? 'Your sign → speech'
      : view === 'train' ? 'Build your personal practice shelf'
        : view === 'library' ? 'Sign library'
          : view === 'plans' ? 'Plans for your practice'
            : 'Permissions & setup';

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand-lockup" type="button" onClick={() => navigate('call')} aria-label="Tiffany Speaks home">
          <img src="/brand-mark.svg" alt="" width="42" height="42" />
          <span><strong>Tiffany Speaks</strong><small>Good Day To Be Alive LLC</small></span>
        </button>
        <div className="top-actions">
          {installPrompt && !installed && <button className="quiet-button install-button" type="button" onClick={() => void installApp()}>Install app</button>}
          {installed && <span className="installed-label">Installed</span>}
          <button className="quiet-button setup-button" type="button" onClick={() => navigate('help')}>Permissions</button>
          <button className="quiet-button plans-button" type="button" onClick={() => navigate('plans')}>Plans</button>
        </div>
      </header>

      <main>
        <section className="welcome-row">
          <div>
            <p className="eyebrow">A communication companion, with care</p>
            <h1>{contentTitle}</h1>
            <p className="welcome-copy">A calm place to listen, practice, and make your words easier to share.</p>
          </div>
          <div className={`status-pill ${callActive ? 'is-live' : ''}`}><span className="status-dot" />{callActive ? 'Listening' : callStatus}</div>
        </section>

        <div className="workbench">
          <aside className="portrait-card">
            <div className="portrait-image-wrap">
              <img className="portrait-image" src={AVATAR} alt="Tiffany portrait used as the visual guide for Tiffany Speaks" />
              <span className="portrait-blink-overlay" aria-hidden="true" />
              <span className="portrait-badge"><span className="badge-dot" />Tiffany’s guide</span>
            </div>
            <div className="portrait-caption">
              <p className="eyebrow">Here with you</p>
              <h2>Words deserve room to land.</h2>
              <p>This is Tiffany’s supplied photo—not an animated signing avatar. Signing media will be added only when licensed and reviewed.</p>
            </div>
            <div className="portrait-foot"><span className="tiny-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span><span>Made for Good Day To Be Alive LLC</span></div>
          </aside>

          <section className="workspace" aria-live="polite">
            {view === 'call' && (
              <>
                <div className="mode-intro">
                  <span className="mode-number">01 / CALL</span>
                  <h2>Let the call be heard.</h2>
                  <p>Put the call on speaker; your microphone can pick up the other person. Speech recognition depends on browser support, network, and device settings.</p>
                </div>
                <div className="speaker-guide">
                  <div className="guide-icon" aria-hidden="true"><span className="speaker-shape" /></div>
                  <div><strong>Speakerphone works best</strong><p>Keep the device volume comfortably audible and the phone near the conversation. A browser may not receive phone-call audio directly.</p></div>
                </div>
                <button className={`primary-action ${callActive ? 'stop-action' : ''}`} type="button" onClick={() => void toggleListening()}>
                  <span className="action-symbol" aria-hidden="true">{callActive ? 'Ⅱ' : '●'}</span>{callActive ? 'Stop listening' : 'Start listening'}
                </button>
                <p className="inline-status" role="status">{callMessage}</p>
                {!speechAvailable && <div className="notice notice-soft"><strong>Browser support varies</strong><span>Speech-to-text is not available in this browser right now. You can still try a phrase below and view the reference cues.</span></div>}
                <div className="try-phrase">
                  <label htmlFor="call-phrase">Try a sentence</label>
                  <div className="input-row"><input id="call-phrase" value={phrase} onChange={(event) => setPhrase(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') previewCallPhrase(); }} placeholder="Type a sample phrase…" /><button className="secondary-button" type="button" onClick={previewCallPhrase}>Preview cues</button></div>
                </div>
                <div className="transcript-panel">
                  <div className="panel-heading"><div><span className="eyebrow">LIVE CAPTIONS</span><h3>Conversation notes</h3></div><div className="panel-actions"><span className="count-label">{transcript.length} / {TRANSCRIPT_LIMIT}</span>{transcript.length > 0 && <button className="text-button" type="button" onClick={() => setTranscript([])}>Clear</button>}</div></div>
                  {interimText && <p className="interim-caption"><span className="status-dot" />{interimText}</p>}
                  {transcript.length === 0 ? <div className="empty-state"><span className="empty-line" /><p>Your captions and simple discussion cues will appear here.</p></div> : <div className="transcript-list">{transcript.map((item) => <article className="transcript-item" key={item.id}><div className="transcript-meta"><strong>{item.source}</strong><time>{formatTime(item.time)}</time></div><p className="transcript-text">{item.text}</p><MarkerList cues={item.cues} /></article>)}</div>}
                </div>
              </>
            )}

            {view === 'sign' && (
              <>
                <div className="mode-intro"><span className="mode-number">02 / SIGN</span><h2>Choose what you signed.</h2><p>Use the camera as a mirror, then enter or select the words for text-to-speech. This MVP does not visually recognize hand signs.</p></div>
                <CameraCard stream={cameraStream} videoRef={videoRef} message={cameraMessage} onToggle={() => void enableCamera()} />
                <div className="notice notice-amber"><strong>Recognition is not active yet</strong><span>The camera preview is not analyzed. Select or type your intended words below; the app will label them as entered manually.</span></div>
                <div className="field-block"><label htmlFor="manual-phrase">Your sign (type or choose a label)</label><input id="manual-phrase" list="catalog-labels" value={manualPhrase} onChange={(event) => setManualPhrase(event.target.value)} placeholder="For example: hello" /><datalist id="catalog-labels">{CATALOG.map((item) => <option key={item.id} value={item.gloss} />)}</datalist></div>
                <button className="primary-action" type="button" onClick={speakSelectedPhrase}><span className="action-symbol" aria-hidden="true">↗</span>Speak this text</button>
                <div className="caller-hears" aria-live="polite"><span className="eyebrow">CALLER HEARS THIS</span><p>{spokenPhrase ? `“${spokenPhrase}”` : 'Your spoken text will appear here.'}</p><small>Text-to-speech uses your device voice. Your phone call may not route browser audio to the caller automatically.</small></div>
              </>
            )}

            {view === 'train' && (
              <>
                <div className="mode-intro"><span className="mode-number">03 / TRAIN</span><h2>Save a clip in your own style.</h2><p>Record a short practice video and give it a label. Clips are saved locally on this device; they do not train or improve a recognition model.</p></div>
                <CameraCard stream={cameraStream} videoRef={videoRef} message={cameraMessage} onToggle={() => void enableCamera()} />
                <div className="training-controls">
                  <div className="field-block"><label htmlFor="record-label">Clip label</label><input id="record-label" value={recordingLabel} onChange={(event) => setRecordingLabel(event.target.value)} placeholder="A word or phrase to remember" maxLength={80} /></div>
                  <button className={`primary-action ${recording ? 'stop-action' : ''}`} type="button" disabled={!recording && !session?.plus && clips.length >= FREE_CLIP_LIMIT} onClick={recording ? stopRecording : startRecording}><span className="action-symbol" aria-hidden="true">{recording ? '■' : '◉'}</span>{recording ? 'Stop & save clip' : 'Record practice clip'}</button>
                  <div className="local-limit"><span>{session?.plus ? 'Plus' : 'Free'} practice shelf</span><span>{clips.length}{session?.plus ? ' saved' : ` / ${FREE_CLIP_LIMIT} clips`}</span></div>
                  {!session?.plus && clips.length >= FREE_CLIP_LIMIT && <button className="text-button" type="button" onClick={() => navigate('plans')}>View Plus plans</button>}
                  <p className="inline-status" role="status">{trainingMessage}</p>
                </div>
                <div className="transcript-panel"><div className="panel-heading"><div><span className="eyebrow">ON THIS DEVICE</span><h3>Your practice clips</h3></div><span className="count-label">{clips.length} saved</span></div>{clips.length === 0 ? <div className="empty-state"><p>No clips saved yet. Turn on the camera, add a label, and record a short practice clip.</p></div> : <div className="saved-clips">{clips.map((clip) => <SavedClipCard key={clip.id} clip={clip} onDelete={() => void deleteClip(clip)} />)}</div>}</div>
                <p className="privacy-note">These video clips stay in local browser storage and may be removed if browser data is cleared. They are not uploaded.</p>
              </>
            )}

            {view === 'library' && (
              <>
                <div className="mode-intro"><span className="mode-number">04 / LIBRARY</span><h2>Start with a word list.</h2><p>The offline starter contains English gloss labels only—not ASL definitions, movement instructions, or sign videos. Licensed media can be added later.</p></div>
                <div className="library-tools"><label className="search-field"><span className="visually-hidden">Search catalog</span><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search the catalog" /></label><select aria-label="Filter catalog by plan" value={filter} onChange={(event) => setFilter(event.target.value as 'all' | 'free' | 'plus')}><option value="all">All labels</option><option value="free">Free</option><option value="plus">Plus</option></select></div>
                <div className="catalog-grid">{visibleCatalog.map((item) => { const locked = item.tier === 'plus' && !session?.plus; return <article className={`catalog-card ${locked ? 'locked-card' : ''}`} key={item.id}><div className="catalog-topline"><span className="category-label">{item.category}</span><span className={`tier-pill ${item.tier}`}>{locked ? 'Plus' : item.tier === 'free' ? 'Free' : 'Plus'}</span></div><h3>{item.gloss}</h3><p>English gloss label · no sign video included</p><button className="catalog-action" type="button" onClick={() => locked ? navigate('plans') : (setManualPhrase(item.gloss), navigate('sign'))}>{locked ? 'See Plus plans' : 'Use this phrase'}</button></article>; })}{visibleCatalog.length === 0 && <div className="empty-state"><p>No matching labels. Try another word or clear the filter.</p></div>}</div>
                <div className="notice notice-soft"><strong>Expandable when ready</strong><span>Sign footage and definitions will be added only from licensed, ASL-reviewed sources. This text-only library works offline with the app shell.</span></div>
              </>
            )}

            {view === 'plans' && (
              <>
                <div className="mode-intro"><span className="mode-number">GOOD DAY TO BE ALIVE LLC</span><h2>A little more room to practice.</h2><p>Free includes ten locally saved practice clips and the starter gloss list. Plus is designed for unlimited local clips, expanded catalog labels, and future licensed library updates.</p></div>
                <div className="notice notice-amber"><strong>{offerings.mode === 'test' ? 'Test checkout only' : offerings.mode === 'live' ? 'Live Stripe mode configured' : 'Checkout setup needed'}</strong><span>{offerings.mode === 'test' ? 'Stripe is connected in test mode. Checkout stays unavailable until one-time and/or subscription price IDs are configured. Plus does not currently include sign videos.' : offerings.mode === 'live' ? 'Live payments are configured. Confirm pricing, terms, privacy, support, domain, and webhook fulfillment before opening sales. Plus does not currently include sign videos.' : 'Stripe credentials or price IDs are not ready. Configure one-time and/or subscription Price IDs before enabling Checkout. Plus does not currently include sign videos.'}</span></div>
                <div className="field-block"><label htmlFor="buyer-email">Email for your Stripe receipt (optional)</label><input id="buyer-email" type="email" autoComplete="email" value={buyerEmail} onChange={(event) => setBuyerEmail(event.target.value)} placeholder="you@example.com" /></div>
                <div className="plan-grid">
                  <article className="plan-card"><span className="plan-kicker">START HERE</span><h3>Free</h3><p className="plan-price">$0 <small>always</small></p><ul><li>10 personal practice clips</li><li>10 starter gloss labels</li><li>Offline app shell</li></ul><span className="current-plan">Available now</span></article>
                  <article className="plan-card featured-plan"><span className="plan-kicker">MORE ROOM</span><h3>Speaks Plus</h3><p className="plan-price">Pricing to be set <small>one-time or subscription</small></p><ul><li>Unlimited local practice clips</li><li>Expanded gloss catalog</li><li>Future library updates when licensed</li></ul><div className="checkout-actions"><button className="secondary-button" disabled={!offerings.stripeReady || !offerings.oneTimeReady} type="button" onClick={() => void beginCheckout('one_time')}>One-time · {offerings.stripeReady && offerings.oneTimeReady ? `${offerings.mode} checkout` : 'setup needed'}</button><button className="primary-action compact-action" disabled={!offerings.stripeReady || !offerings.subscriptionReady} type="button" onClick={() => void beginCheckout('subscription')}>Subscription · {offerings.stripeReady && offerings.subscriptionReady ? `${offerings.mode} checkout` : 'setup needed'}</button></div></article>
                </div>
                {billingMessage && <p className="inline-status" role="status">{billingMessage}</p>}
                <div className="transcript-panel purchase-panel"><div className="panel-heading"><div><span className="eyebrow">YOUR PURCHASES</span><h3>Purchase history</h3></div><button className="text-button" type="button" onClick={() => void loadPurchases()}>Refresh</button></div>{purchases.length === 0 ? <div className="empty-state"><p>No completed purchases are linked to this browser yet.</p></div> : <div className="purchase-list">{purchases.map((purchase) => <div className="purchase-row" key={purchase.id}><div><strong>{purchase.plan === 'one_time' ? 'Speaks Plus · one-time' : 'Speaks Plus · subscription'}</strong><small>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(purchase.createdAt))}</small></div><span>{purchase.amount === null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: purchase.currency ?? 'USD' }).format(purchase.amount / 100)}</span><span className="status-tag">{purchase.status}</span></div>)}</div>}</div>
                <p className="privacy-note">Purchases are linked to this browser’s guest session. If you enter an email, it and billing identifiers, order status, and entitlement records are stored on the server to link access and purchase history. Account recovery, cross-device syncing, and a retention/deletion request policy are not included in this MVP; the owner must set that policy before public sales.</p>
              </>
            )}

            {view === 'help' && (
              <>
                <div className="mode-intro"><span className="mode-number">BEFORE YOU BEGIN</span><h2>Set up your space.</h2><p>Each browser asks separately for access. You can keep using the text catalog if a permission is unavailable or declined.</p></div>
                <div className="setup-list"><article><span className="setup-step">01</span><div><h3>Microphone · Call mode</h3><p>Put the call on speaker. Choose “Start listening,” then allow microphone access if your browser asks. Speech recognition may need an internet connection and may not be supported by every browser.</p></div></article><article><span className="setup-step">02</span><div><h3>Camera · Sign and Train</h3><p>Allow camera access to see a mirror preview or make a short local practice clip. This app does not analyze the camera for ASL recognition.</p></div></article><article><span className="setup-step">03</span><div><h3>Volume · Caller audio</h3><p>Keep the phone call audible at a comfortable level. Device text-to-speech may play locally; phone-call routing depends on the device, call app, and speaker setup.</p></div></article><article><span className="setup-step">04</span><div><h3>Your privacy</h3><p>Practice clips are stored in this browser on this device. Captions are shown in the current screen session and are not uploaded by this MVP.</p></div></article></div>
                <div className="notice notice-soft"><strong>Install the app</strong><span>On iPhone or iPad, open this page in Safari, tap Share, then “Add to Home Screen.” On other devices, use your browser’s Install or Add to Home Screen menu.</span></div>
                <div className="notice notice-amber"><strong>Communication access note</strong><span>This MVP is not a substitute for a qualified ASL interpreter. Captions, English glosses, grammar cues, and personal clips are not validated translations.</span></div>
              </>
            )}
          </section>
        </div>
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">{(['call', 'sign', 'train', 'library'] as const).map((item, index) => <button key={item} type="button" className={`nav-item ${view === item ? 'active' : ''}`} onClick={() => navigate(item)} aria-current={view === item ? 'page' : undefined}><span className="nav-index">0{index + 1}</span><span>{VIEW_LABELS[item]}</span></button>)}</nav>
      <footer className="site-footer"><span>Good Day To Be Alive LLC</span><span>Built with care · capability notes included</span><button type="button" className="footer-link" onClick={() => navigate('help')}>Permissions & privacy</button></footer>
      {toast && <div className="toast" role="status" onAnimationEnd={() => setToast('')}>{toast}<button type="button" aria-label="Dismiss message" onClick={() => setToast('')}>×</button></div>}
    </div>
  );
}

function CameraCard({ stream, videoRef, message, onToggle }: { stream: MediaStream | null; videoRef: { current: HTMLVideoElement | null }; message: string; onToggle: () => void }) {
  return (
    <div className="camera-card">
      {stream ? <video ref={videoRef} className="camera-preview" autoPlay muted playsInline aria-label="Camera preview" /> : <div className="camera-placeholder"><span className="camera-icon" aria-hidden="true">◉</span><span>Camera preview appears here</span></div>}
      <div className="camera-info"><p className="inline-status" role="status">{message}</p><button className="secondary-button" type="button" onClick={onToggle}>{stream ? 'Turn camera off' : 'Enable camera'}</button></div>
    </div>
  );
}
