/**
 * 工程流程路由段：让每个需求"上来先按流程走一遍"，并把这套流程有哪些技能讲清楚。
 *
 * 为什么需要单独一段提示词，而不是只把技能列出来：
 *
 * 1. 技能清单（`agent-skills.ts`）说的是"这台机器上有什么"，这一段说的是"什么时候该用哪个"
 *    —— 后者才是流程。25 个技能名平铺给模型，它只会挑看着像的那个；
 * 2. 默认技能包是**应用装的**，不是用户自己装的。它要出现在系统提示里（且要稳定出现），
 *    就不能指望技能页那套"用户装了什么就列什么"的逻辑；
 * 3. "哪些任务需要走流程"必须由模型判断（用户明确要求如此），所以这一段的写法是
 *    **给判据**而不是给命令：两边的判据都写清楚，让它自己选。
 *
 * 内容按阶段组织（与技能包自己的分组一致），技能只给 id + 一句"什么时候用"——
 * 正文仍然靠 `read_skill` 按需读，8k 窗口塞不下 25 个技能全文。
 */
import { DEFAULT_SKILL_PACKS, type SkillPack } from "./default-pack.ts";
import { isSkillEnabled } from "./enablement.ts";
import { getSetting } from "../runtime/settings.ts";

/** 流程开关：设置成 "0" 后系统提示里不再出现这一段。 */
export function skillWorkflowEnabled(): boolean {
  return getSetting("AGENT_SKILL_WORKFLOW") !== "0";
}

interface StageSkill {
  readonly id: string;
  /** 什么时候该读它 —— 写进提示词的那一句。 */
  readonly when: string;
}

interface WorkflowStage {
  readonly name: string;
  /** 这个阶段要拿到什么。 */
  readonly goal: string;
  readonly skills: readonly StageSkill[];
}

/** 六个阶段与各自的技能。顺序按技能包的分组，便于和上游对照。 */
const WORKFLOW_STAGES: readonly WorkflowStage[] = [
  {
    name: "DEFINE 界定",
    goal: "先把「做什么、为什么做、怎么算做完」问清楚，再谈实现。",
    skills: [
      { id: "interview-me", when: "需求含糊，问不到验收标准" },
      { id: "idea-refine", when: "想法还很粗，需要先发散再收敛" },
      { id: "spec-driven-development", when: "要写方案 / PRD / 需求文档" },
      { id: "constraint-driven-development", when: "要定质量门槛（测试、检查放在哪一步）" },
    ],
  },
  {
    name: "PLAN 计划",
    goal: "把方案拆成能独立验证、能单独提交的小步。",
    skills: [
      { id: "planning-and-task-breakdown", when: "有方案了，要拆任务与顺序" },
      { id: "doubt-driven-development", when: "风险高、改动不可逆，或代码不熟" },
    ],
  },
  {
    name: "BUILD 实现",
    goal: "一次只落一小片，落地即验证。",
    skills: [
      { id: "incremental-implementation", when: "改动跨多个文件，或要边做边可回退" },
      { id: "test-driven-development", when: "写逻辑、修 bug、改行为" },
      { id: "api-and-interface-design", when: "定接口 / 模块边界 / 对外契约" },
      { id: "frontend-ui-engineering", when: "动界面、组件、交互、可访问性" },
      { id: "source-driven-development", when: "要按官方文档而不是记忆里的写法实现" },
      { id: "context-engineering", when: "要给 agent 补上下文（规则文件、上下文打包）" },
    ],
  },
  {
    name: "VERIFY 验证",
    goal: "拿证据说话：跑过了、看到了，才算做完。",
    skills: [
      { id: "debugging-and-error-recovery", when: "测试红了、构建挂了、行为不对" },
      { id: "browser-testing-with-devtools", when: "要验证浏览器里的真实运行情况" },
    ],
  },
  {
    name: "REVIEW 复核",
    goal: "合并前过一遍质量门，而不是等出问题再回头。",
    skills: [
      { id: "code-review-and-quality", when: "提交 / 合并前自查或互查" },
      { id: "security-and-hardening", when: "碰了用户输入、鉴权、存储、外部集成" },
      { id: "performance-optimization", when: "有性能要求，或怀疑有回退" },
      { id: "code-simplification", when: "代码能跑但难读、难改" },
    ],
  },
  {
    name: "SHIP 交付",
    goal: "把改动交出去，并留下后来人需要的东西。",
    skills: [
      { id: "git-workflow-and-versioning", when: "提交、分支、开 PR、切版本" },
      { id: "ci-cd-and-automation", when: "动构建 / 部署流水线" },
      { id: "documentation-and-adrs", when: "架构决策、接口变更、对外说明" },
      { id: "observability-and-instrumentation", when: "加日志 / 指标 / 追踪" },
      { id: "shipping-and-launch", when: "准备上线，要有检查表与回滚方案" },
      { id: "deprecation-and-migration", when: "下线旧系统、迁移用户" },
    ],
  },
];

/**
 * 默认技能包的技能 id 集合。
 *
 * 两处要用：系统提示里的技能清单要把它们排除掉（这一段已经按阶段讲过了，
 * 再平铺 25 行只会挤掉用户自己的技能），以及判断"流程里点名的技能装上了没有"。
 */
export function defaultPackSkillIds(
  packs: readonly SkillPack[] = DEFAULT_SKILL_PACKS,
): Set<string> {
  return new Set(packs.flatMap((pack) => pack.skills));
}

/**
 * 流程段的文本。
 *
 * 技能包没装上时**照常输出**：流程本身（先界定、再计划、小步实现、验证、复核、交付）
 * 不依赖技能文件，技能只是各阶段的详细做法。段尾说明这一点，模型在没有技能可读时
 * 也知道该按描述自己走，而不是以为整段失效。
 */
export function workflowPromptSection(): string | null {
  if (!skillWorkflowEnabled()) return null;

  const lines: string[] = [
    "## 工程流程（默认按这套推进）",
    "",
    "处理需求时，默认按下面的阶段推进；每个阶段动手前先用 `read_skill` 把对应技能的",
    "SKILL.md 读进来 —— 它写着这个阶段的产出、判据和常见坑。技能名在系统提示的技能清单里",
    "可能没有列出（这一段已经按阶段讲过了），但 `read_skill` 按名字都能读到 ——",
    "唯一例外是在设置里被停用的技能，那类这里也不会点名。",
    "拿不准该走哪条路时，先读 `using-agent-skills`：它是这套流程的索引。",
    "",
  ];

  for (const stage of WORKFLOW_STAGES) {
    lines.push(`**${stage.name}** — ${stage.goal}`);
    // 停用的技能不点名：点了一个 read_skill 必定拒绝的名字，只会把模型引到死路上。
    for (const skill of stage.skills.filter((entry) => isSkillEnabled(entry.id))) {
      lines.push(`- \`${skill.id}\`：${skill.when}`);
    }
    lines.push("");
  }

  lines.push(
    "### 先判断这次要不要走流程",
    "",
    "走不走由你判断，判据是「这次改动值不值得有过程」：",
    "",
    "- **要走**（走全套，或明确挑其中几段）：跨多个文件的改动、新功能、改协议或数据结构、",
    "  难以复现的缺陷、需要别人评审的方案、不可逆或与线上相关的动作。这类任务至少要走过",
    "  **界定**与**验证**两段 —— 前者避免做错东西，后者避免「做完了」只是自己以为。",
    "- **不用走**：一问一答的咨询、读代码解释现状、单文件小修、格式或文案调整、",
    "  用户明确说了「直接改 / 别啰嗦」。这类直接做，不需要为流程本身付出回合。",
    "",
    "判断结果要能说出来：走了哪些阶段、读了哪些技能，在回复里一句话交代；",
    "决定跳过时也一样，一句话说明为什么这次不需要。",
    "**跳过流程不等于跳过诚实**：没跑过的验证不要写成跑过了，没读过的文件不要写成读过了。",
    "",
    "如果 `read_skill` 提示没有某个技能（技能包尚未装上），按这一段的描述自己执行该阶段即可，",
    "不要因为读不到技能就跳过整个流程。",
  );

  return lines.join("\n");
}
