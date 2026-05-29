"use client";

import { useEffect, useRef, useState } from "react";
import { bootLines, type TimelineStage } from "@/components/cinematic-intro-data";

export function useCinematicTimeline(reducedMotion: boolean | null) {
  const [stage, setStage] = useState<TimelineStage>("boot");
  const [bootLineCount, setBootLineCount] = useState(1);
  const [typedBootLine, setTypedBootLine] = useState("");

  useEffect(() => {
    if (reducedMotion) {
      return;
    }

    let lineIndex = 0;
    let charIndex = 0;
    let pauseUntil = 0;
    const typingTimer = window.setInterval(() => {
      const now = Date.now();
      if (now < pauseUntil) {
        return;
      }

      const line = bootLines[lineIndex];
      if (!line) {
        window.clearInterval(typingTimer);
        return;
      }

      charIndex += 1;
      setBootLineCount(lineIndex + 1);
      setTypedBootLine(line.slice(0, charIndex));

      if (charIndex >= line.length) {
        if (lineIndex === bootLines.length - 1) {
          window.clearInterval(typingTimer);
          return;
        }

        lineIndex += 1;
        charIndex = 0;
        pauseUntil = Date.now() + 170;
      }
    }, 24);

    const stageTimers = [
      window.setTimeout(() => setStage("brand"), 1350),
      window.setTimeout(() => setStage("alerts"), 2750),
      window.setTimeout(() => setStage("analysis"), 4250),
      window.setTimeout(() => setStage("heal"), 5800),
      window.setTimeout(() => setStage("cockpit"), 7350),
    ];

    return () => {
      window.clearInterval(typingTimer);
      stageTimers.forEach(window.clearTimeout);
    };
  }, [reducedMotion]);

  return {
    stage: reducedMotion ? "cockpit" : stage,
    bootLineCount: reducedMotion ? bootLines.length : bootLineCount,
    typedBootLine: reducedMotion ? bootLines[bootLines.length - 1] : typedBootLine,
    skipIntro: () => {
      setStage("cockpit");
      setBootLineCount(bootLines.length);
      setTypedBootLine(bootLines[bootLines.length - 1]);
    },
  };
}

export function ParticleNetwork({
  reducedMotion,
}: {
  reducedMotion: boolean | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (reducedMotion) {
      return;
    }

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    const activeCanvas = canvas;
    const activeContext = context;
    let frame = 0;
    let width = 0;
    let height = 0;
    const particles = Array.from({ length: 58 }, (_, index) => ({
      id: index,
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.00042,
      vy: (Math.random() - 0.5) * 0.00042,
    }));

    function resize() {
      const ratio = window.devicePixelRatio || 1;
      width = activeCanvas.clientWidth;
      height = activeCanvas.clientHeight;
      activeCanvas.width = Math.floor(width * ratio);
      activeCanvas.height = Math.floor(height * ratio);
      activeContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function draw() {
      activeContext.clearRect(0, 0, width, height);
      activeContext.lineWidth = 1;

      for (const particle of particles) {
        particle.x += particle.vx;
        particle.y += particle.vy;
        if (particle.x < 0 || particle.x > 1) {
          particle.vx *= -1;
        }
        if (particle.y < 0 || particle.y > 1) {
          particle.vy *= -1;
        }
      }

      particles.forEach((particle, index) => {
        const x = particle.x * width;
        const y = particle.y * height;
        activeContext.beginPath();
        activeContext.arc(x, y, 1.35, 0, Math.PI * 2);
        activeContext.fillStyle = "rgba(88, 166, 255, 0.5)";
        activeContext.fill();

        for (let nextIndex = index + 1; nextIndex < particles.length; nextIndex += 1) {
          const next = particles[nextIndex];
          const nx = next.x * width;
          const ny = next.y * height;
          const distance = Math.hypot(x - nx, y - ny);
          if (distance < 120) {
            const alpha = (1 - distance / 120) * 0.2;
            activeContext.strokeStyle = `rgba(63, 185, 80, ${alpha})`;
            activeContext.beginPath();
            activeContext.moveTo(x, y);
            activeContext.lineTo(nx, ny);
            activeContext.stroke();
          }
        }
      });

      frame = window.requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener("resize", resize);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 size-full opacity-70"
      aria-hidden="true"
    />
  );
}

export function useAmbientSound(
  enabled: boolean,
  reducedMotion: boolean | null,
) {
  useEffect(() => {
    if (!enabled || reducedMotion) {
      return;
    }

    const AudioContextConstructor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextConstructor) {
      return;
    }

    const context = new AudioContextConstructor();
    const playPulse = () => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 146;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.018, context.currentTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.48);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.5);
    };

    void context.resume().then(playPulse);
    const timer = window.setInterval(playPulse, 2400);

    return () => {
      window.clearInterval(timer);
      void context.close();
    };
  }, [enabled, reducedMotion]);
}

export async function writeClipboardText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some embedded browsers block clipboard writes without a fallback.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.inset = "0 auto auto 0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("Clipboard command was not accepted.");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}
