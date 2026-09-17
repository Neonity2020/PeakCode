// FILE: ComposerReferenceAttachments.tsx
// Purpose: Render plugin, assistant-selection and image composer attachments in one row.
// Layer: Chat composer presentation

import { type ProviderMentionReference } from "@peakcode/contracts";
import { type ComposerImageAttachment } from "../../composerDraftStore";
import { pluginMentionDedupKey } from "../../composerDraftStore.draft";
import { type ChatAssistantSelectionAttachment } from "../../types";
import { type ExpandedImagePreview } from "./ExpandedImagePreview";
import { AssistantSelectionsSummaryChip } from "./AssistantSelectionsSummaryChip";
import { ComposerImageAttachmentChip } from "./ComposerImageAttachmentChip";
import { ComposerPluginChip } from "./ComposerPluginChip";

interface ComposerReferenceAttachmentsProps {
  plugins: ReadonlyArray<ProviderMentionReference>;
  /**
   * Display names for the selected plugins, keyed by `pluginMentionDedupKey`. A reference
   * only carries its manifest name, so a chip falls back to that when discovery has not
   * reported the plugin (or has not loaded yet).
   */
  pluginLabels: ReadonlyMap<string, string>;
  assistantSelections: ReadonlyArray<ChatAssistantSelectionAttachment>;
  images: ReadonlyArray<ComposerImageAttachment>;
  nonPersistedImageIdSet: ReadonlySet<string>;
  onExpandImage: (preview: ExpandedImagePreview) => void;
  onRemovePlugin: (pluginPath: string) => void;
  onRemoveAssistantSelections: () => void;
  onRemoveImage: (imageId: string) => void;
}

export function ComposerReferenceAttachments({
  plugins,
  pluginLabels,
  assistantSelections,
  images,
  nonPersistedImageIdSet,
  onExpandImage,
  onRemovePlugin,
  onRemoveAssistantSelections,
  onRemoveImage,
}: ComposerReferenceAttachmentsProps) {
  if (plugins.length === 0 && assistantSelections.length === 0 && images.length === 0) {
    return null;
  }

  return (
    <div className="mb-2.5 flex flex-wrap gap-2">
      {plugins.map((plugin) => (
        <ComposerPluginChip
          key={plugin.path}
          plugin={plugin}
          label={pluginLabels.get(pluginMentionDedupKey(plugin)) ?? plugin.name}
          onRemovePlugin={onRemovePlugin}
        />
      ))}
      <AssistantSelectionsSummaryChip
        selections={assistantSelections}
        onRemove={assistantSelections.length > 0 ? onRemoveAssistantSelections : undefined}
      />
      {images.map((image) => (
        <ComposerImageAttachmentChip
          key={image.id}
          image={image}
          images={images}
          nonPersisted={nonPersistedImageIdSet.has(image.id)}
          onExpandImage={onExpandImage}
          onRemoveImage={onRemoveImage}
        />
      ))}
    </div>
  );
}
