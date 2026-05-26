"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Headphones,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  DemoRunPayload,
  readDemoRunPayload,
  subscribeToDemoRuns,
} from "@/lib/demo-mode";
import { API_BASE_URL } from "@/lib/api-client";

type VoiceAssistantResponse = {
  question: string;
  answer: string;
  spoken_answer: string;
  confidence: number;
  evidence: string[];
  answered_at: string;
};

type SpeechRecognitionAlternative = {
  transcript: string;
};

type SpeechRecognitionResult = {
  isFinal: boolean;
  0: SpeechRecognitionAlternative;
};

type SpeechRecognitionResultList = {
  length: number;
  [index: number]: SpeechRecognitionResult;
};

type SpeechRecognitionResultEvent = Event & {
  results: SpeechRecognitionResultList;
};

type SpeechRecognitionErrorEvent = Event & {
  error: string;
};

type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

type NarratorBriefing = {
  headline: string;
  incident: string;
  fix: string;
  narration: string;
  stats: string[];
};

function browserSpeechRecognitionConstructor() {
  if (typeof window === "undefined") {
    return undefined;
  }

  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

function browserSupportsSpeechSynthesis() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function subscribeToBrowserSupport(callback: () => void) {
  const timer = window.setTimeout(callback, 0);

  return () => {
    window.clearTimeout(timer);
  };
}

function speechRecognitionSupportSnapshot() {
  return Boolean(browserSpeechRecognitionConstructor());
}

function speechSynthesisSupportSnapshot() {
  return browserSupportsSpeechSynthesis();
}

function unsupportedBrowserSnapshot() {
  return false;
}

function formatNarratorAction(action: string) {
  return action.replaceAll("_", " ");
}

function joinFriendlyList(items: string[]) {
  if (items.length <= 1) {
    return items[0] ?? "";
  }

  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function buildDemoNarratorBriefing(payload: DemoRunPayload): NarratorBriefing {
  const unhealthyPods = payload.cluster_status.unhealthy_pods.length;
  const ciFailures = payload.cicd_failures.length;
  const actions = payload.auto_heal.actions.map((action) =>
    formatNarratorAction(action.action),
  );
  const actionSummary = joinFriendlyList(actions);
  const fix = payload.analysis.recommended_fix;
  const incident = payload.analysis.root_cause;

  return {
    headline: payload.detected_issue,
    incident,
    fix,
    narration: [
      "Hi, I am DevPilot, your incident narrator.",
      `I found a ${payload.analysis.severity} deployment incident.`,
      incident,
      `The strongest signals were ${unhealthyPods} unhealthy Kubernetes pod${unhealthyPods === 1 ? "" : "s"} and ${ciFailures} failed CI check${ciFailures === 1 ? "" : "s"}.`,
      actionSummary ? `I applied the recovery plan: ${actionSummary}.` : "",
      `The fix was: ${fix}`,
      "The demo is ready for review.",
    ]
      .filter(Boolean)
      .join(" "),
    stats: [
      `${unhealthyPods} unhealthy pod${unhealthyPods === 1 ? "" : "s"}`,
      `${ciFailures} CI failure${ciFailures === 1 ? "" : "s"}`,
      `${payload.auto_heal.actions.length} recovery action${
        payload.auto_heal.actions.length === 1 ? "" : "s"
      }`,
    ],
  };
}

function defaultNarratorBriefing(): NarratorBriefing {
  return {
    headline: "DevPilot narrator is ready",
    incident: "Run the demo to load the latest incident narrative.",
    fix: "The applied fix will appear here after the demo run completes.",
    narration:
      "Hi, I am DevPilot, your incident narrator. Run the demo and I will explain what failed, what fix was applied, and what recovered.",
    stats: ["Incident pending", "Fix pending", "Voice ready"],
  };
}

function selectFriendlyNarratorVoice(voices: SpeechSynthesisVoice[]) {
  const englishVoices = voices.filter((voice) =>
    voice.lang.toLowerCase().startsWith("en"),
  );
  const preferredNames = [
    "Jenny",
    "Aria",
    "Samantha",
    "Zira",
    "Google US English",
    "Google UK English Female",
  ];

  return (
    preferredNames
      .map((name) =>
        englishVoices.find((voice) =>
          voice.name.toLowerCase().includes(name.toLowerCase()),
        ),
      )
      .find(Boolean) ??
    englishVoices[0] ??
    voices[0]
  );
}

export function VoiceAssistantPanel() {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const narratedRunRef = useRef<string | null>(null);
  const [question, setQuestion] = useState("Why did deployment fail?");
  const [response, setResponse] = useState<VoiceAssistantResponse | null>(null);
  const [demoPayload, setDemoPayload] = useState<DemoRunPayload | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceName, setVoiceName] = useState("Browser default");
  const micSupported = useSyncExternalStore(
    subscribeToBrowserSupport,
    speechRecognitionSupportSnapshot,
    unsupportedBrowserSnapshot,
  );
  const speechSupported = useSyncExternalStore(
    subscribeToBrowserSupport,
    speechSynthesisSupportSnapshot,
    unsupportedBrowserSnapshot,
  );
  const narratorBriefing = useMemo(
    () =>
      demoPayload
        ? buildDemoNarratorBriefing(demoPayload)
        : defaultNarratorBriefing(),
    [demoPayload],
  );
  const narratorState = isSpeaking
    ? "Speaking"
    : isListening
      ? "Listening"
      : isAsking
        ? "Thinking"
        : demoPayload
          ? "Ready"
          : "Standby";
  const narratorStateClass = isSpeaking
    ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
    : demoPayload
      ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
      : "border-zinc-500/25 bg-white/5 text-zinc-300";
  const audioBars = isSpeaking
    ? ["h-3", "h-6", "h-4", "h-7", "h-5", "h-8", "h-4", "h-6"]
    : ["h-3", "h-4", "h-3", "h-5", "h-3", "h-4", "h-3", "h-5"];

  function stopListening() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
  }

  function startListening() {
    const Recognition = browserSpeechRecognitionConstructor();
    if (!Recognition) {
      setError("Microphone speech recognition is not supported in this browser.");
      return;
    }

    setError(null);
    setResponse(null);

    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(
        { length: event.results.length },
        (_, index) => event.results[index][0].transcript,
      )
        .join(" ")
        .trim();

      if (transcript) {
        setQuestion(transcript);
      }
    };
    recognition.onerror = (event) => {
      setError(`Microphone input failed: ${event.error}.`);
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  }

  const speak = useCallback((text: string) => {
    if (!speechSupported || !text.trim()) {
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const selectedVoice = selectFriendlyNarratorVoice(
      window.speechSynthesis.getVoices(),
    );

    if (selectedVoice) {
      utterance.voice = selectedVoice;
      setVoiceName(selectedVoice.name);
    }

    utterance.rate = 0.92;
    utterance.pitch = 1.05;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [speechSupported]);

  function stopSpeaking() {
    if (speechSupported) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }

  useEffect(() => {
    if (!speechSupported || typeof window === "undefined") {
      return;
    }

    function updateVoiceName() {
      const selectedVoice = selectFriendlyNarratorVoice(
        window.speechSynthesis.getVoices(),
      );

      if (selectedVoice) {
        setVoiceName(selectedVoice.name);
      }
    }

    updateVoiceName();
    window.speechSynthesis.addEventListener("voiceschanged", updateVoiceName);

    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", updateVoiceName);
    };
  }, [speechSupported]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDemoPayload(readDemoRunPayload());
    }, 0);
    const unsubscribe = subscribeToDemoRuns((payload) => {
      setDemoPayload(payload);
      setResponse(null);
      setQuestion("Explain the latest demo incident and what fix was applied.");

      if (narratedRunRef.current === payload.ran_at) {
        return;
      }

      narratedRunRef.current = payload.ran_at;
      window.setTimeout(() => {
        speak(buildDemoNarratorBriefing(payload).narration);
      }, 350);
    });

    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [speak]);

  async function askAssistant() {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      setError("Ask a deployment question first.");
      return;
    }

    setIsAsking(true);
    setError(null);

    try {
      const apiResponse = await fetch(`${API_BASE_URL}/voice/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question: trimmedQuestion }),
      });
      const payload = (await apiResponse.json()) as VoiceAssistantResponse | { detail?: string };

      if (!apiResponse.ok) {
        throw new Error(
          "detail" in payload && payload.detail
            ? payload.detail
            : "Voice assistant request failed.",
        );
      }

      const assistantResponse = payload as VoiceAssistantResponse;
      setResponse(assistantResponse);
      speak(assistantResponse.spoken_answer || assistantResponse.answer);
    } catch (assistantError) {
      setError(
        assistantError instanceof Error
          ? assistantError.message
          : "Could not reach the voice assistant API.",
      );
    } finally {
      setIsAsking(false);
    }
  }

  return (
    <section id="voice-assistant" className="bg-[#08100f] px-5 py-14 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase text-cyan-200">
            AI Avatar Narrator
          </p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold text-white sm:text-4xl">
            DevPilot explains what happened.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">
            A speaking assistant narrates the incident, the applied fix, and the
            recovery result in a friendly voice.
          </p>

          <div className="mt-7 rounded-lg border border-white/10 bg-[#101618] p-4 shadow-2xl shadow-black/25 sm:p-5">
            <div className="flex items-start gap-4">
              <div
                className={`grid size-20 shrink-0 place-items-center rounded-lg border bg-[#07090b] transition ${
                  isSpeaking
                    ? "border-cyan-300/50 shadow-[0_0_32px_rgba(103,232,249,0.18)]"
                    : "border-white/10"
                }`}
                aria-hidden="true"
              >
                <Bot
                  className={`size-10 transition ${
                    isSpeaking ? "text-cyan-100" : "text-cyan-200"
                  }`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-cyan-200" aria-hidden="true" />
                    <p className="font-semibold text-white">DevPilot Narrator</p>
                  </div>
                  <span
                    className={`rounded-md border px-2 py-1 text-xs font-semibold uppercase ${narratorStateClass}`}
                  >
                    {narratorState}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-300">
                  {narratorBriefing.headline}
                </p>
                <div
                  className="mt-4 flex h-9 items-end gap-1"
                  aria-label={isSpeaking ? "Narrator speaking" : "Narrator idle"}
                >
                  {audioBars.map((height, index) => (
                    <span
                      key={`${height}-${index}`}
                      className={`w-2 rounded-sm bg-cyan-200/80 transition-all ${
                        isSpeaking ? "animate-pulse" : "opacity-45"
                      } ${height}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-3">
              <div className="rounded-lg border border-white/10 bg-[#07090b] p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-100">
                  <MessageCircle className="size-4 text-amber-200" aria-hidden="true" />
                  Incident
                </div>
                <p className="text-sm leading-6 text-zinc-300">
                  {narratorBriefing.incident}
                </p>
              </div>
              <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-50">
                  <CheckCircle2 className="size-4 text-emerald-200" aria-hidden="true" />
                  Fix Applied
                </div>
                <p className="text-sm leading-6 text-emerald-50/85">
                  {narratorBriefing.fix}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => speak(narratorBriefing.narration)}
                disabled={!speechSupported}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-cyan-300/40 bg-cyan-300 px-4 text-sm font-semibold text-zinc-950 shadow-[0_0_24px_rgba(103,232,249,0.16)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Volume2 className="size-4" aria-hidden="true" />
                Narrate Incident
              </button>
              <div className="flex flex-wrap gap-2">
                {narratorBriefing.stats.map((item, index) => (
                  <span
                    key={`${index}:${item}`}
                    className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-300"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
              <p className="text-sm text-zinc-400">Microphone</p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {micSupported ? "Ready" : "Unavailable"}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
              <p className="text-sm text-zinc-400">Voice output</p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {speechSupported ? "Ready" : "Text only"}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
              <div className="mb-2 flex items-center gap-2 text-sm text-zinc-400">
                <Headphones className="size-4 text-cyan-200" aria-hidden="true" />
                Narrator voice
              </div>
              <p className="truncate text-sm font-semibold text-white">{voiceName}</p>
            </div>
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-white/10 bg-[#101618] p-4 shadow-2xl shadow-black/25 sm:p-5">
          <label
            htmlFor="voice-question"
            className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100"
          >
            <Mic className="size-4 text-cyan-200" aria-hidden="true" />
            Question
          </label>
          <textarea
            id="voice-question"
            value={question}
            onChange={(event) => {
              setQuestion(event.target.value);
              setError(null);
            }}
            className="min-h-28 w-full resize-y rounded-md border border-white/10 bg-[#07090b] px-4 py-3 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/20"
            placeholder='Try: "Why did deployment fail?"'
          />

          <div className="mt-4 grid gap-3 sm:grid-cols-[auto_1fr_auto]">
            <button
              type="button"
              onClick={isListening ? stopListening : startListening}
              disabled={!micSupported || isAsking}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-cyan-300/40 bg-cyan-300 px-5 text-sm font-semibold text-zinc-950 shadow-[0_0_24px_rgba(103,232,249,0.16)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isListening ? (
                <MicOff className="size-4" aria-hidden="true" />
              ) : (
                <Mic className="size-4" aria-hidden="true" />
              )}
              {isListening ? "Stop" : "Mic"}
            </button>
            <button
              type="button"
              onClick={askAssistant}
              disabled={isAsking}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-emerald-300/40 bg-emerald-300 px-5 text-sm font-semibold text-zinc-950 shadow-[0_0_24px_rgba(110,231,183,0.16)] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isAsking ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
              Ask DevPilot
            </button>
            <button
              type="button"
              onClick={
                isSpeaking
                  ? stopSpeaking
                  : () => response && speak(response.spoken_answer || response.answer)
              }
              disabled={!speechSupported || !response}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/10 px-5 text-sm font-semibold text-zinc-100 transition hover:border-cyan-200/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSpeaking ? (
                <VolumeX className="size-4" aria-hidden="true" />
              ) : (
                <Volume2 className="size-4" aria-hidden="true" />
              )}
              {isSpeaking ? "Stop Voice" : "Replay"}
            </button>
          </div>

          {isListening ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-50">
              <Mic className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>Listening for your deployment question.</p>
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-100">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{error}</p>
            </div>
          ) : null}

          {response ? (
            <div className="mt-5 border-t border-white/10 pt-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                  <CheckCircle2 className="size-4 text-emerald-200" aria-hidden="true" />
                  DevPilot Answer
                </div>
                <span className="rounded-md border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 font-mono text-xs text-emerald-100">
                  {Math.round(response.confidence * 100)}% confidence
                </span>
              </div>

              <div className="rounded-lg border border-white/10 bg-[#07090b] p-4">
                <p className="text-sm leading-6 text-zinc-200">{response.answer}</p>
              </div>

              {response.evidence.length ? (
                <div className="mt-4 grid gap-2">
                  {response.evidence.map((item, index) => (
                    <div
                      key={`${index}:${item}`}
                      className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs leading-5 text-zinc-400"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
