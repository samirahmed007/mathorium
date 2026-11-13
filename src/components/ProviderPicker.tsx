import { useEffect, useMemo } from "react";
import { useStore } from "@/store";
import { isOfflineProvider, keylessFallbackModel } from "@/lib/providers";
import { Badge, Select } from "./ui";

/**
 * Which capability the current tab actually needs.
 *  - "vision": Convert tab — the model is handed an image, so text-only models
 *    cannot do the job at all.
 *  - "text": Chat tab — every model can hold a text conversation, so nothing is
 *    filtered out there (vision models are simply marked).
 */
export type PickerMode = "vision" | "text";

/**
 * Sentinel provider id for the bundled on-device OCR engine. Pix2Text is not a
 * `Provider` (no endpoint, no key, no model list) but on the Convert tab it is a
 * real, selectable way to read an image, so it gets an entry in the same picker.
 * Choosing it drives `settings.convertEngine` rather than `activeProviderId`.
 */
const LOCAL_ENGINE_ID = "__pix2text_local__";

/** The on-device OCR models, mirroring Settings → Local engine. */
const LOCAL_ENGINE_MODELS = [
  { id: "auto", label: "Pix2Text MFR — math ⭐" },
  { id: "pix2text", label: "Pix2Text MFR (pinned)" },
  { id: "texteller", label: "TexTeller INT8 — math" },
  ...(window.mathoriumDesktop?.isDesktop ? [] : [{ id: "tesseract", label: "Tesseract.js — plain text only" }]),
];

export function ProviderPicker({ mode = "text" }: { mode?: PickerMode }) {
  const {
    providers,
    activeProviderId,
    activeModelId,
    setActiveProvider,
    setActiveModel,
    activeProvider,
    activeModel,
    settings,
    updateSettings,
  } = useStore();

  // Convert needs an image-capable model; listing text-only ones there just
  // invites the "not vision-capable" error after the user has already queued work.
  //
  // Image *generators* are excluded from both modes: they answer with a picture,
  // not with text, so picking one here can only ever fail. They have their own
  // home in Chat's Generate Image picker — see `lib/imageGen`.
  const models = useMemo(
    () =>
      activeProvider.models.filter((m) => !m.imageGen && (mode !== "vision" || m.vision)),
    [activeProvider, mode],
  );

  // A provider with no model for this mode can't serve the tab at all.
  // Also gate providers by offline/online master switches.
  const providerList = useMemo(
    () =>
      providers
        .filter((p) =>
          p.models.some((m) => !m.imageGen && (mode !== "vision" || m.vision)),
        )
        .filter((p) => {
          const isOffline = isOfflineProvider(p.id);
          if (isOffline && !settings.offlineEnabled) return false;
          if (!isOffline && !settings.onlineEnabled) return false;
          return true;
        })
        .slice()
        .sort((a, b) => (a.id === "puter" ? -1 : b.id === "puter" ? 1 : 0)),
    [providers, mode, settings.offlineEnabled, settings.onlineEnabled],
  );

  // On Convert the bundled Pix2Text engine is offered alongside the cloud
  // providers whenever Offline is on. It is listed first because it is the
  // keyless, no-network default and — with Online off — the only thing that can
  // read an image at all.
  const showLocalEngine = mode === "vision" && settings.offlineEnabled;
  const localSelected = showLocalEngine && settings.convertEngine === "local";

  // The stored model may be text-only while we're on Convert; surface it rather
  // than silently showing a mismatched selection.
  const modelMissing = mode === "vision" && !models.some((m) => m.id === activeModelId);

  // Switching to Convert with a text-only model selected would fail on the first
  // image. Move to this provider's vision default instead — but only when that
  // default is actually reachable, so we never silently change providers on the
  // user or point them at a model that cannot answer.
  useEffect(() => {
    if (!modelMissing) return;
    // Pix2Text is doing the reading, so the cloud model is irrelevant here. It
    // would still be the model Chat uses, and clobbering that with a vision id
    // the user never picked is how a keyless LLM7 ended up on the paid
    // `claude-opus-5` and 401'd on the first chat message.
    if (localSelected) return;
    // Prefer a model that can actually be reached. With no API key,
    // `keylessFallbackModel` returns only free vision ids; LLM7's vision models
    // are all paid, so it returns "" and we leave the selection alone — the
    // select already renders an explicit "text only, cannot read images" option,
    // which is more honest than silently choosing something that 401s.
    const fallback = activeProvider.apiKey?.trim()
      ? activeProvider.visionDefault || models[0]?.id
      : keylessFallbackModel(activeProvider, true);
    if (fallback) setActiveModel(fallback);
  }, [modelMissing, localSelected, activeProvider, models, setActiveModel]);

  // If the offline/online switches hid the provider that is currently selected,
  // move to the first one that is still listed. An empty list means this tab has
  // no usable provider at all (e.g. Convert with online off — local OCR covers
  // it), so leave the selection alone rather than picking something arbitrary.
  useEffect(() => {
    if (providerList.length === 0) return;
    if (providerList.some((p) => p.id === activeProviderId)) return;
    setActiveProvider(providerList[0].id);
  }, [providerList, activeProviderId, setActiveProvider]);

  /**
   * Picking an engine. The local entry and the cloud providers write to
   * different pieces of state, so the handler routes between them and keeps
   * `convertEngine` consistent: choosing a cloud provider while the engine is
   * Local-only would otherwise leave that provider selected but never used.
   */
  const onProviderChange = (value: string) => {
    if (value === LOCAL_ENGINE_ID) {
      updateSettings({ convertEngine: "local" });
      return;
    }
    setActiveProvider(value);
    if (settings.convertEngine === "local") {
      // Keep Pix2Text in the chain when Offline is still on — "both" runs it
      // first and falls back to the vision model the user just picked. The store
      // reads `activeProviderId` to decide whether that fallback is reachable,
      // and setState above has not landed yet, so pass the new id explicitly.
      updateSettings({ convertEngine: settings.offlineEnabled ? "both" : "cloud" }, value);
    }
  };

  const nothingToShow = providerList.length === 0 && !showLocalEngine;

  return (
    // On a phone the two selects cannot share the header line with the
    // Offline/Online toggles and Export without either overflowing or being
    // crushed to an unusable 46px, so basis-full drops them onto their own
    // full-width row (order-last keeps them below the buttons). From sm up they
    // sit inline as before.
    <div className="order-last flex w-full min-w-0 basis-full items-center gap-2 sm:order-none sm:w-auto sm:flex-none sm:basis-auto">
      {nothingToShow ? (
        <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200">
          No provider available — enable Offline or Online
        </div>
      ) : (
        <>
      <div className="relative min-w-0 flex-1 sm:flex-none">
        <Select
          value={localSelected ? LOCAL_ENGINE_ID : activeProviderId}
          onChange={(e) => onProviderChange(e.target.value)}
          className="h-9 min-w-0 py-0 text-xs sm:max-w-[230px]"
          title={mode === "vision" ? "Conversion engine (on-device or vision-capable cloud)" : "Active provider"}
        >
          {showLocalEngine && (
            <option value={LOCAL_ENGINE_ID}>🔬 Pix2Text · On-device (no key)</option>
          )}
          {providerList.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === "puter" ? "⭐ " : p.free ? "🟢 " : ""}
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="relative min-w-0 flex-1 sm:flex-none">
        <Select
          value={localSelected ? settings.localOCRModel : activeModelId}
          onChange={(e) =>
            localSelected
              ? updateSettings({ localOCRModel: e.target.value as "auto" | "pix2text" | "texteller" | "tesseract" })
              : setActiveModel(e.target.value)
          }
          className="h-9 min-w-0 py-0 text-xs sm:max-w-[210px]"
          title={localSelected ? "On-device OCR model" : mode === "vision" ? "Active model (image-capable only)" : "Active model"}
        >
          {localSelected
            ? LOCAL_ENGINE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))
            : (
              <>
                {modelMissing && (
                  <option value={activeModelId}>{activeModelId} — text only, cannot read images</option>
                )}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label || m.id}
                  </option>
                ))}
              </>
            )}
        </Select>
      </div>
      <div className="hidden items-center gap-1.5 sm:flex">
        {localSelected ? (
          <>
            <Badge tone="green">Free</Badge>
            <Badge tone="blue">Offline</Badge>
          </>
        ) : (
          <>
            {activeProvider.free && <Badge tone="green">Free</Badge>}
            <Badge tone={activeModel.vision ? "blue" : "default"}>{activeModel.vision ? "Vision" : "Text"}</Badge>
          </>
        )}
      </div>
        </>
      )}
    </div>
  );
}
