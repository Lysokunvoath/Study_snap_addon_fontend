import { meet } from '@googleworkspace/meet-addons/meet.addons';

const CLOUD_PROJECT_NUMBER: string = '980889141066';
const MAIN_STAGE_CHANNEL_NAME = 'study-snap-transcript';
const BACKEND_URL_STORAGE_KEY = 'studySnap.backendUrl';
const DEFAULT_BACKEND_BASE_URL =
  'https://studysnapaddonbackend-production.up.railway.app';

type MainStageEvent =
  | { type: 'status'; payload: { text: string } }
  | { type: 'partial'; payload: { text: string } }
  | { type: 'final'; payload: { text: string } }
  | { type: 'clear'; payload: Record<string, never> };

type TranscriptMessage = {
  type?: string;
  payload?: {
    text?: string;
    message?: string;
    code?: string;
  };
};

type TranscriptionState = {
  ws: WebSocket | null;
  stream: MediaStream | null;
  audioContext: AudioContext | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  processorNode: ScriptProcessorNode | null;
  seq: number;
  partialLine: HTMLDivElement | null;
};

const transcriptionState: TranscriptionState = {
  ws: null,
  stream: null,
  audioContext: null,
  sourceNode: null,
  processorNode: null,
  seq: 0,
  partialLine: null,
};

let mainStageChannel: BroadcastChannel | null = null;

declare global {
  interface Window {
    studySnapAddon: {
      setUpSidePanel: () => Promise<void>;
      initializeMainStage: () => Promise<void>;
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

function setStoredBackendBaseUrl(baseUrl: string): void {
  try {
    window.localStorage.setItem(BACKEND_URL_STORAGE_KEY, baseUrl);
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

function toWsUrl(baseUrl: string): string {
  if (baseUrl.startsWith('https://')) {
    return `wss://${baseUrl.slice('https://'.length)}`;
  }

  if (baseUrl.startsWith('http://')) {
    return `ws://${baseUrl.slice('http://'.length)}`;
  }

  throw new Error('Backend URL must start with http:// or https://');
}

function setStatus(text: string): void {
  const status = document.getElementById('transcription-status');
  if (status) {
    status.textContent = text;
  }

  emitMainStageEvent({
    type: 'status',
    payload: { text },
  });
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

function setControlState(isRunning: boolean): void {
  const startButton = document.getElementById('start-transcription') as HTMLButtonElement | null;
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

function appendFinalLine(text: string): void {
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

  emitMainStageEvent({
    type: 'final',
    payload: { text },
  });
}

function upsertPartialLine(text: string): void {
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

  emitMainStageEvent({
    type: 'partial',
    payload: { text },
  });
}

function clearTranscript(): void {
  const transcript = document.getElementById('transcript');
  if (!transcript) {
    return;
  }

  transcript.innerHTML = '<div class="empty">Transcript will appear here.</div>';
  transcriptionState.partialLine = null;

  emitMainStageEvent({
    type: 'clear',
    payload: {},
  });
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

  channel.onmessage = (event: MessageEvent<MainStageEvent>) => {
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
  };

  clearMainStageTranscript();
  setMainStageStatus('Waiting for transcription...');
}

function handleServerMessage(event: MessageEvent): void {
  try {
    const message = JSON.parse(String(event.data)) as TranscriptMessage;

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
  const { ws, processorNode, sourceNode, audioContext, stream } = transcriptionState;

  if (processorNode) {
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
  setControlState(false);
  setStatus('Stopped');
}

async function startTranscription(): Promise<void> {
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

    const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
    transcriptionState.processorNode = processorNode;

    const ws = new WebSocket(wsUrl);
    transcriptionState.ws = ws;

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
      setStatus('Connected. Streaming audio...');
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

    processorNode.onaudioprocess = (event) => {
      const socket = transcriptionState.ws;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      const input = event.inputBuffer.getChannelData(0);
      const pcmBytes = floatToPcm16(input);
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
    };

    sourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination);
  } catch (error) {
    setStatus(`Start failed: ${error instanceof Error ? error.message : String(error)}`);
    await stopTranscription();
  }
}

export async function setUpSidePanel(): Promise<void> {
  const session = await meet.addon.createAddonSession({
    cloudProjectNumber: getCloudProjectNumber(),
  });

  const sidePanelClient = await session.createSidePanelClient();
  const startButton = document.getElementById('start-activity');

  if (!startButton) {
    throw new Error('Could not find #start-activity button in SidePanel.html');
  }

  const startTranscriptionButton = document.getElementById('start-transcription');
  const stopTranscriptionButton = document.getElementById('stop-transcription');
  const clearButton = document.getElementById('clear-transcript');

  if (!startTranscriptionButton || !stopTranscriptionButton || !clearButton) {
    throw new Error('Could not find transcription controls in SidePanel.html');
  }

  startButton.addEventListener('click', async () => {
    await sidePanelClient.startActivity({
      mainStageUrl: getDefaultMainStageUrl(),
    });
  });

  startTranscriptionButton.addEventListener('click', () => {
    startTranscription().catch((error) => {
      setStatus(`Start failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  stopTranscriptionButton.addEventListener('click', () => {
    stopTranscription().catch((error) => {
      setStatus(`Stop failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  clearButton.addEventListener('click', () => {
    clearTranscript();
  });

  initializeBackendUrlInput();
  clearTranscript();
  setControlState(false);
  setStatus('Idle');
}

export async function initializeMainStage(): Promise<void> {
  const session = await meet.addon.createAddonSession({
    cloudProjectNumber: getCloudProjectNumber(),
  });

  await session.createMainStageClient();
  setupMainStageTranscriptBridge();
}

window.studySnapAddon = {
  setUpSidePanel,
  initializeMainStage,
};
