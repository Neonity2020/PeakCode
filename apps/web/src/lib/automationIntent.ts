import type { CreateAutomationInput } from "@peakcode/contracts";

type AutomationIntent = Omit<CreateAutomationInput, "projectId" | "timezone">;

const CREATE_WORDS_RE =
  /(创建|建立|添加|安排|设置|设定|派|帮我|请|麻烦|create|add|schedule|set up)/i;
const AUTOMATION_WORDS_RE =
  /(定时任务|自动化|自动执行|每天|每日|每周|工作日|定期|按时|automation|schedule|scheduled|recurring|every day|daily|weekly|weekday)/i;

const WEEKDAY_INDEX: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 0,
};

function normalizeMeridiemHour(rawHour: number, period: string | undefined): number | null {
  if (!Number.isInteger(rawHour) || rawHour < 0 || rawHour > 23) return null;
  if (!period) return rawHour;
  if (/下午|晚上|傍晚|pm/i.test(period)) {
    return rawHour === 12 ? 12 : rawHour + 12 <= 23 ? rawHour + 12 : null;
  }
  if (/中午/i.test(period)) {
    return rawHour === 12 ? 12 : rawHour + 12 <= 23 ? rawHour + 12 : null;
  }
  if (/am|上午|早上|凌晨|清晨|早晨/i.test(period)) {
    return rawHour === 12 && /am|凌晨/i.test(period) ? 0 : rawHour;
  }
  return rawHour;
}

function normalizeMinute(rawMinute: string | undefined, half: string | undefined): number | null {
  if (half) return 30;
  if (!rawMinute) return 0;
  const minute = Number(rawMinute);
  return Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : null;
}

function cronFromChineseDaily(
  text: string,
): { cronExpression: string; matchedText: string } | null {
  const match =
    /(?:每(?:天|日)|天天|工作日|每个工作日)\s*(?:(上午|早上|早晨|清晨|中午|下午|傍晚|晚上|夜里|凌晨)\s*)?(\d{1,2})(?:[:：点时](\d{1,2})?\s*分?)?(半)?/i.exec(
      text,
    );
  if (!match) return null;
  const hour = normalizeMeridiemHour(Number(match[2]), match[1]);
  const minute = normalizeMinute(match[3], match[4]);
  if (hour === null || minute === null) return null;
  const dow = /工作日|每个工作日/.test(match[0]) ? "1-5" : "*";
  return {
    cronExpression: `${minute} ${hour} * * ${dow}`,
    matchedText: match[0],
  };
}

function cronFromChineseWeekly(
  text: string,
): { cronExpression: string; matchedText: string } | null {
  const match =
    /每周([一二三四五六日天1-7])\s*(?:(上午|早上|早晨|清晨|中午|下午|傍晚|晚上|夜里|凌晨)\s*)?(\d{1,2})(?:[:：点时](\d{1,2})?\s*分?)?(半)?/i.exec(
      text,
    );
  if (!match) return null;
  const dayOfWeek = WEEKDAY_INDEX[match[1] ?? ""];
  const hour = normalizeMeridiemHour(Number(match[3]), match[2]);
  const minute = normalizeMinute(match[4], match[5]);
  if (dayOfWeek === undefined || hour === null || minute === null) return null;
  return {
    cronExpression: `${minute} ${hour} * * ${dayOfWeek}`,
    matchedText: match[0],
  };
}

function cronFromEnglishDaily(
  text: string,
): { cronExpression: string; matchedText: string } | null {
  const match = /(?:every day|daily|weekdays?)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(
    text,
  );
  if (!match) return null;
  const hour = normalizeMeridiemHour(Number(match[1]), match[3]);
  const minute = normalizeMinute(match[2], undefined);
  if (hour === null || minute === null) return null;
  const dow = /weekday/i.test(match[0]) ? "1-5" : "*";
  return {
    cronExpression: `${minute} ${hour} * * ${dow}`,
    matchedText: match[0],
  };
}

function extractCron(text: string): { cronExpression: string; matchedText: string } | null {
  return cronFromChineseWeekly(text) ?? cronFromChineseDaily(text) ?? cronFromEnglishDaily(text);
}

function cleanTaskText(text: string, scheduleText: string | null): string {
  let next = text
    .trim()
    .replace(
      /^[\s，,。.!！:：]*(帮我|请|麻烦)?\s*(创建|建立|添加|安排|设置|设定|派)?\s*(一个|个)?\s*(定时任务|自动化|任务)?[\s，,。.!！:：]*/i,
      "",
    );
  if (scheduleText) {
    next = next.replace(scheduleText, "");
  }
  next = next
    .replace(/^(帮我|请|麻烦)\s*/i, "")
    .replace(/^[\s，,。.!！:：]+/, "")
    .replace(/[\s，,。.!！:：]+$/, "")
    .trim();
  return next.length > 0 ? next : text.trim();
}

function titleFromTask(taskText: string): string {
  const compact = taskText.replace(/\s+/g, " ").trim();
  return compact.length <= 36 ? compact : `${compact.slice(0, 35)}...`;
}

export function detectCreateAutomationIntent(text: string): AutomationIntent | null {
  const trimmed = text.trim();
  if (!trimmed || !CREATE_WORDS_RE.test(trimmed) || !AUTOMATION_WORDS_RE.test(trimmed)) {
    return null;
  }

  const cron = extractCron(trimmed);
  const taskText = cleanTaskText(trimmed, cron?.matchedText ?? null);
  if (taskText.length === 0) return null;

  return {
    title: titleFromTask(taskText),
    description: "",
    prompt: taskText,
    scheduleType: cron ? "cron" : "manual",
    cronExpression: cron?.cronExpression ?? null,
    templateId: null,
  };
}
