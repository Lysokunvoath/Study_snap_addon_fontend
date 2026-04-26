import { meet } from '@googleworkspace/meet-addons/meet.addons';

const CLOUD_PROJECT_NUMBER: string = '980889141066';
const MAIN_STAGE_CHANNEL_NAME = 'study-snap-transcript';
const RECORDER_CONTROL_CHANNEL_NAME = 'study-snap-recorder-control';
const BACKEND_URL_STORAGE_KEY = 'studySnap.backendUrl';
const APP_USER_ID_STORAGE_KEY = 'studySnap.appUserId';
const DEFAULT_BACKEND_BASE_URL =
  'https://study-snap-addon-backend.railway.internal';

type MainStageEvent =
  | { type: 'status'; payload: { text: string } }
  | { type: 'partial'; payload: { text: string } }
  | { type: 'final'; payload: { text: string } }
  | { type: 'clear'; payload: Record<string, never> };

type RecorderControlEvent =
  | { type: 'start'; payload: Record<string, never> }
  | { type: 'stop'; payload: Record<string, never> }
  | { type: 'clear'; payload: Record<string, never> }
  | { type: 'syncBackendUrl'; payload: { baseUrl: string } };

type TranscriptMessage = {
  type?: string;
  payload?: {
    text?: string;
    message?: string;
    code?: string;
  };
};

type TranscriptImportResponse = {
  importedLineCount: number;
  lines: string[];
  meetingId?: string | null;
  title?: string;
};

type OAuthStartResponse = {
  authUrl: string;
};

type OAuthStatusResponse = {
  connected: boolean;
};

type WebsiteAuthUser = {
  id: string;
  email: string;
  username: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  createdAt: string;
  updatedAt: string;
};

type WebsiteAuthResponse = {
  user: WebsiteAuthUser;
  token: string;
  refreshToken: string;
};

type TranscriptSyncResponse = {
  documentId: string;
  documentTitle: string;
  modifiedTime: string | null;
  importedLineCount: number;
  lines: string[];
};

type BotStartResponse = {
  botId: string;
  status: string;
  meetingUrl: string;
};

type BotStopResponse = {
  stopped: boolean;
  botId: string;
};

type BotStatusResponse = {
  botId: string;
  status: string;
  lineCount: number;
};

type BotTranscriptLine = {
  seq: number;
  text: string;
  speaker: string | null;
  timestamp: string;
};

type BotTranscriptResponse = {
  botId: string;
  status: string;
  latestSeq: number;
  lines: BotTranscriptLine[];
};

type StudyGenerateResponse = {
  title: string;
  summary: {
    tldr: string[];
    keyPoints: string[];
    actionItems: string[];
  };
  notes: Array<{
    heading: string;
    bullets: string[];
  }>;
  flashcards: Array<{
    question: string;
    answer: string;
    difficulty: 'easy' | 'medium' | 'hard';
    tags: string[];
  }>;
};

type LiveSyncState = {
  timerId: number | null;
  meetingCode: string | null;
  activeDocumentId: string | null;
  seenLines: Set<string>;
};

type BotLiveState = {
  botId: string | null;
  meetingUrl: string | null;
  timerId: number | null;
  latestSeq: number;
};

type TranscriptionState = {
  ws: WebSocket | null;
  sessionStarted: boolean;
  stream: MediaStream | null;
  audioContext: AudioContext | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  workletNode: AudioWorkletNode | null;
  processorNode: ScriptProcessorNode | null;
  pendingSamples: number[];
  seq: number;
  partialLine: HTMLDivElement | null;
};

const transcriptionState: TranscriptionState = {
  ws: null,
  sessionStarted: false,
  stream: null,
  audioContext: null,
  sourceNode: null,
  workletNode: null,
  processorNode: null,
  pendingSamples: [],
  seq: 0,
  partialLine: null,
};

const liveSyncState: LiveSyncState = {
  timerId: null,
  meetingCode: null,
  activeDocumentId: null,
  seenLines: new Set<string>(),
};

const botLiveState: BotLiveState = {
  botId: null,
  meetingUrl: null,
  timerId: null,
  latestSeq: 0,
};

let mainStageChannel: BroadcastChannel | null = null;
let recorderControlChannel: BroadcastChannel | null = null;
let captureWorkletModuleUrl: string | null = null;
const USER_KEY_STORAGE_KEY = 'studySnap.userKey';
const WEBSITE_AUTH_TOKEN_STORAGE_KEY = 'studySnap.websiteAuthToken';
const WEBSITE_AUTH_USER_STORAGE_KEY = 'studySnap.websiteAuthUser';
const WEBSITE_AUTH_BASE_URL_STORAGE_KEY = 'studySnap.websiteAuthBaseUrl';

declare global {
  interface Window {
    studySnapAddon: {
      setUpSidePanel: () => Promise<void>;
      initializeMainStage: () => Promise<void>;
      initializeRecorderPage: () => Promise<void>;
    };
  }
}

function getCloudProjectNumber(): string {
  if (CLOUD_PROJECT_NUMBER === 'REPLACE_WITH_YOUR_CLOUD_PROJECT_NUMBER') {
    throw new Error(
      'Set CLOUD_PROJECT_NUMBER in side_panel.ts before running inside Meet.'
    );
  }

  return CLOUD_PROJECT_NUMBER;
}

function getDefaultMainStageUrl(): string {
  return new URL('./MainStage.html', window.location.href).toString();
}

function getDefaultRecorderUrl(): string {
  return new URL('./Recorder.html', window.location.href).toString();
}

function isRecorderPage(): boolean {
  const path = window.location.pathname.toLowerCase();
  return path.endsWith('/recorder') || path.endsWith('/recorder.html');
}

function normalizeBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');

  return withoutTrailingSlash;
}

function getStoredBackendBaseUrl(): string | null {
  try {
    const value = window.localStorage.getItem(BACKEND_URL_STORAGE_KEY);
    if (!value) {
      return null;
    }

    const normalized = normalizeBaseUrl(value);
    return normalized || null;
  } catch {
    return null;
  }
}

function getStoredWebsiteAuthBaseUrl(): string | null {
  try {
    const value = window.localStorage.getItem(WEBSITE_AUTH_BASE_URL_STORAGE_KEY);
    if (!value) {
      return null;
    }

    const normalized = normalizeBaseUrl(value);
    return normalized || null;
  } catch {
    return null;
  }
}

function setStoredBackendBaseUrl(baseUrl: string): void {
  try {
    window.localStorage.setItem(BACKEND_URL_STORAGE_KEY, baseUrl);
  } catch {
    // Ignore storage errors (private mode, blocked storage, etc.).
  }
}

function setStoredWebsiteAuthBaseUrl(baseUrl: string): void {
  try {
    window.localStorage.setItem(WEBSITE_AUTH_BASE_URL_STORAGE_KEY, baseUrl);
  } catch {
    // Ignore storage errors (private mode, blocked storage, etc.).
  }
}

function initializeBackendUrlInput(): void {
  const input = document.getElementById('backend-url') as HTMLInputElement | null;
  if (!input) {
    return;
  }

  const stored = getStoredBackendBaseUrl();
  const defaultValue = stored ?? DEFAULT_BACKEND_BASE_URL;
  input.value = defaultValue;

  input.addEventListener('change', () => {
    const normalized = normalizeBaseUrl(input.value) || DEFAULT_BACKEND_BASE_URL;
    input.value = normalized;
    setStoredBackendBaseUrl(normalized);
  });
}

function initializeWebsiteAuthUrlInput(): void {
  const input = document.getElementById('website-auth-url') as HTMLInputElement | null;
  if (!input) {
    return;
  }

  const stored = getStoredWebsiteAuthBaseUrl();
  const defaultValue = stored ?? 'http://localhost:3000';
  input.value = defaultValue;

  input.addEventListener('change', () => {
    const normalized = normalizeBaseUrl(input.value) || 'http://localhost:3000';
    input.value = normalized;
    setStoredWebsiteAuthBaseUrl(normalized);
  });
}

function getBackendBaseUrl(): string {
  const input = document.getElementById('backend-url') as HTMLInputElement | null;
  const fallback = getStoredBackendBaseUrl() ?? DEFAULT_BACKEND_BASE_URL;

  if (!input) {
    return fallback;
  }

  const value = normalizeBaseUrl(input.value);
  const resolved = value || fallback;

  setStoredBackendBaseUrl(resolved);
  return resolved;
}

function getWebsiteAuthBaseUrl(): string {
  const input = document.getElementById('website-auth-url') as HTMLInputElement | null;
  const fallback = getStoredWebsiteAuthBaseUrl() ?? 'http://localhost:3000';

  if (!input) {
    return fallback;
  }

  const value = normalizeBaseUrl(input.value);
  const resolved = value || fallback;

  setStoredWebsiteAuthBaseUrl(resolved);
  return resolved;
}

function initializeAppUserIdInput(): void {
  const input = document.getElementById('app-user-id') as HTMLInputElement | null;
  if (!input) {
    return;
  }

  try {
    const stored = window.localStorage.getItem(APP_USER_ID_STORAGE_KEY)?.trim() ?? '';
    input.value = stored;
  } catch {
    // Ignore storage read errors.
  }

  input.addEventListener('change', () => {
    const userId = input.value.trim();

    try {
      if (userId) {
        window.localStorage.setItem(APP_USER_ID_STORAGE_KEY, userId);
      } else {
        window.localStorage.removeItem(APP_USER_ID_STORAGE_KEY);
      }
    } catch {
      // Ignore storage write errors.
    }
  });
}

function getAppUserId(): string | undefined {
  try {
    const input = document.getElementById('app-user-id') as HTMLInputElement | null;
    const inputUserId = input?.value.trim() ?? '';
    if (inputUserId) {
      window.localStorage.setItem(APP_USER_ID_STORAGE_KEY, inputUserId);
      return inputUserId;
    }

    const storedUserId = window.localStorage.getItem(APP_USER_ID_STORAGE_KEY)?.trim() ?? '';
    if (storedUserId) {
      return storedUserId;
    }
  } catch {
    // Ignore storage access errors.
  }

  return undefined;
}

function getStoredWebsiteAuthToken(): string | null {
  try {
    const token = window.localStorage.getItem(WEBSITE_AUTH_TOKEN_STORAGE_KEY)?.trim();
    return token || null;
  } catch {
    return null;
  }
}

function getStoredWebsiteAuthUser(): WebsiteAuthUser | null {
  try {
    const raw = window.localStorage.getItem(WEBSITE_AUTH_USER_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as WebsiteAuthUser;
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

function setStoredWebsiteAuth(auth: WebsiteAuthResponse): void {
  try {
    window.localStorage.setItem(WEBSITE_AUTH_TOKEN_STORAGE_KEY, auth.token);
    window.localStorage.setItem(WEBSITE_AUTH_USER_STORAGE_KEY, JSON.stringify(auth.user));
  } catch {
    // Ignore storage errors.
  }
}

function clearStoredWebsiteAuth(): void {
  try {
    window.localStorage.removeItem(WEBSITE_AUTH_TOKEN_STORAGE_KEY);
    window.localStorage.removeItem(WEBSITE_AUTH_USER_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

function formatWebsiteUser(user: WebsiteAuthUser | null): string {
  if (!user) {
    return 'Not signed in to website account.';
  }

  const displayName = user.username || user.email || user.id;
  return `Signed in as ${displayName}`;
}

function setAuthStatus(text: string): void {
  const status = document.getElementById('auth-status');
  if (status) {
    status.textContent = text;
  }
}

function setAuthUserDisplay(user: WebsiteAuthUser | null): void {
  const display = document.getElementById('auth-user-display');
  if (display) {
    display.textContent = formatWebsiteUser(user);
  }
}

function setAuthFormEnabled(enabled: boolean): void {
  const emailInput = document.getElementById('auth-email') as HTMLInputElement | null;
  const passwordInput = document.getElementById('auth-password') as HTMLInputElement | null;
  const loginButton = document.getElementById('auth-login') as HTMLButtonElement | null;
  const logoutButton = document.getElementById('auth-logout') as HTMLButtonElement | null;

  if (emailInput) {
    emailInput.disabled = !enabled;
  }

  if (passwordInput) {
    passwordInput.disabled = !enabled;
  }

  if (loginButton) {
    loginButton.disabled = !enabled;
  }

  if (logoutButton) {
    logoutButton.disabled = enabled;
  }
}

function updateAuthUi(user: WebsiteAuthUser | null): void {
  setAuthUserDisplay(user);
  setAuthStatus(user ? `Website account linked: ${user.email}` : 'Sign in with your website account.');
  setAuthFormEnabled(!user);
}

async function fetchWebsiteAuthUser(baseUrl: string, token: string): Promise<WebsiteAuthUser> {
  const response = await fetch(`${baseUrl}/api/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Auth session lookup failed (${response.status}): ${message}`);
  }

  return (await response.json()) as WebsiteAuthUser;
}

async function loginWebsiteAuth(baseUrl: string, email: string, password: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Website login failed (${response.status}): ${message}`);
  }

  const auth = (await response.json()) as WebsiteAuthResponse;
  setStoredWebsiteAuth(auth);
  updateAuthUi(auth.user);
}

async function initializeWebsiteAuth(baseUrl: string): Promise<void> {
  const loginButton = document.getElementById('auth-login') as HTMLButtonElement | null;
  const logoutButton = document.getElementById('auth-logout') as HTMLButtonElement | null;

  const token = getStoredWebsiteAuthToken();
  if (token) {
    try {
      const user = await fetchWebsiteAuthUser(baseUrl, token);
      setStoredWebsiteAuth({ token, refreshToken: token, user });
      updateAuthUi(user);
    } catch {
      clearStoredWebsiteAuth();
      updateAuthUi(null);
    }
  } else {
    updateAuthUi(getStoredWebsiteAuthUser());
  }

  if (loginButton) {
    loginButton.addEventListener('click', async () => {
      const emailInput = document.getElementById('auth-email') as HTMLInputElement | null;
      const passwordInput = document.getElementById('auth-password') as HTMLInputElement | null;
      const email = emailInput?.value.trim() ?? '';
      const password = passwordInput?.value ?? '';

      if (!email || !password) {
        setAuthStatus('Enter your website email and password first.');
        return;
      }

      try {
        loginButton.disabled = true;
        setAuthStatus('Signing in to website account...');
        await loginWebsiteAuth(baseUrl, email, password);
        if (passwordInput) {
          passwordInput.value = '';
        }
      } catch (error) {
        clearStoredWebsiteAuth();
        updateAuthUi(null);
        setAuthStatus(`Website login failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        loginButton.disabled = false;
      }
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', () => {
      clearStoredWebsiteAuth();
      updateAuthUi(null);
      setAuthStatus('Signed out of website account.');
    });
  }
}

function normalizeMeetingUrl(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return '';
  }

  if (/^https:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Allow entering just the meet code, e.g. abc-defg-hij.
  if (/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(trimmed)) {
    return `https://meet.google.com/${trimmed.toLowerCase()}`;
  }

  return trimmed;
}

function getMeetingUrlInputValue(): string {
  const input = document.getElementById('meeting-url') as HTMLInputElement | null;
  if (!input) {
    return '';
  }

  const normalized = normalizeMeetingUrl(input.value);
  if (normalized) {
    input.value = normalized;
  }

  return normalized;
}

function getOrCreateUserKey(): string {
  try {
    const existing = window.localStorage.getItem(USER_KEY_STORAGE_KEY);
    if (existing) {
      return existing;
    }

    const created = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    window.localStorage.setItem(USER_KEY_STORAGE_KEY, created);
    return created;
  } catch {
    return `volatile-${Date.now().toString(36)}`;
  }
}

function toWsUrl(baseUrl: string): string {
  if (baseUrl.startsWith('https://')) {
    return `wss://${baseUrl.slice('https://'.length)}`;
  }

  if (baseUrl.startsWith('http://')) {
    return `ws://${baseUrl.slice('http://'.length)}`;
  }

  throw new Error('Backend URL must start with http:// or https://');
}

function setStatus(text: string, shouldBroadcast = true): void {
  const status = document.getElementById('transcription-status');
  if (status) {
    status.textContent = text;
  }

  if (shouldBroadcast) {
    emitMainStageEvent({
      type: 'status',
      payload: { text },
    });
  }
}

function getMainStageChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') {
    return null;
  }

  if (!mainStageChannel) {
    mainStageChannel = new BroadcastChannel(MAIN_STAGE_CHANNEL_NAME);
  }

  return mainStageChannel;
}

function emitMainStageEvent(event: MainStageEvent): void {
  const channel = getMainStageChannel();
  if (!channel) {
    return;
  }

  channel.postMessage(event);
}

function getRecorderControlChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') {
    return null;
  }

  if (!recorderControlChannel) {
    recorderControlChannel = new BroadcastChannel(RECORDER_CONTROL_CHANNEL_NAME);
  }

  return recorderControlChannel;
}

function emitRecorderControlEvent(event: RecorderControlEvent): void {
  const channel = getRecorderControlChannel();
  if (!channel) {
    return;
  }

  channel.postMessage(event);
}

function setControlState(isRunning: boolean): void {
  const startButton =
    (document.getElementById('start-transcript') as HTMLButtonElement | null) ??
    (document.getElementById('start-transcription') as HTMLButtonElement | null);
  const stopButton = document.getElementById('stop-transcription') as HTMLButtonElement | null;
  const backendInput = document.getElementById('backend-url') as HTMLInputElement | null;

  if (startButton) {
    startButton.disabled = isRunning;
  }

  if (stopButton) {
    stopButton.disabled = !isRunning;
  }

  if (backendInput) {
    backendInput.disabled = isRunning;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function floatToPcm16(float32Samples: Float32Array): Uint8Array {
  const result = new ArrayBuffer(float32Samples.length * 2);
  const view = new DataView(result);

  for (let i = 0; i < float32Samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, float32Samples[i]));
    const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(i * 2, int16, true);
  }

  return new Uint8Array(result);
}

function sendAudioChunk(float32Samples: Float32Array): void {
  const socket = transcriptionState.ws;
  if (!socket || socket.readyState !== WebSocket.OPEN || !transcriptionState.sessionStarted) {
    return;
  }

  const pcmBytes = floatToPcm16(float32Samples);
  const audioBase64 = toBase64(pcmBytes);

  transcriptionState.seq += 1;
  socket.send(
    JSON.stringify({
      type: 'audio.chunk',
      payload: {
        seq: transcriptionState.seq,
        audioBase64,
      },
    })
  );
}

function queueAudioSamples(float32Samples: Float32Array): void {
  for (let i = 0; i < float32Samples.length; i += 1) {
    transcriptionState.pendingSamples.push(float32Samples[i]);
  }

  const chunkSize = 4096;
  while (transcriptionState.pendingSamples.length >= chunkSize) {
    const chunk = transcriptionState.pendingSamples.splice(0, chunkSize);
    sendAudioChunk(Float32Array.from(chunk));
  }
}

async function ensureCaptureWorklet(audioContext: AudioContext): Promise<void> {
  if (!captureWorkletModuleUrl) {
    const workletSource = `
class StudySnapCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) {
      this.port.postMessage(channel.slice());
    }
    return true;
  }
}

registerProcessor('study-snap-capture-processor', StudySnapCaptureProcessor);
`;

    const blob = new Blob([workletSource], { type: 'application/javascript' });
    captureWorkletModuleUrl = URL.createObjectURL(blob);
  }

  await audioContext.audioWorklet.addModule(captureWorkletModuleUrl);
}

async function createSessionToken(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Session request failed (${response.status}): ${message}`);
  }

  const body = (await response.json()) as { token?: string };
  if (!body.token) {
    throw new Error('Session response did not include token');
  }

  return body.token;
}

async function importMeetTranscriptText(input: {
  baseUrl: string;
  transcriptText: string;
  title?: string;
  botId?: string;
  userId?: string;
  meetingUrl?: string;
}): Promise<TranscriptImportResponse> {
  const response = await fetch(`${input.baseUrl}/api/transcript/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transcriptText: input.transcriptText,
      ...(input.title ? { title: input.title } : {}),
      ...(input.botId ? { botId: input.botId } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.meetingUrl ? { meetingUrl: input.meetingUrl } : {}),
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Transcript import failed (${response.status}): ${message}`);
  }

  return (await response.json()) as TranscriptImportResponse;
}

async function startGoogleOAuth(baseUrl: string, userKey: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/google/oauth/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userKey }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OAuth start failed (${response.status}): ${message}`);
  }

  const body = (await response.json()) as OAuthStartResponse;
  if (!body.authUrl) {
    throw new Error('OAuth start response did not include authUrl');
  }

  return body.authUrl;
}

async function getGoogleOAuthStatus(baseUrl: string, userKey: string): Promise<boolean> {
  const response = await fetch(
    `${baseUrl}/api/google/oauth/status?userKey=${encodeURIComponent(userKey)}`
  );

  if (!response.ok) {
    return false;
  }

  const body = (await response.json()) as OAuthStatusResponse;
  return !!body.connected;
}

async function syncMeetTranscriptFromGoogle(
  baseUrl: string,
  userKey: string,
  meetingCode: string
): Promise<TranscriptSyncResponse> {
  const response = await fetch(`${baseUrl}/api/google/transcript/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userKey, meetingCode }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Auto-sync failed (${response.status}): ${message}`);
  }

  return (await response.json()) as TranscriptSyncResponse;
}

async function startMeetingBot(
  baseUrl: string,
  meetingUrl: string,
  userId?: string
): Promise<BotStartResponse> {
  const response = await fetch(`${baseUrl}/api/bot/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      meetingUrl,
      ...(userId ? { userId } : {}),
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Start bot failed (${response.status}): ${message}`);
  }

  return (await response.json()) as BotStartResponse;
}

async function stopMeetingBot(baseUrl: string, botId: string): Promise<BotStopResponse> {
  const response = await fetch(`${baseUrl}/api/bot/stop`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ botId }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Stop bot failed (${response.status}): ${message}`);
  }

  return (await response.json()) as BotStopResponse;
}

async function getMeetingBotStatus(baseUrl: string, botId: string): Promise<BotStatusResponse> {
  const response = await fetch(`${baseUrl}/api/bot/status?botId=${encodeURIComponent(botId)}`);

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Bot status failed (${response.status}): ${message}`);
  }

  return (await response.json()) as BotStatusResponse;
}

async function pollMeetingBotTranscript(
  baseUrl: string,
  botId: string,
  sinceSeq: number
): Promise<BotTranscriptResponse> {
  const response = await fetch(
    `${baseUrl}/api/bot/transcript?botId=${encodeURIComponent(botId)}&sinceSeq=${encodeURIComponent(
      String(sinceSeq)
    )}`
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Bot transcript failed (${response.status}): ${message}`);
  }

  return (await response.json()) as BotTranscriptResponse;
}

async function generateStudyPack(input: {
  baseUrl: string;
  transcriptText: string;
  title: string;
  botId?: string;
  userId?: string;
}): Promise<StudyGenerateResponse> {
  const response = await fetch(`${input.baseUrl}/api/study/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transcriptText: input.transcriptText,
      title: input.title,
      ...(input.botId ? { botId: input.botId } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Study generation failed (${response.status}): ${message}`);
  }

  return (await response.json()) as StudyGenerateResponse;
}

function signatureForLine(text: string): string {
  return text.trim().toLowerCase();
}

function resetLiveSyncBuffer(): void {
  liveSyncState.activeDocumentId = null;
  liveSyncState.seenLines.clear();
}

function applySyncedTranscriptLines(synced: TranscriptSyncResponse): number {
  if (liveSyncState.activeDocumentId !== synced.documentId) {
    liveSyncState.activeDocumentId = synced.documentId;
    liveSyncState.seenLines.clear();
    clearTranscript();
  }

  let appended = 0;
  for (const line of synced.lines) {
    const signature = signatureForLine(line);
    if (!signature || liveSyncState.seenLines.has(signature)) {
      continue;
    }

    liveSyncState.seenLines.add(signature);
    appendFinalLine(line);
    appended += 1;
  }

  return appended;
}

function setLiveSyncButtons(isRunning: boolean): void {
  const startLiveSyncButton = document.getElementById('start-live-sync') as HTMLButtonElement | null;
  const stopLiveSyncButton = document.getElementById('stop-live-sync') as HTMLButtonElement | null;

  if (startLiveSyncButton) {
    startLiveSyncButton.disabled = isRunning;
  }

  if (stopLiveSyncButton) {
    stopLiveSyncButton.disabled = !isRunning;
  }
}

function setMeetingBotButtons(isRunning: boolean): void {
  const startBotButton = document.getElementById('start-meeting-bot') as HTMLButtonElement | null;
  const stopBotButton = document.getElementById('stop-meeting-bot') as HTMLButtonElement | null;

  if (startBotButton) {
    startBotButton.disabled = isRunning;
  }

  if (stopBotButton) {
    stopBotButton.disabled = !isRunning;
  }
}

function stopMeetingBotPolling(statusMessage?: string): void {
  if (botLiveState.timerId) {
    window.clearInterval(botLiveState.timerId);
    botLiveState.timerId = null;
  }

  botLiveState.botId = null;
  botLiveState.meetingUrl = null;
  botLiveState.latestSeq = 0;
  setMeetingBotButtons(false);

  if (statusMessage) {
    setStatus(statusMessage);
  }
}

async function runMeetingBotPollTick(baseUrl: string, botId: string): Promise<void> {
  const transcript = await pollMeetingBotTranscript(baseUrl, botId, botLiveState.latestSeq);

  for (const line of transcript.lines) {
    const speakerPrefix = line.speaker ? `${line.speaker}: ` : '';
    appendFinalLine(`${speakerPrefix}${line.text}`);
  }

  const transcriptText = getTranscriptTextForStudy();
  if (transcriptText.trim()) {
    await importMeetTranscriptText({
      baseUrl,
      transcriptText,
      title: getMeetingTitleForStudy(),
      botId,
      userId: getAppUserId(),
      meetingUrl: botLiveState.meetingUrl ?? undefined,
    });
  }

  botLiveState.latestSeq = transcript.latestSeq;
  const status = await getMeetingBotStatus(baseUrl, botId);
  setStatus(`Meeting bot ${status.status}. ${status.lineCount} line(s) captured.`);
}

async function beginMeetingBotPolling(baseUrl: string, botId: string): Promise<void> {
  if (botLiveState.timerId) {
    window.clearInterval(botLiveState.timerId);
  }

  await runMeetingBotPollTick(baseUrl, botId);

  botLiveState.timerId = window.setInterval(() => {
    runMeetingBotPollTick(baseUrl, botId).catch((error) => {
      stopMeetingBotPolling(
        `Meeting bot polling stopped: ${error instanceof Error ? error.message : String(error)}`
      );
    });
  }, 3000);
}

function stopLiveSyncLoop(statusMessage = 'Live sync stopped.'): void {
  if (liveSyncState.timerId) {
    window.clearInterval(liveSyncState.timerId);
    liveSyncState.timerId = null;
  }

  liveSyncState.meetingCode = null;
  setLiveSyncButtons(false);
  setStatus(statusMessage);
}

async function runLiveSyncTick(baseUrl: string, userKey: string, meetingCode: string): Promise<void> {
  const synced = await syncMeetTranscriptFromGoogle(baseUrl, userKey, meetingCode);
  const appended = applySyncedTranscriptLines(synced);

  setStatus(
    `Live sync: +${appended} new line(s), ${synced.importedLineCount} total from ${synced.documentTitle}.`
  );
}

async function startLiveSyncLoop(baseUrl: string, userKey: string, meetingCode: string): Promise<void> {
  if (liveSyncState.timerId) {
    return;
  }

  liveSyncState.meetingCode = meetingCode;
  resetLiveSyncBuffer();
  setLiveSyncButtons(true);
  setStatus('Starting live transcript sync...');

  await runLiveSyncTick(baseUrl, userKey, meetingCode);

  liveSyncState.timerId = window.setInterval(() => {
    runLiveSyncTick(baseUrl, userKey, meetingCode).catch((error) => {
      stopLiveSyncLoop(
        `Live sync stopped: ${error instanceof Error ? error.message : String(error)}`
      );
    });
  }, 5000);
}

async function connectGoogleAccount(baseUrl: string, userKey: string): Promise<void> {
  const authUrl = await startGoogleOAuth(baseUrl, userKey);
  const popup = window.open(authUrl, '_blank', 'popup,width=560,height=720');

  if (!popup) {
    throw new Error('Popup blocked. Allow popups and try again.');
  }

  const timeoutAt = Date.now() + 120_000;
  while (Date.now() < timeoutAt) {
    const connected = await getGoogleOAuthStatus(baseUrl, userKey);
    if (connected) {
      return;
    }

    if (popup.closed) {
      break;
    }

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 1500);
    });
  }

  throw new Error('Google account connect timed out or was cancelled.');
}

function appendFinalLine(text: string, shouldBroadcast = true): void {
  const transcript = document.getElementById('transcript');
  if (!transcript) {
    return;
  }

  const empty = transcript.querySelector('.empty');
  if (empty) {
    empty.remove();
  }

  if (transcriptionState.partialLine) {
    transcriptionState.partialLine.remove();
    transcriptionState.partialLine = null;
  }

  const line = document.createElement('div');
  line.className = 'line final';
  line.textContent = text;
  transcript.appendChild(line);
  transcript.scrollTop = transcript.scrollHeight;

  if (shouldBroadcast) {
    emitMainStageEvent({
      type: 'final',
      payload: { text },
    });
  }
}

function upsertPartialLine(text: string, shouldBroadcast = true): void {
  const transcript = document.getElementById('transcript');
  if (!transcript) {
    return;
  }

  const empty = transcript.querySelector('.empty');
  if (empty) {
    empty.remove();
  }

  if (!transcriptionState.partialLine) {
    const partial = document.createElement('div');
    partial.className = 'line partial';
    transcript.appendChild(partial);
    transcriptionState.partialLine = partial;
  }

  transcriptionState.partialLine.textContent = text;
  transcript.scrollTop = transcript.scrollHeight;

  if (shouldBroadcast) {
    emitMainStageEvent({
      type: 'partial',
      payload: { text },
    });
  }
}

function clearTranscript(shouldBroadcast = true): void {
  const transcript = document.getElementById('transcript');
  if (!transcript) {
    return;
  }

  transcript.innerHTML = '<div class="empty">Transcript will appear here.</div>';
  transcriptionState.partialLine = null;

  if (shouldBroadcast) {
    emitMainStageEvent({
      type: 'clear',
      payload: {},
    });
  }
}

function getTranscriptTextForStudy(): string {
  const transcript = document.getElementById('transcript');
  if (!transcript) {
    return '';
  }

  const lines = Array.from(transcript.querySelectorAll('.line.final'))
    .map((node) => (node.textContent ?? '').trim())
    .filter(Boolean);

  return lines.join('\n');
}

function clearStudyResult(): void {
  const container = document.getElementById('study-result');
  if (!container) {
    return;
  }

  container.innerHTML = '<div class="empty">Study summary and flashcard status will appear here.</div>';
}

function renderStudyResult(result: StudyGenerateResponse): void {
  const container = document.getElementById('study-result');
  if (!container) {
    return;
  }

  const tldr = result.summary.tldr.slice(0, 3);
  const keyPoints = result.summary.keyPoints.slice(0, 5);

  const tldrHtml = tldr.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const keyPointsHtml = keyPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join('');

  container.innerHTML = [
    `<div class="line final"><strong>${escapeHtml(result.title || 'Study Pack')}</strong></div>`,
    `<div class="line final"><strong>Flashcards:</strong> ${result.flashcards.length}</div>`,
    '<div class="line final"><strong>TL;DR</strong><ul>' + (tldrHtml || '<li>No summary generated.</li>') + '</ul></div>',
    '<div class="line final"><strong>Key Points</strong><ul>' + (keyPointsHtml || '<li>No key points generated.</li>') + '</ul></div>',
  ].join('');

  container.scrollTop = 0;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getMeetingTitleForStudy(): string {
  const url = botLiveState.meetingUrl ?? getMeetingUrlInputValue();
  if (!url) {
    return 'Meeting Transcript';
  }

  try {
    const parsed = new URL(url);
    const code = parsed.pathname.split('/').filter(Boolean).pop();
    return code ? `Meeting ${code}` : 'Meeting Transcript';
  } catch {
    return 'Meeting Transcript';
  }
}

function clearMainStageTranscript(): void {
  const transcript = document.getElementById('mainstage-transcript');
  if (!transcript) {
    return;
  }

  transcript.innerHTML =
    '<div class="empty">Transcript will appear here when the host starts transcription.</div>';
}

function setMainStageStatus(text: string): void {
  const status = document.getElementById('mainstage-status');
  if (status) {
    status.textContent = text;
  }
}

function upsertMainStagePartial(text: string): void {
  const transcript = document.getElementById('mainstage-transcript');
  if (!transcript) {
    return;
  }

  const empty = transcript.querySelector('.empty');
  if (empty) {
    empty.remove();
  }

  let partial = transcript.querySelector('.line.partial') as HTMLDivElement | null;
  if (!partial) {
    partial = document.createElement('div');
    partial.className = 'line partial';
    transcript.appendChild(partial);
  }

  partial.textContent = text;
  transcript.scrollTop = transcript.scrollHeight;
}

function appendMainStageFinal(text: string): void {
  const transcript = document.getElementById('mainstage-transcript');
  if (!transcript) {
    return;
  }

  const empty = transcript.querySelector('.empty');
  if (empty) {
    empty.remove();
  }

  const partial = transcript.querySelector('.line.partial');
  if (partial) {
    partial.remove();
  }

  const finalLine = document.createElement('div');
  finalLine.className = 'line final';
  finalLine.textContent = text;
  transcript.appendChild(finalLine);
  transcript.scrollTop = transcript.scrollHeight;
}

function setupMainStageTranscriptBridge(): void {
  const channel = getMainStageChannel();
  if (!channel) {
    setMainStageStatus('BroadcastChannel not supported in this browser');
    return;
  }

  channel.addEventListener('message', (event: MessageEvent<MainStageEvent>) => {
    const message = event.data;

    if (message.type === 'status') {
      setMainStageStatus(message.payload.text);
      return;
    }

    if (message.type === 'partial') {
      upsertMainStagePartial(message.payload.text);
      return;
    }

    if (message.type === 'final') {
      appendMainStageFinal(message.payload.text);
      return;
    }

    if (message.type === 'clear') {
      clearMainStageTranscript();
      setMainStageStatus('Waiting for transcription...');
    }
  });

  clearMainStageTranscript();
  setMainStageStatus('Waiting for transcription...');
}

function setupSidePanelTranscriptBridge(): void {
  const channel = getMainStageChannel();
  if (!channel) {
    return;
  }

  channel.addEventListener('message', (event: MessageEvent<MainStageEvent>) => {
    const message = event.data;

    if (message.type === 'status') {
      setStatus(message.payload.text, false);
      return;
    }

    if (message.type === 'partial') {
      upsertPartialLine(message.payload.text, false);
      return;
    }

    if (message.type === 'final') {
      appendFinalLine(message.payload.text, false);
      return;
    }

    if (message.type === 'clear') {
      clearTranscript(false);
      setStatus('Idle', false);
    }
  });
}

function setupRecorderControlBridge(): void {
  const channel = getRecorderControlChannel();
  if (!channel) {
    return;
  }

  channel.onmessage = (event: MessageEvent<RecorderControlEvent>) => {
    const message = event.data;

    if (message.type === 'start') {
      startTranscription().catch((error) => {
        setStatus(`Start failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      return;
    }

    if (message.type === 'stop') {
      stopTranscription().catch((error) => {
        setStatus(`Stop failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      return;
    }

    if (message.type === 'clear') {
      clearTranscript();
      return;
    }

    if (message.type === 'syncBackendUrl') {
      setStoredBackendBaseUrl(message.payload.baseUrl);
      initializeBackendUrlInput();
    }
  };
}

function openRecorderWindow(autoStart = false): void {
  const recorderUrl = new URL(getDefaultRecorderUrl());
  if (autoStart) {
    recorderUrl.searchParams.set('autostart', '1');
  }

  window.open(recorderUrl.toString(), '_blank', 'noopener,noreferrer');
}

function handleServerMessage(event: MessageEvent): void {
  try {
    const message = JSON.parse(String(event.data)) as TranscriptMessage;

    if (message.type === 'session.started') {
      transcriptionState.sessionStarted = true;
      setStatus('Connected. Streaming audio...');
      return;
    }

    if (message.type === 'transcript.partial' && message.payload?.text) {
      upsertPartialLine(message.payload.text);
      setStatus('Listening...');
      return;
    }

    if (message.type === 'transcript.final' && message.payload?.text) {
      appendFinalLine(message.payload.text);
      setStatus('Receiving final transcript');
      return;
    }

    if (message.type === 'error') {
      setStatus(`Error: ${message.payload?.message ?? message.payload?.code ?? 'Unknown error'}`);
      return;
    }

    if (message.type === 'session.ended') {
      setStatus('Stopped');
    }
  } catch {
    setStatus('Received non-JSON server message');
  }
}

async function stopTranscription(): Promise<void> {
  const { ws, workletNode, processorNode, sourceNode, audioContext, stream } = transcriptionState;

  if (workletNode) {
    workletNode.disconnect();
    workletNode.port.onmessage = null;
    transcriptionState.workletNode = null;
  }

  if (processorNode) {
    processorNode.onaudioprocess = null;
    processorNode.disconnect();
    transcriptionState.processorNode = null;
  }

  if (sourceNode) {
    sourceNode.disconnect();
    transcriptionState.sourceNode = null;
  }

  if (audioContext) {
    await audioContext.close().catch(() => {
      // Ignore close errors in shutdown flow.
    });
    transcriptionState.audioContext = null;
  }

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    transcriptionState.stream = null;
  }

  if (ws) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'session.stop', payload: {} }));
    }
    ws.close();
    transcriptionState.ws = null;
  }

  transcriptionState.seq = 0;
  transcriptionState.pendingSamples = [];
  transcriptionState.sessionStarted = false;
  setControlState(false);
  setStatus('Stopped');
}

async function startTranscription(): Promise<void> {
  if (!isRecorderPage() && window.top !== window.self) {
    throw new Error('Microphone is blocked in Meet iframe. Use Open Recorder Window.');
  }

  if (transcriptionState.ws) {
    return;
  }

  setControlState(true);
  setStatus('Requesting microphone...');

  try {
    const baseUrl = getBackendBaseUrl();
    const token = await createSessionToken(baseUrl);
    const wsUrl = `${toWsUrl(baseUrl)}/ws/transcribe?token=${encodeURIComponent(token)}`;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        noiseSuppression: true,
        echoCancellation: true,
      },
    });

    transcriptionState.stream = stream;
    const audioContext = new AudioContext({ sampleRate: 16000 });
    transcriptionState.audioContext = audioContext;

    const sourceNode = audioContext.createMediaStreamSource(stream);
    transcriptionState.sourceNode = sourceNode;

    const ws = new WebSocket(wsUrl);
    transcriptionState.ws = ws;
    transcriptionState.sessionStarted = false;

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          type: 'session.start',
          payload: {
            sampleRate: 16000,
            language: 'en-US',
          },
        })
      );
      setStatus('Connected. Waiting for session start...');
    });

    ws.addEventListener('message', handleServerMessage);

    ws.addEventListener('close', () => {
      stopTranscription().catch(() => {
        // Shutdown already in progress.
      });
    });

    ws.addEventListener('error', () => {
      setStatus('WebSocket connection error');
    });

    if (typeof AudioWorkletNode !== 'undefined' && !!audioContext.audioWorklet) {
      await ensureCaptureWorklet(audioContext);
      const workletNode = new AudioWorkletNode(
        audioContext,
        'study-snap-capture-processor'
      );
      transcriptionState.workletNode = workletNode;

      workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        queueAudioSamples(event.data);
      };

      sourceNode.connect(workletNode);
      workletNode.connect(audioContext.destination);
      return;
    }

    const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
    transcriptionState.processorNode = processorNode;

    processorNode.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      queueAudioSamples(input);
    };

    sourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination);
  } catch (error) {
    setStatus(`Start failed: ${error instanceof Error ? error.message : String(error)}`);
    await stopTranscription();
  }
}

export async function setUpSidePanel(): Promise<void> {
  const startMeetingBotButton = document.getElementById('start-meeting-bot') as HTMLButtonElement | null;
  const stopMeetingBotButton = document.getElementById('stop-meeting-bot') as HTMLButtonElement | null;

  if (
    !startMeetingBotButton ||
    !stopMeetingBotButton
  ) {
    throw new Error('Could not find meeting bot controls in SidePanel.html');
  }

  startMeetingBotButton.addEventListener('click', async () => {
    let meetingUrl = getMeetingUrlInputValue();

    if (!meetingUrl) {
      const meetingUrlInput = window.prompt(
        'Enter Google Meet URL or code (example: https://meet.google.com/abc-defg-hij or abc-defg-hij):',
        botLiveState.meetingUrl ?? ''
      );
      meetingUrl = normalizeMeetingUrl(meetingUrlInput ?? '');
    }

    if (!meetingUrl) {
      setStatus('Start bot cancelled: meeting URL is required.');
      return;
    }

    try {
      const baseUrl = getBackendBaseUrl();
      const userId = getAppUserId();
      if (!userId) {
        setStatus('Enter user_id before starting the bot.');
        return;
      }

      const started = await startMeetingBot(baseUrl, meetingUrl, userId);
      botLiveState.botId = started.botId;
      botLiveState.meetingUrl = meetingUrl;
      botLiveState.latestSeq = 0;
      clearTranscript();
      setMeetingBotButtons(true);
      setStatus(`Meeting bot started (ID: ${started.botId}). Admit it in Meet waiting room.`);
      await beginMeetingBotPolling(baseUrl, started.botId);
    } catch (error) {
      stopMeetingBotPolling();
      setStatus(`Start bot failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  stopMeetingBotButton.addEventListener('click', async () => {
    const botId = botLiveState.botId;
    if (!botId) {
      stopMeetingBotPolling('Meeting bot is not running.');
      return;
    }

    try {
      const baseUrl = getBackendBaseUrl();
      await stopMeetingBot(baseUrl, botId);
      stopMeetingBotPolling('Meeting bot stopped.');
    } catch (error) {
      setStatus(`Stop bot failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  window.addEventListener('beforeunload', () => {
    if (liveSyncState.timerId) {
      window.clearInterval(liveSyncState.timerId);
      liveSyncState.timerId = null;
    }

    if (botLiveState.timerId) {
      window.clearInterval(botLiveState.timerId);
      botLiveState.timerId = null;
    }
  });

  setupSidePanelTranscriptBridge();
  initializeBackendUrlInput();
  initializeAppUserIdInput();
  clearTranscript();
  setControlState(false);
  setMeetingBotButtons(false);
  setStatus('Ready. Start Meeting Bot and admit it in Meet.');
}

export async function initializeMainStage(): Promise<void> {
  const session = await meet.addon.createAddonSession({
    cloudProjectNumber: getCloudProjectNumber(),
  });

  await session.createMainStageClient();
  setupMainStageTranscriptBridge();
}

export async function initializeRecorderPage(): Promise<void> {
  initializeBackendUrlInput();
  setupRecorderControlBridge();

  const startButton = document.getElementById('start-transcription');
  const stopButton = document.getElementById('stop-transcription');
  const clearButton = document.getElementById('clear-transcript');

  if (!startButton || !stopButton || !clearButton) {
    throw new Error('Recorder page controls were not found.');
  }

  startButton.addEventListener('click', () => {
    startTranscription().catch((error) => {
      setStatus(`Start failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  stopButton.addEventListener('click', () => {
    stopTranscription().catch((error) => {
      setStatus(`Stop failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  clearButton.addEventListener('click', () => {
    clearTranscript();
  });

  clearTranscript();
  setControlState(false);
  setStatus('Ready to record microphone outside Meet.');

  const query = new URLSearchParams(window.location.search);
  if (query.get('autostart') === '1') {
    startTranscription().catch((error) => {
      setStatus(`Start failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

window.studySnapAddon = {
  setUpSidePanel,
  initializeMainStage,
  initializeRecorderPage,
};
