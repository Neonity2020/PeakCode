/**
 * TerminalHistory - ANSI/OSC sanitizing and line capping for persisted terminal scrollback.
 *
 * @module TerminalHistory
 */
import {
  PEAKCODE_TERMINAL_HOOK_OSC_PREFIX,
  type TerminalAgentHookEventType,
} from "@peakcode/shared/terminalThreads";

export function capHistory(history: string, maxLines: number): string {
  if (history.length === 0) return history;
  const hasTrailingNewline = history.endsWith("\n");
  const lines = history.split("\n");
  if (hasTrailingNewline) {
    lines.pop();
  }
  if (lines.length <= maxLines) return history;
  const capped = lines.slice(lines.length - maxLines).join("\n");
  return hasTrailingNewline ? `${capped}\n` : capped;
}

export function countCharacter(value: string, target: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === target) {
      count += 1;
    }
  }
  return count;
}

export function measureHistory(history: string): {
  historyLineBreakCount: number;
  historyEndsWithNewline: boolean;
} {
  return {
    historyLineBreakCount: countCharacter(history, "\n"),
    historyEndsWithNewline: history.endsWith("\n"),
  };
}

export function historyLineCount(
  history: string,
  lineBreakCount: number,
  endsWithNewline: boolean,
): number {
  if (history.length === 0) return 0;
  return lineBreakCount + (endsWithNewline ? 0 : 1);
}

function isCsiFinalByte(codePoint: number): boolean {
  return codePoint >= 0x40 && codePoint <= 0x7e;
}

function shouldStripCsiSequence(body: string, finalByte: string): boolean {
  // Persisted terminal history is replayed into a fresh xterm. Keep styling, but
  // strip cursor movement, erase, query/reply, and mode-control CSI sequences
  // that can move replayed prompt text off-screen or blank the pane.
  return finalByte !== "m";
}

function shouldStripOscSequence(content: string): boolean {
  return (
    /^(10|11|12);(?:\?|rgb:)/.test(content) || content.startsWith(PEAKCODE_TERMINAL_HOOK_OSC_PREFIX)
  );
}

function extractOscTitle(content: string): string | null {
  const match = content.match(/^(?:0|2);([\s\S]+)$/);
  return match?.[1]?.trim() || null;
}

function extractOscHookEvent(content: string): TerminalAgentHookEventType | null {
  if (!content.startsWith(PEAKCODE_TERMINAL_HOOK_OSC_PREFIX)) {
    return null;
  }
  const eventType = content.slice(PEAKCODE_TERMINAL_HOOK_OSC_PREFIX.length).trim();
  return eventType === "Start" || eventType === "Stop" || eventType === "PermissionRequest"
    ? eventType
    : null;
}

function stripStringTerminator(value: string): string {
  if (value.endsWith("\u001b\\")) {
    return value.slice(0, -2);
  }
  const lastCharacter = value.at(-1);
  if (lastCharacter === "\u0007" || lastCharacter === "\u009c") {
    return value.slice(0, -1);
  }
  return value;
}

function findStringTerminatorIndex(input: string, start: number): number | null {
  for (let index = start; index < input.length; index += 1) {
    const codePoint = input.charCodeAt(index);
    if (codePoint === 0x07 || codePoint === 0x9c) {
      return index + 1;
    }
    if (codePoint === 0x1b && input.charCodeAt(index + 1) === 0x5c) {
      return index + 2;
    }
  }
  return null;
}

function isEscapeIntermediateByte(codePoint: number): boolean {
  return codePoint >= 0x20 && codePoint <= 0x2f;
}

function isEscapeFinalByte(codePoint: number): boolean {
  return codePoint >= 0x30 && codePoint <= 0x7e;
}

function findEscapeSequenceEndIndex(input: string, start: number): number | null {
  let cursor = start;
  while (cursor < input.length && isEscapeIntermediateByte(input.charCodeAt(cursor))) {
    cursor += 1;
  }
  if (cursor >= input.length) {
    return null;
  }
  return isEscapeFinalByte(input.charCodeAt(cursor)) ? cursor + 1 : start + 1;
}

export function sanitizeTerminalHistoryChunk(
  pendingControlSequence: string,
  data: string,
): {
  visibleText: string;
  pendingControlSequence: string;
  titleSignals: string[];
  hookEvents: TerminalAgentHookEventType[];
} {
  const input = `${pendingControlSequence}${data}`;
  let visibleText = "";
  let index = 0;
  const titleSignals: string[] = [];
  const hookEvents: TerminalAgentHookEventType[] = [];

  const append = (value: string) => {
    visibleText += value;
  };

  while (index < input.length) {
    const codePoint = input.charCodeAt(index);

    if (codePoint === 0x1b) {
      const nextCodePoint = input.charCodeAt(index + 1);
      if (Number.isNaN(nextCodePoint)) {
        return {
          visibleText,
          pendingControlSequence: input.slice(index),
          titleSignals,
          hookEvents,
        };
      }

      if (nextCodePoint === 0x5b) {
        let cursor = index + 2;
        while (cursor < input.length) {
          if (isCsiFinalByte(input.charCodeAt(cursor))) {
            const sequence = input.slice(index, cursor + 1);
            const body = input.slice(index + 2, cursor);
            if (!shouldStripCsiSequence(body, input[cursor] ?? "")) {
              append(sequence);
            }
            index = cursor + 1;
            break;
          }
          cursor += 1;
        }
        if (cursor >= input.length) {
          return {
            visibleText,
            pendingControlSequence: input.slice(index),
            titleSignals,
            hookEvents,
          };
        }
        continue;
      }

      if (
        nextCodePoint === 0x5d ||
        nextCodePoint === 0x50 ||
        nextCodePoint === 0x5e ||
        nextCodePoint === 0x5f
      ) {
        const terminatorIndex = findStringTerminatorIndex(input, index + 2);
        if (terminatorIndex === null) {
          return {
            visibleText,
            pendingControlSequence: input.slice(index),
            titleSignals,
            hookEvents,
          };
        }
        const sequence = input.slice(index, terminatorIndex);
        const content = stripStringTerminator(input.slice(index + 2, terminatorIndex));
        const hookEvent = extractOscHookEvent(content);
        if (hookEvent) {
          hookEvents.push(hookEvent);
        }
        if (nextCodePoint === 0x5d) {
          const titleSignal = extractOscTitle(content);
          if (titleSignal) {
            titleSignals.push(titleSignal);
          }
        }
        if (nextCodePoint !== 0x5d || !shouldStripOscSequence(content)) {
          append(sequence);
        }
        index = terminatorIndex;
        continue;
      }

      const escapeSequenceEndIndex = findEscapeSequenceEndIndex(input, index + 1);
      if (escapeSequenceEndIndex === null) {
        return {
          visibleText,
          pendingControlSequence: input.slice(index),
          titleSignals,
          hookEvents,
        };
      }
      const sequence = input.slice(index, escapeSequenceEndIndex);
      if (sequence !== "\u001b7" && sequence !== "\u001b8") {
        append(sequence);
      }
      index = escapeSequenceEndIndex;
      continue;
    }

    if (codePoint === 0x9b) {
      let cursor = index + 1;
      while (cursor < input.length) {
        if (isCsiFinalByte(input.charCodeAt(cursor))) {
          const sequence = input.slice(index, cursor + 1);
          const body = input.slice(index + 1, cursor);
          if (!shouldStripCsiSequence(body, input[cursor] ?? "")) {
            append(sequence);
          }
          index = cursor + 1;
          break;
        }
        cursor += 1;
      }
      if (cursor >= input.length) {
        return {
          visibleText,
          pendingControlSequence: input.slice(index),
          titleSignals,
          hookEvents,
        };
      }
      continue;
    }

    if (codePoint === 0x9d || codePoint === 0x90 || codePoint === 0x9e || codePoint === 0x9f) {
      const terminatorIndex = findStringTerminatorIndex(input, index + 1);
      if (terminatorIndex === null) {
        return {
          visibleText,
          pendingControlSequence: input.slice(index),
          titleSignals,
          hookEvents,
        };
      }
      const sequence = input.slice(index, terminatorIndex);
      const content = stripStringTerminator(input.slice(index + 1, terminatorIndex));
      const hookEvent = extractOscHookEvent(content);
      if (hookEvent) {
        hookEvents.push(hookEvent);
      }
      if (codePoint === 0x9d) {
        const titleSignal = extractOscTitle(content);
        if (titleSignal) {
          titleSignals.push(titleSignal);
        }
      }
      if (codePoint !== 0x9d || !shouldStripOscSequence(content)) {
        append(sequence);
      }
      index = terminatorIndex;
      continue;
    }

    append(input[index] ?? "");
    index += 1;
  }

  return { visibleText, pendingControlSequence: "", titleSignals, hookEvents };
}

export function sanitizePersistedTerminalHistory(history: string): string {
  if (history.length === 0) return history;
  return sanitizeTerminalHistoryChunk("", history).visibleText;
}
