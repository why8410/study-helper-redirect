const AUTO_SPEECH_STORAGE_KEY = "studyHelperAutoSpeech";

const state = {
  stream: null,
  latestImageDataUrl: "",
  revealedHints: new Set(),
  latestResponse: null,
  speechRecognition: null,
  speechSupported: false,
  preferredSpeechVoice: null,
  isListening: false,
  isAnalyzing: false,
};

// AI 분석 대기 중 경과 시간별 안내 (아이가 지루하지 않게)
const WAIT_MESSAGES = [
  [8, "🤔 AI가 문제를 꼼꼼히 읽고 있어요..."],
  [20, "✍️ 힌트를 만들고 있어요. 조금만 기다려 줘!"],
  [45, "💪 거의 다 됐어요! 열심히 생각하는 중..."],
  [90, "⏳ 평소보다 오래 걸리고 있어요. 조금만 더 기다려 줘..."],
];
const COACH_TIMEOUT_MS = 150_000; // 백엔드 OCR(60s)+CLI(90s) 최악 케이스에 맞춤

const elements = {
  apiModeChip: document.getElementById("api-mode-chip"),
  apiModelText: document.getElementById("api-model-text"),
  startCameraHero: document.getElementById("start-camera-hero"),
  focusPrompt: document.getElementById("focus-prompt"),
  startCameraButton: document.getElementById("start-camera-button"),
  askLiveButton: document.getElementById("ask-live-button"),
  captureButton: document.getElementById("capture-button"),
  imageUpload: document.getElementById("image-upload"),
  imageUploadCamera: document.getElementById("image-upload-camera"),
  cameraStage: document.getElementById("camera-stage"),
  cameraPreview: document.getElementById("camera-preview"),
  cameraGuideOverlay: document.getElementById("camera-guide-overlay"),
  capturedPreview: document.getElementById("captured-preview"),
  captureCanvas: document.getElementById("capture-canvas"),
  cameraEmpty: document.getElementById("camera-empty"),
  requestText: document.getElementById("request-text"),
  manualProblemNumber: document.getElementById("manual-problem-number"),
  typedProblemText: document.getElementById("typed-problem-text"),
  voiceButton: document.getElementById("voice-button"),
  analyzeButton: document.getElementById("analyze-button"),
  messageBox: document.getElementById("message-box"),
  messageText: document.getElementById("message-text"),
  analysisSpinner: document.getElementById("analysis-spinner"),
  selectedProblemNumber: document.getElementById("selected-problem-number"),
  problemSummary: document.getElementById("problem-summary"),
  problemNumberList: document.getElementById("problem-number-list"),
  translationText: document.getElementById("translation-text"),
  sourceExcerptText: document.getElementById("source-excerpt-text"),
  thinkingPromptText: document.getElementById("thinking-prompt-text"),
  autoSpeechToggle: document.getElementById("auto-speech-toggle"),
  playCoachingAudioButton: document.getElementById("play-coaching-audio-button"),
  stopCoachingAudioButton: document.getElementById("stop-coaching-audio-button"),
  speechStatusText: document.getElementById("speech-status-text"),
  hintsGrid: document.getElementById("hints-grid"),
  revealAnswerButton: document.getElementById("reveal-answer-button"),
  childAnswerInput: document.getElementById("child-answer-input"),
  answerBody: document.getElementById("answer-body"),
  checkQuestionText: document.getElementById("check-question-text"),
  finalAnswerText: document.getElementById("final-answer-text"),
  finalExplanationText: document.getElementById("final-explanation-text"),
  coachIntroText: document.getElementById("coach-intro-text"),
  parentSummaryText: document.getElementById("parent-summary-text"),
  confidenceNoteText: document.getElementById("confidence-note-text"),
  historyList: document.getElementById("history-list"),
  refreshHistoryButton: document.getElementById("refresh-history-button"),
  historySummary: document.getElementById("history-summary"),
};

function getParentSettingsDetails() {
  return document.querySelector(".parent-settings");
}

function setStep(n) {
  document.querySelectorAll(".step-dot").forEach((dot) => {
    const s = parseInt(dot.dataset.step, 10);
    dot.classList.toggle("step-dot--active", s === n);
    dot.classList.toggle("step-dot--done", s < n);
  });
}

async function init() {
  restoreAutoSpeechPreference();
  bindEvents();
  syncCameraInterface();
  await fetchStatus();
  initializeSpeechRecognition();
  initializeSpeechSynthesis();
  renderEmptyHints();
  setStep(1);
}

function restoreAutoSpeechPreference() {
  // #21: 자동 읽기는 기본 OFF, 사용자가 켜면 다음에도 기억한다.
  if (!elements.autoSpeechToggle) return;
  let saved = null;
  try {
    saved = window.localStorage.getItem(AUTO_SPEECH_STORAGE_KEY);
  } catch (error) {
    saved = null;
  }
  elements.autoSpeechToggle.checked = saved === "on";
}

function bindEvents() {
  elements.startCameraHero.addEventListener("click", handleCameraToggle);
  elements.startCameraButton.addEventListener("click", handleCameraToggle);
  elements.focusPrompt.addEventListener("click", openParentSettings);
  elements.askLiveButton.addEventListener("click", () => submitForCoaching("camera_live"));
  elements.captureButton.addEventListener("click", captureCurrentFrame);
  elements.imageUpload.addEventListener("change", handleImageUpload);
  if (elements.imageUploadCamera) {
    elements.imageUploadCamera.addEventListener("change", handleImageUpload);
  }
  elements.analyzeButton.addEventListener("click", () => submitForCoaching("capture"));
  elements.voiceButton.addEventListener("click", handleVoiceInput);
  elements.playCoachingAudioButton.addEventListener("click", playCoachingAudio);
  elements.stopCoachingAudioButton.addEventListener("click", stopCoachingAudio);
  elements.revealAnswerButton.addEventListener("click", revealFinalAnswer);

  if (elements.autoSpeechToggle) {
    elements.autoSpeechToggle.addEventListener("change", () => {
      try {
        window.localStorage.setItem(
          AUTO_SPEECH_STORAGE_KEY,
          elements.autoSpeechToggle.checked ? "on" : "off"
        );
      } catch (error) {
        /* localStorage 불가 환경은 무시 */
      }
    });
  }

  if (elements.refreshHistoryButton) {
    elements.refreshHistoryButton.addEventListener("click", loadHistory);
  }
  if (elements.historySummary) {
    elements.historySummary.addEventListener("click", () => {
      // 펼칠 때 최신 기록을 한 번 불러온다.
      window.setTimeout(loadHistory, 0);
    });
  }

  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      elements.requestText.value = button.dataset.prompt;
      elements.requestText.focus();
    });
  });

  window.addEventListener("pagehide", () => {
    stopCameraStream();
    syncCameraInterface();
  });
}

async function fetchStatus() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    const data = await response.json();

    elements.apiModeChip.classList.remove("chip--offline", "chip--demo", "chip--live");

    if (data.apiMode === "local") {
      elements.apiModeChip.textContent = "이 PC 로컬 AI";
      elements.apiModeChip.classList.add("chip--live");
      elements.apiModelText.textContent =
        data.message || `${data.model || "Apple On-Device AI"} 로 실제 분석`;
      return;
    }

    if (data.apiMode === "live") {
      const isClaudeModel = (data.model || "").includes("Claude");
      elements.apiModeChip.textContent = isClaudeModel ? "Claude AI 연결 ✓" : "AI 연결됨 ✓";
      elements.apiModeChip.classList.add("chip--live");
      elements.apiModelText.textContent = `${data.model || "AI"} 모델로 실제 분석 중이에요`;
      return;
    }

    if (data.preferredBackend === "apple-local" && data.localAiAvailable === false) {
      elements.apiModeChip.textContent = "로컬 AI 준비 필요";
      elements.apiModeChip.classList.add("chip--demo");
      elements.apiModelText.textContent =
        data.message || "Mac 설정에서 Apple Intelligence를 켜면 사용할 수 있어요.";
      return;
    }

    elements.apiModeChip.textContent = "데모 모드";
    elements.apiModeChip.classList.add("chip--demo");
    elements.apiModelText.textContent =
      "Mac에서 🟢 StudyHelper_시작을 실행하면 Claude AI로 실제 분석해요.";
  } catch (error) {
    elements.apiModeChip.textContent = "서버 오프라인";
    elements.apiModeChip.classList.add("chip--offline");
    elements.apiModelText.textContent = "연결이 끊겼어요. 잠시 후 다시 시도합니다...";
    // 30초 후 자동 재시도
    setTimeout(fetchStatus, 30_000);
  }
}

// 5분마다 상태 자동 갱신 (터널 재연결 감지)
setInterval(fetchStatus, 5 * 60 * 1000);

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setMessage("이 브라우저에서는 카메라를 사용할 수 없어요. 사진 업로드를 이용해 주세요.");
    return;
  }

  try {
    stopCameraStream();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
      audio: false,
    });

    state.stream = stream;
    elements.cameraPreview.srcObject = stream;
    syncCameraInterface();
    setMessage("카메라가 켜졌어요. 문제집을 비춘 뒤 바로 질문할 수 있어요.");
  } catch (error) {
    syncCameraInterface();
    setMessage("카메라를 켜지 못했어요. 권한을 확인하거나 사진 업로드를 사용해 주세요.");
  }
}

function handleCameraToggle() {
  if (isCameraActive()) {
    stopCamera();
    return;
  }

  startCamera();
}

function stopCamera(options = {}) {
  const { keepStatusMessage = true } = options;
  stopCameraStream();
  syncCameraInterface();

  if (!keepStatusMessage) {
    return;
  }

  setMessage(
    state.latestImageDataUrl
      ? "카메라를 껐어요. 준비한 사진은 그대로 두고 이어서 질문할 수 있어요."
      : "카메라를 껐어요. 필요하면 다시 켜 주세요."
  );
}

function stopCameraStream() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  elements.cameraPreview.srcObject = null;
}

function isCameraActive() {
  return Boolean(state.stream);
}

function syncCameraInterface() {
  const cameraActive = isCameraActive();
  const hasCapturedImage = Boolean(state.latestImageDataUrl);
  const shouldShowStage = cameraActive || hasCapturedImage;

  elements.cameraStage.hidden = !shouldShowStage;
  elements.cameraPreview.hidden = !cameraActive;
  elements.cameraGuideOverlay.hidden = !cameraActive;
  elements.capturedPreview.hidden = cameraActive || !hasCapturedImage;
  elements.cameraEmpty.classList.toggle("is-hidden", cameraActive || hasCapturedImage);

  elements.askLiveButton.hidden = !cameraActive;
  elements.captureButton.hidden = !cameraActive;

  syncCameraTriggerButton(elements.startCameraButton, {
    active: cameraActive,
    idleLabel: hasCapturedImage ? "카메라 다시 켜기" : "카메라 켜기",
  });
  syncCameraTriggerButton(elements.startCameraHero, {
    active: cameraActive,
    idleLabel: "사진 찍기 시작",
  });
}

function syncCameraTriggerButton(button, options = {}) {
  const { active = false, idleLabel = "카메라 켜기" } = options;
  button.classList.toggle("is-active", active);
  button.setAttribute("aria-pressed", String(active));
  button.textContent = active ? "카메라 작동 중 · 끄기" : idleLabel;
}

function captureCurrentFrame(options = {}) {
  const { keepCameraVisible = false } = options;

  if (!elements.cameraPreview.srcObject) {
    setMessage("먼저 카메라를 켜 주세요.");
    return "";
  }

  const { videoWidth, videoHeight } = elements.cameraPreview;
  if (!videoWidth || !videoHeight) {
    setMessage("카메라 화면이 아직 준비되지 않았어요. 잠깐 뒤에 다시 시도해 주세요.");
    return "";
  }

  // 전체 프레임 캡처 — 박스 크롭 제거, AI가 전체 이미지에서 문제 인식
  const canvas = elements.captureCanvas;
  canvas.width = videoWidth;
  canvas.height = videoHeight;
  const context = canvas.getContext("2d");
  context.drawImage(elements.cameraPreview, 0, 0, videoWidth, videoHeight);

  state.latestImageDataUrl = canvas.toDataURL("image/jpeg", 0.92);
  elements.capturedPreview.src = state.latestImageDataUrl;

  if (!keepCameraVisible) {
    stopCameraStream();
  }

  syncCameraInterface();
  setMessage(
    keepCameraVisible
      ? "지금 보이는 화면으로 질문할게요."
      : "사진을 찍었어요. 이제 '몇 번 문제 도와줘'라고 입력하거나 바로 코칭을 시작해 보세요."
  );
  return state.latestImageDataUrl;
}

function handleImageUpload(event) {
  const [file] = event.target.files || [];
  // iOS에서 같은 파일 재선택 가능하도록 value 초기화
  event.target.value = "";
  if (!file) return;

  // 파일 크기 사전 경고 (10MB 초과)
  if (file.size > 10 * 1024 * 1024) {
    setMessage("사진이 너무 커요 (10MB 초과). 조금 더 작은 사진을 사용해 주세요.");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    stopCameraStream();
    const raw = String(reader.result || "");
    // 1920px 이하로 리사이즈 + 품질 85%로 압축
    resizeImageDataUrl(raw, 1920, 0.85).then((compressed) => {
      state.latestImageDataUrl = compressed;
      elements.capturedPreview.src = compressed;
      syncCameraInterface();
      setMessage("사진 업로드가 완료됐어요. '도와줘!' 버튼을 눌러보세요.");
    });
  };
  reader.readAsDataURL(file);
}

function resizeImageDataUrl(dataUrl, maxSide, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function initializeSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    elements.voiceButton.textContent = "미지원";
    elements.voiceButton.disabled = true;
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "ko-KR";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    state.isListening = true;
    setVoiceButtonState(true);
  };

  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript?.trim();
    if (transcript) {
      elements.requestText.value = transcript;
      setMessage(`음성으로 "${transcript}" 라고 들었어요.`);
    }
  };

  recognition.onerror = () => {
    setMessage("음성 인식이 잘 안 됐어요. 텍스트로 입력해 주세요.");
  };

  recognition.onend = () => {
    state.isListening = false;
    setVoiceButtonState(false);
  };

  state.speechRecognition = recognition;
}

function setVoiceButtonState(listening) {
  if (!elements.voiceButton) return;
  elements.voiceButton.textContent = listening ? "듣는 중…" : "음성";
  elements.voiceButton.classList.toggle("is-listening", listening);
  elements.voiceButton.setAttribute("aria-pressed", String(listening));
}

function initializeSpeechSynthesis() {
  state.speechSupported =
    "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

  if (!state.speechSupported) {
    elements.autoSpeechToggle.checked = false;
    elements.autoSpeechToggle.disabled = true;
    elements.playCoachingAudioButton.disabled = true;
    elements.stopCoachingAudioButton.disabled = true;
    updateSpeechStatus("이 브라우저에서는 음성 읽기를 지원하지 않아요.");
    return;
  }

  loadSpeechVoices();
  if ("onvoiceschanged" in window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = loadSpeechVoices;
  }
  updateSpeechStatus("코칭 내용을 천천히 읽어줄 수 있어요.");
}

function loadSpeechVoices() {
  if (!state.speechSupported) return;

  const voices = window.speechSynthesis.getVoices();
  state.preferredSpeechVoice =
    voices.find((voice) => voice.lang?.toLowerCase().startsWith("ko")) ||
    voices.find((voice) => voice.lang?.toLowerCase().startsWith("en")) ||
    null;
}

function updateSpeechStatus(text) {
  elements.speechStatusText.textContent = text;
}

function stopCoachingAudio() {
  if (!state.speechSupported) return;
  window.speechSynthesis.cancel();
  updateSpeechStatus("음성 읽기를 멈췄어요.");
}

function speakText(text) {
  if (!state.speechSupported) {
    updateSpeechStatus("이 브라우저에서는 음성 읽기를 지원하지 않아요.");
    return;
  }

  const cleanText = String(text || "").trim();
  if (!cleanText) {
    updateSpeechStatus("아직 읽어줄 코칭 내용이 없어요.");
    return;
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = state.preferredSpeechVoice?.lang || "ko-KR";
  utterance.voice = state.preferredSpeechVoice;
  utterance.rate = 0.96;
  utterance.pitch = 1.02;
  utterance.onstart = () => updateSpeechStatus("지금 코칭 내용을 읽어주고 있어요.");
  utterance.onend = () => updateSpeechStatus("읽기가 끝났어요. 다시 듣고 싶으면 버튼을 눌러 주세요.");
  utterance.onerror = () => updateSpeechStatus("음성 읽기 중 문제가 생겼어요. 다시 시도해 주세요.");
  window.speechSynthesis.speak(utterance);
}

function buildCoachingSpeechScript(data) {
  if (!data) return "";

  const parts = [
    data.selectedProblemNumber ? `${data.selectedProblemNumber}번 문제를 같이 볼게.` : "문제를 같이 볼게.",
    data.coachIntro,
    `문제 뜻은, ${data.translation}`,
    `먼저 생각해볼 점은, ${data.thinkingPrompt}`,
    "원하면 힌트 버튼을 눌러서 한 단계씩 들어보자.",
  ];

  return parts.filter(Boolean).join(" ");
}

function playCoachingAudio() {
  if (!state.latestResponse) {
    updateSpeechStatus("먼저 코칭 시작 버튼으로 문제를 분석해 주세요.");
    return;
  }
  speakText(buildCoachingSpeechScript(state.latestResponse));
}

function handleVoiceInput() {
  if (!state.speechRecognition) {
    setMessage("이 기기에서는 음성 입력을 지원하지 않아요.");
    return;
  }
  if (state.isListening) {
    // 이미 듣고 있으면 다시 start() 하지 않고 멈춘다.
    try {
      state.speechRecognition.stop();
    } catch (error) {
      /* 무시 */
    }
    return;
  }
  try {
    state.speechRecognition.start();
    setMessage("듣고 있어요. 예: 3번 문제 도와줘");
  } catch (error) {
    // 연타로 이미 시작된 경우 등 InvalidStateError 방지
    setMessage("음성 입력을 다시 시도해 주세요.");
  }
}

async function submitForCoaching(interactionMode) {
  if (state.isAnalyzing) {
    setMessage("지금 문제를 읽고 있어요. 조금만 기다려 줘!");
    return;
  }

  const requestText = elements.requestText.value.trim();
  const typedProblemText = elements.typedProblemText.value.trim();
  const manualProblemNumber = elements.manualProblemNumber.value.trim();
  let imageDataUrl = state.latestImageDataUrl;

  if (interactionMode === "camera_live") {
    if (!elements.cameraPreview.srcObject) {
      setMessage("실시간 질문을 하려면 먼저 카메라를 켜 주세요.");
      return;
    }
    imageDataUrl = captureCurrentFrame({ keepCameraVisible: true });
  }

  if (!imageDataUrl && !typedProblemText && !requestText) {
    setMessage("카메라, 사진, 텍스트 중 하나는 필요해요.");
    return;
  }

  stopCoachingAudio();
  setStep(2);
  setMessage("문제를 읽는 중이에요. 문제 번호와 힌트를 찾고 있어요...");
  showAnalysisSpinner(true);
  state.isAnalyzing = true;
  elements.analyzeButton.disabled = true;
  elements.askLiveButton.disabled = true;

  // 경과 시간별 대기 안내
  const startedAt = Date.now();
  const waitTicker = window.setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    for (let i = WAIT_MESSAGES.length - 1; i >= 0; i -= 1) {
      if (elapsed >= WAIT_MESSAGES[i][0]) {
        setMessage(WAIT_MESSAGES[i][1]);
        break;
      }
    }
  }, 4000);

  // 서버·터널이 끊겨도 무한 대기하지 않도록 타임아웃
  const abortController = new AbortController();
  const timeoutTimer = window.setTimeout(() => abortController.abort(), COACH_TIMEOUT_MS);

  try {
    const response = await fetch("/api/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: abortController.signal,
      body: JSON.stringify({
        interactionMode,
        imageDataUrl,
        requestText,
        typedProblemText,
        manualProblemNumber,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || data.hint || "분석에 실패했어요.");
    }

    renderResponse(data);
  } catch (error) {
    if (error.name === "AbortError") {
      setMessage("응답이 너무 오래 걸려서 멈췄어요. 다시 한 번 '도와줘!'를 눌러 줘.");
    } else {
      setMessage(error.message || "분석 중 문제가 생겼어요. 다시 시도해 주세요.");
    }
    setStep(1);
  } finally {
    window.clearInterval(waitTicker);
    window.clearTimeout(timeoutTimer);
    showAnalysisSpinner(false);
    state.isAnalyzing = false;
    elements.analyzeButton.disabled = false;
    elements.askLiveButton.disabled = false;
  }
}

function renderResponse(data) {
  state.latestResponse = data;
  state.revealedHints = new Set();
  elements.revealAnswerButton.disabled = false;
  elements.revealAnswerButton.classList.remove("primary", "ghost");
  elements.revealAnswerButton.classList.add("secondary");

  if (data.error) {
    setMessage(`실시간 연결 대신 데모 흐름으로 보여드렸어요. ${data.error}`);
  } else if (data.needsProblemNumberClarification) {
    setMessage(data.clarificationMessage || "문제 번호를 한 번 더 골라 주세요.");
  } else if (data.mode === "local-live") {
    setMessage("이 PC 안의 로컬 AI가 문제를 읽었어요. 힌트부터 차근차근 열어 보세요.");
  } else if (data.mode === "ocr-fallback") {
    setMessage("사진에서 읽은 글자를 바탕으로 힌트를 만들었어요. Claude AI가 연결되면 더 자연스러워져요.");
  } else {
    setMessage(
      data.mode === "live"
        ? "실제 분석 결과를 가져왔어요. 힌트부터 차근차근 열어 보세요."
        : "지금은 화면 체험용 코칭 결과를 보여드리고 있어요."
    );
  }

  elements.selectedProblemNumber.textContent = data.selectedProblemNumber
    ? `${data.selectedProblemNumber}번`
    : "선택 필요";
  elements.problemSummary.textContent = data.problemSummary || "문제 유형 확인 중";
  elements.translationText.textContent = data.translation || "문제 뜻을 읽어오는 중이에요.";
  elements.sourceExcerptText.textContent =
    data.sourceExcerpt || "사진을 읽거나 직접 입력한 문제 문장이 이곳에 나타납니다.";
  elements.thinkingPromptText.textContent =
    data.thinkingPrompt || "정답보다 먼저 단서를 살펴보자.";
  elements.coachIntroText.textContent =
    data.coachIntro || "아이 스스로 먼저 풀 수 있게 유도합니다.";
  elements.parentSummaryText.textContent =
    data.parentSummary || "부모 요약은 아직 없어요.";
  elements.confidenceNoteText.textContent =
    data.confidenceNote || "사진이 흔들리면 다시 찍도록 안내합니다.";
  elements.checkQuestionText.textContent =
    data.checkQuestion || "모든 힌트를 본 뒤에 정답을 열어 보세요.";
  elements.finalAnswerText.textContent = "잠겨 있어요";
  elements.finalExplanationText.textContent = "모든 힌트를 본 뒤에만 열려요.";
  elements.answerBody.classList.add("is-locked");
  if (elements.childAnswerInput) {
    elements.childAnswerInput.value = "";
  }

  setStep(3);
  renderProblemChips(data);
  renderHints(data.hints || []);

  // 결과 패널로 자동 스크롤
  const resultPanel = document.querySelector(".result-panel");
  if (resultPanel) {
    setTimeout(() => resultPanel.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  }

  if (state.speechSupported && elements.autoSpeechToggle.checked) {
    speakText(buildCoachingSpeechScript(data));
  }
}

function renderProblemChips(data) {
  elements.problemNumberList.innerHTML = "";

  const numbers = data.recognizedProblemNumbers || [];
  if (!numbers.length) {
    const chip = document.createElement("span");
    chip.className = "problem-chip";
    chip.textContent = "번호 인식 결과 없음";
    elements.problemNumberList.appendChild(chip);
    return;
  }

  numbers.forEach((number) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "problem-chip";
    if (number === data.selectedProblemNumber) {
      button.classList.add("is-selected");
    }
    button.textContent = `${number}번`;
    button.addEventListener("click", () => {
      elements.manualProblemNumber.value = number;
      elements.requestText.value = `${number}번 문제 도와줘`;
      submitForCoaching("capture");
    });
    elements.problemNumberList.appendChild(button);
  });
}

function renderEmptyHints() {
  elements.hintsGrid.innerHTML = "";
  elements.hintsGrid.insertAdjacentHTML("afterbegin",
    `<p class="hints-placeholder">사진을 찍고 '도와줘!'를 누르면 단계별 힌트가 여기에 나타나요.</p>`
  );
}

function renderHints(hints) {
  elements.hintsGrid.innerHTML = "";
  hints.forEach((hint, index) => {
    const card = document.createElement("article");
    card.className = "hint-card";

    // #6: 모델/OCR 파생 문자열을 innerHTML 로 넣지 않고 textContent 로 안전하게 렌더.
    const top = document.createElement("div");
    top.className = "hint-top";
    const titleWrap = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = hint.title || `힌트 ${index + 1}`;
    titleWrap.appendChild(title);
    const badge = document.createElement("span");
    badge.className = "hint-index";
    badge.textContent = String(index + 1);
    top.append(titleWrap, badge);

    const content = document.createElement("div");
    content.className = "hint-content is-hidden";
    const body = document.createElement("p");
    body.textContent = hint.body || "";
    content.appendChild(body);

    const revealButton = document.createElement("button");
    revealButton.type = "button";
    revealButton.className = "action hint-reveal hint-reveal-btn";
    revealButton.textContent = `🔓 힌트 ${index + 1} 열기`;
    revealButton.addEventListener("click", () => {
      content.classList.remove("is-hidden");
      card.classList.add("hint-card--open");
      state.revealedHints.add(index);
      revealButton.textContent = "✅ 힌트 봤어요!";
      revealButton.disabled = true;
      if (state.speechSupported && elements.autoSpeechToggle.checked) {
        speakText(`힌트 ${index + 1}. ${hint.body || ""}`);
      }
      if (state.revealedHints.size >= hints.length) {
        elements.revealAnswerButton.classList.remove("ghost", "secondary");
        elements.revealAnswerButton.classList.add("primary");
        setMessage("🎉 힌트를 모두 봤어요! 이제 내 답을 쓰고 정답을 열어보세요.");
      }
    });

    card.append(top, content, revealButton);
    elements.hintsGrid.appendChild(card);
  });
}

function revealFinalAnswer() {
  if (!state.latestResponse) {
    setMessage("먼저 문제를 분석해 주세요.");
    return;
  }

  const totalHints = state.latestResponse.hints?.length || 0;
  if (state.revealedHints.size < totalHints) {
    setMessage("정답은 힌트를 모두 본 뒤에 열 수 있어요.");
    return;
  }

  // #15: 정답을 열기 전에 아이가 자기 답을 한 번 쓰게 한다.
  const childAnswer = elements.childAnswerInput ? elements.childAnswerInput.value.trim() : "";
  if (!childAnswer) {
    setMessage("정답을 열기 전에, 내 답을 먼저 한 번 써 보자!");
    if (elements.childAnswerInput) {
      elements.childAnswerInput.focus();
    }
    return;
  }

  recordChildAttempt(childAnswer);

  setStep(4);
  elements.answerBody.classList.remove("is-locked");
  elements.finalAnswerText.textContent =
    state.latestResponse.finalAnswer?.answer || "정답 정보가 없어요.";
  elements.finalExplanationText.textContent =
    state.latestResponse.finalAnswer?.explanation || "풀이 설명이 없어요.";
  setMessage("🎊 정답이 열렸어요! 내 답이랑 비교해봐요.");
  // 정답 카드로 스크롤
  setTimeout(() => elements.answerBody.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
  if (state.speechSupported && elements.autoSpeechToggle.checked) {
    speakText(
      [
        "이제 정답과 풀이를 읽어줄게.",
        `정답은 ${state.latestResponse.finalAnswer?.answer || "확인 필요"}.`,
        state.latestResponse.finalAnswer?.explanation || "",
      ]
        .filter(Boolean)
        .join(" ")
    );
  }
}

function setMessage(text) {
  // 스피너 요소를 보존하기 위해 messageBox 전체가 아니라 텍스트 영역만 갱신한다.
  if (elements.messageText) {
    elements.messageText.textContent = text;
  } else {
    elements.messageBox.textContent = text;
  }
}

function showAnalysisSpinner(show) {
  if (!elements.analysisSpinner) return;
  elements.analysisSpinner.hidden = !show;
}

function openParentSettings() {
  const details = getParentSettingsDetails();
  if (details) {
    details.open = true;
    details.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  if (elements.requestText) {
    elements.requestText.focus();
  }
}

async function loadHistory() {
  if (!elements.historyList) return;
  try {
    const response = await fetch("/api/history");
    const data = await response.json();
    renderHistory(data.sessions || []);
  } catch (error) {
    elements.historyList.innerHTML = "";
    const li = document.createElement("li");
    li.className = "history-empty";
    li.textContent = "학습 기록을 불러오지 못했어요.";
    elements.historyList.appendChild(li);
  }
}

function formatHistoryTime(isoText) {
  if (!isoText) return "";
  const parsed = new Date(isoText);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderHistory(sessions) {
  elements.historyList.innerHTML = "";
  if (!sessions.length) {
    const li = document.createElement("li");
    li.className = "history-empty";
    li.textContent = "아직 저장된 학습 기록이 없어요.";
    elements.historyList.appendChild(li);
    return;
  }

  sessions.forEach((session) => {
    const li = document.createElement("li");
    li.className = "history-item";

    const time = document.createElement("span");
    time.className = "history-time";
    time.textContent = formatHistoryTime(session.timestamp);

    const title = document.createElement("strong");
    const numberLabel = session.selectedProblemNumber
      ? `${session.selectedProblemNumber}번 · `
      : "";
    title.textContent = `${numberLabel}${session.problemSummary || "문제"}`;

    const excerpt = document.createElement("span");
    excerpt.className = "history-excerpt";
    excerpt.textContent = session.sourceExcerpt || "";

    li.append(time, title);
    if (session.childAnswer) {
      const attempt = document.createElement("span");
      attempt.className = "history-attempt";
      attempt.textContent = `내 답: ${session.childAnswer}`;
      li.appendChild(attempt);
    }
    if (excerpt.textContent) {
      li.appendChild(excerpt);
    }
    elements.historyList.appendChild(li);
  });
}

async function recordChildAttempt(childAnswer) {
  // #15/#16: 아이가 정답을 열기 전에 쓴 답을 기록으로 남긴다(있을 때만, 실패 무시).
  const response = state.latestResponse;
  if (!response || !childAnswer) return;
  try {
    await fetch("/api/attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        childAnswer,
        selectedProblemNumber: response.selectedProblemNumber || "",
        problemSummary: response.problemSummary || "",
        sourceExcerpt: response.sourceExcerpt || "",
        finalAnswer: response.finalAnswer?.answer || "",
      }),
    });
  } catch (error) {
    /* 기록 실패는 학습 흐름을 막지 않는다. */
  }
}

init();
