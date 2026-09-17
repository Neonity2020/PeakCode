// FILE: PluginLibraryPresentation.tsx
// Purpose: Shared presentational building blocks used by both PluginsView and SkillsView.
//          Provider toggle, grid items, and the small UI bits that don't carry route state.
// Layer: Presentation
// Exports: ProviderDiscoveryToolbar, PluginGridItem, SkillGridItem, ProviderToggleButton,
//          PluginGlyph, SkillGlyph, InstalledStatus, ProviderIconByKind

import { useState, type ReactNode } from "react";
import { HammerIcon, CheckIcon, type LucideIcon } from "~/lib/icons";
import { type ProviderPluginDescriptor, type ProviderSkillDescriptor } from "@peakcode/contracts";
import {
  SiCanva,
  SiFigma,
  SiGithub,
  SiGmail,
  SiGooglecalendar,
  SiGoogledrive,
  SiHuggingface,
  SiLinear,
  SiNotion,
  SiSlack,
  SiStripe,
  SiVercel,
} from "react-icons/si";
import { isInstalledProviderPlugin } from "~/lib/providerDiscovery";
import { type PluginEntry } from "./useProviderDiscoveryData";

// ── Constants ──────────────────────────────────────────────────────────────

const KNOWN_PLUGIN_BRANDS: Record<string, { color: string; icon: typeof SiCanva }> = {
  canva: { icon: SiCanva, color: "#00C4CC" },
  figma: { icon: SiFigma, color: "#F24E1E" },
  github: { icon: SiGithub, color: "#181717" },
  gmail: { icon: SiGmail, color: "#EA4335" },
  googlecalendar: { icon: SiGooglecalendar, color: "#4285F4" },
  googledrive: { icon: SiGoogledrive, color: "#0F9D58" },
  huggingface: { icon: SiHuggingface, color: "#FF9D00" },
  linear: { icon: SiLinear, color: "#5E6AD2" },
  notion: { icon: SiNotion, color: "#111111" },
  slack: { icon: SiSlack, color: "#4A154B" },
  stripe: { icon: SiStripe, color: "#635BFF" },
  vercel: { icon: SiVercel, color: "#111111" },
};

/**
 * Plugins shipped by Peak Code itself, drawn as app icons rather than left to the accent
 * tile and the fallback hammer.
 *
 * Both files are the draw.io "3D Icons" set `3d-dynamic-gradient` — CC0-1.0 public domain,
 * browsable at `icons.motucloud.com/collection/motu-diagrams-n-3d-dynamic-gradient` — kept at
 * the set's 128px render size so the 44px tile stays crisp on retina. `browser-use` uses the
 * set's link (the web URL); `computer-use` uses its desktop computer. To swap art, drop a new
 * file in `apps/web/public/plugin-icons/` and point the path at it.
 *
 * A provider that ships its own `interface.logo` still wins over this map.
 */
const KNOWN_PLUGIN_APP_ICONS: Record<string, string> = {
  browseruse: "/plugin-icons/browser-use.png",
  computeruse: "/plugin-icons/computer-use.png",
};

// ── Utilities ──────────────────────────────────────────────────────────────

export function pluginEntryKey(entry: Pick<PluginEntry, "marketplacePath" | "plugin">): string {
  return `${entry.marketplacePath}::${entry.plugin.name}`;
}

export function sectionTitle(value: string): string {
  const n = value.trim();
  return n.length === 0 ? "Unknown" : n;
}

function resolvePluginAccent(plugin: ProviderPluginDescriptor): string | undefined {
  return plugin.interface?.brandColor?.trim() || undefined;
}

function normalizeBrandKey(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function resolvePluginLogo(plugin: ProviderPluginDescriptor): string | undefined {
  return plugin.interface?.logo?.trim() || undefined;
}

function brandKeyCandidates(plugin: ProviderPluginDescriptor): string[] {
  return [plugin.interface?.composerIcon, plugin.interface?.displayName, plugin.name].map(
    normalizeBrandKey,
  );
}

function resolvePluginBrand(
  plugin: ProviderPluginDescriptor,
): { color: string; icon: typeof SiCanva } | undefined {
  for (const candidate of brandKeyCandidates(plugin)) {
    if (!candidate) continue;
    const knownBrand = KNOWN_PLUGIN_BRANDS[candidate];
    if (knownBrand) return knownBrand;
  }

  return undefined;
}

function resolvePluginAppIcon(plugin: ProviderPluginDescriptor): string | undefined {
  for (const candidate of brandKeyCandidates(plugin)) {
    if (!candidate) continue;
    const appIcon = KNOWN_PLUGIN_APP_ICONS[candidate];
    if (appIcon) return appIcon;
  }

  return undefined;
}

function nameToHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = name.charCodeAt(i) + ((h << 5) - h);
  }
  return Math.abs(h) % 360;
}

// ── Glyphs ─────────────────────────────────────────────────────────────────

export function PluginGlyph({ plugin }: { plugin: ProviderPluginDescriptor }) {
  const accent = resolvePluginAccent(plugin);
  const logo = resolvePluginLogo(plugin);
  const appIcon = resolvePluginAppIcon(plugin);
  const brand = resolvePluginBrand(plugin);
  const hue = nameToHue(plugin.interface?.displayName ?? plugin.name);
  const [logoFailed, setLogoFailed] = useState(false);
  const style = accent
    ? {
        background: `linear-gradient(145deg, ${accent}cc, ${accent}77)`,
        boxShadow: `0 0 0 0.5px ${accent}35`,
      }
    : {
        background: `linear-gradient(145deg, hsl(${hue} 55% 30%), hsl(${hue} 45% 18%))`,
        boxShadow: `0 0 0 0.5px hsl(${hue} 40% 30% / 0.35)`,
      };

  if (logo && !logoFailed) {
    return (
      <span
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-[14px] border border-border/60 bg-background"
        style={accent ? { boxShadow: `0 0 0 0.5px ${accent}25` } : undefined}
      >
        <img
          src={logo}
          alt=""
          className="size-7 rounded-md object-contain"
          onError={() => setLogoFailed(true)}
        />
      </span>
    );
  }

  if (appIcon) {
    return (
      <span
        className="inline-flex size-11 shrink-0 items-center justify-center"
        data-testid="plugin-app-icon"
      >
        {/* The renders carry their own transparent margin, so the art is drawn larger than the
            tile: at 44px the monitor would read as a 28px stamp. `shrink-0` keeps the flex row
            from squeezing it back into the tile. */}
        <img src={appIcon} alt="" className="size-13 shrink-0 object-contain" draggable={false} />
      </span>
    );
  }

  if (brand) {
    const BrandIcon = brand.icon;
    return (
      <span
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-[14px] border border-border/60"
        style={{
          background: `${brand.color}1f`,
          boxShadow: `inset 0 0 0 0.5px ${brand.color}40`,
        }}
      >
        <BrandIcon className="size-6" style={{ color: brand.color }} />
      </span>
    );
  }

  return (
    <span
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-[14px]"
      style={style}
    >
      <HammerIcon className="size-4 text-foreground/85" />
    </span>
  );
}

export function SkillGlyph({ skill }: { skill: ProviderSkillDescriptor }) {
  const hue = nameToHue(skill.name);
  return (
    <span
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-[14px] text-[15px] font-semibold text-foreground"
      style={{
        background: `linear-gradient(145deg, hsl(${hue} 55% 30%), hsl(${hue} 45% 18%))`,
        boxShadow: `inset 0 0 0 0.5px hsl(${hue} 40% 30% / 0.35)`,
      }}
    >
      {skill.name.charAt(0).toUpperCase()}
    </span>
  );
}

// ── Status / Toolbar ───────────────────────────────────────────────────────

export function InstalledStatus({ installed }: { installed: boolean }) {
  if (!installed) return null;
  return (
    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/40 text-muted-foreground/60">
      <CheckIcon className="size-3.5" />
    </span>
  );
}

// ── Grid items ─────────────────────────────────────────────────────────────

export function PluginGridItem({
  entry,
  onSelect,
}: {
  entry: PluginEntry;
  onSelect: (entry: PluginEntry) => void;
}) {
  const description =
    entry.plugin.interface?.shortDescription ??
    entry.plugin.interface?.longDescription ??
    entry.plugin.source.path;
  const installed = isInstalledProviderPlugin(entry.plugin);

  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      data-testid="plugin-grid-item"
      className="flex w-full items-start gap-3 rounded-xl border border-border/60 bg-background/60 px-3.5 py-3 text-left transition-colors hover:bg-[var(--sidebar-accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <PluginGlyph plugin={entry.plugin} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold leading-snug text-foreground">
          {entry.plugin.interface?.displayName ?? entry.plugin.name}
        </p>
        {/* One line, like the marketplace it mirrors: the full sentence is in the detail
            view, and a two-line clamp makes every row a different height. */}
        <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{description}</p>
      </div>
      {installed ? (
        <span className="mt-0.5 shrink-0 text-[12px] text-muted-foreground/70">
          {INSTALLED_MARK}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The trailing affordance for an installed plugin.
 *
 * Not a button: a bundled plugin is compiled into the server, so there is no install,
 * uninstall or disable to offer, and a control that does nothing is worse than a label.
 */
const INSTALLED_MARK = "…";

/** One icon in the "installed" strip at the top of the marketplace. */
export function PluginInstalledTile({
  entry,
  onSelect,
}: {
  entry: PluginEntry;
  onSelect: (entry: PluginEntry) => void;
}) {
  const name = entry.plugin.interface?.displayName ?? entry.plugin.name;
  return (
    <button
      type="button"
      title={name}
      aria-label={name}
      onClick={() => onSelect(entry)}
      data-testid="plugin-installed-tile"
      className="inline-flex rounded-[14px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <PluginGlyph plugin={entry.plugin} />
    </button>
  );
}

export function SkillGridItem({ skill }: { skill: ProviderSkillDescriptor }) {
  const description =
    skill.interface?.shortDescription ?? skill.description ?? "No description available.";

  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-[var(--sidebar-accent)]">
      <SkillGlyph skill={skill} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold leading-snug text-foreground">
          {skill.interface?.displayName ?? skill.name}
        </p>
        <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{description}</p>
      </div>
      <InstalledStatus installed={skill.enabled} />
    </div>
  );
}

export function SectionHeader({ title }: { title: string }) {
  return <h2 className="px-3 pb-1 pt-2 text-[15px] font-semibold text-foreground">{title}</h2>;
}

export function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-border/60 bg-background/40 px-5 py-6 text-center">
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export function InlineWarning({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/6 px-3 py-2.5 text-xs text-muted-foreground">
      <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
      <div>{children}</div>
    </div>
  );
}

export type { LucideIcon };
