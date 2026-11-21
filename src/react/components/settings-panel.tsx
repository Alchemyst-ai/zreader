import { useId, useRef, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { DownloadIcon, HardDriveIcon, RotateCcwIcon, UploadIcon } from "lucide-react";
import {
  FONT_FAMILIES,
  LEADINGS,
  MEASURES,
  TEXT_SIZES,
  collectGarbage,
  exportBackupWithImages,
  formatStorageBytes,
  highlightsToMarkdown,
  importBackupWithImages,
  referencedBlobs,
  requestPersistentStorage,
  type BookMeta,
  type FontFamily,
  type Leading,
  type Measure,
  type TextSize,
  type ThemeName,
} from "zreader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useBlobUsage, useHighlights, useHydrated, useReader, useSettings } from "../context";
import { downloadFile } from "../download";
import { ResponsivePanel } from "./responsive-panel";

const THEME_LABEL: Record<ThemeName, string> = { system: "Auto", light: "Light", sepia: "Sepia", dark: "Dark" };
const SIZE_LABEL: Record<TextSize, string> = { sm: "S", base: "M", lg: "L", xl: "XL", "2xl": "2XL" };
const LEADING_LABEL: Record<Leading, string> = { tight: "Tight", normal: "Normal", relaxed: "Relaxed" };
const MEASURE_LABEL: Record<Measure, string> = { narrow: "Narrow", normal: "Normal", wide: "Wide" };
const FONT_LABEL: Record<FontFamily, string> = { serif: "Serif", sans: "Sans", mono: "Mono" };

function Choice<T extends string>({
  label,
  value,
  values,
  labels,
  onChange,
}: {
  label: string;
  value: T;
  values: readonly T[];
  labels: Record<T, ReactNode>;
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <Label id={id}>{label}</Label>
      <ToggleGroup
        type="single"
        variant="outline"
        value={value}
        onValueChange={(v) => v && onChange(v as T)}
        aria-labelledby={id}
        className="w-full"
      >
        {values.map((v) => (
          <ToggleGroupItem key={v} value={v} className="flex-1">
            {labels[v]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

export interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  book?: BookMeta;
}

export function SettingsPanel({ open, onOpenChange, book }: SettingsPanelProps) {
  const { store, blobs, options } = useReader();
  const usage = useBlobUsage();
  const [settings, update] = useSettings();
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();
  const highlights = useHighlights(book?.id ?? "");
  const fileRef = useRef<HTMLInputElement>(null);
  const [replace, setReplace] = useState(false);
  const modeId = useId();
  const hlModeId = useId();

  const stamp = new Date().toISOString().slice(0, 10);

  const onImport = async (file: File) => {
    try {
      const res = await importBackupWithImages(store, blobs, await file.text(), { mode: replace ? "replace" : "merge" });
      const extra = [res.images ? `${res.images} image${res.images === 1 ? "" : "s"}` : "", res.skipped + res.imagesSkipped ? `${res.skipped + res.imagesSkipped} skipped` : ""].filter(Boolean);
      toast.success(`Imported ${res.imported} record${res.imported === 1 ? "" : "s"}`, {
        description: extra.length ? extra.join(", ") : undefined,
      });
    } catch (e) {
      toast.error("Import failed", { description: (e as Error).message });
    }
  };

  const onExport = async () => {
    try {
      downloadFile(`reader-backup-${stamp}.json`, JSON.stringify(await exportBackupWithImages(store, blobs), null, 2));
    } catch (e) {
      toast.error("Export failed", { description: (e as Error).message });
    }
  };

  const onCleanUp = async () => {
    const removed = await collectGarbage(blobs, referencedBlobs(store), { graceMs: 0 });
    toast(removed.length ? `Removed ${removed.length} unused image${removed.length === 1 ? "" : "s"}` : "No unused images");
  };

  return (
    <ResponsivePanel open={open} onOpenChange={onOpenChange} title="Reading settings" desktop="sheet-right">
      <div className="flex flex-col gap-5">
        {hydrated && (
          <Choice<ThemeName>
            label="Theme"
            value={(theme as ThemeName) ?? options.defaultTheme}
            values={options.themes}
            labels={THEME_LABEL}
            onChange={setTheme}
          />
        )}
        <Choice<TextSize> label="Text size" value={settings.textSize} values={TEXT_SIZES} labels={SIZE_LABEL} onChange={(textSize) => update({ textSize })} />
        <Choice<Leading> label="Line spacing" value={settings.leading} values={LEADINGS} labels={LEADING_LABEL} onChange={(leading) => update({ leading })} />
        <Choice<Measure> label="Line width" value={settings.measure} values={MEASURES} labels={MEASURE_LABEL} onChange={(measure) => update({ measure })} />
        <Choice<FontFamily> label="Font" value={settings.fontFamily} values={FONT_FAMILIES} labels={FONT_LABEL} onChange={(fontFamily) => update({ fontFamily })} />

        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="grid gap-1">
            <Label htmlFor={hlModeId}>Highlight mode</Label>
            <p className="text-sm text-muted-foreground">Tap any sentence to highlight it.</p>
          </div>
          <Switch id={hlModeId} checked={settings.highlightMode} onCheckedChange={(highlightMode) => update({ highlightMode })} />
        </div>

        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => store.resetSettings()}>
          <RotateCcwIcon /> Reset reading settings
        </Button>

        <Separator />

        <section className="flex flex-col gap-3" aria-labelledby={`${modeId}-title`}>
          <h3 id={`${modeId}-title`} className="text-sm font-medium">
            Your data
          </h3>
          {options.backupReminder && (
            <Alert>
              <HardDriveIcon />
              <AlertTitle>Stored only in this browser</AlertTitle>
              <AlertDescription>Highlights, notes, bookmarks and scratchpads are removed if site data is cleared. Export a backup now and then.</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void onExport()}>
              <DownloadIcon /> Export backup
            </Button>
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
              <UploadIcon /> Import backup
            </Button>
            {book && highlights.length > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const titles = new Map(book.chapters.map((c) => [c.id, c.title]));
                  downloadFile(`${book.id}-highlights.md`, highlightsToMarkdown(book.title, highlights, (id) => titles.get(id) ?? id), "text/markdown");
                }}
              >
                <DownloadIcon /> Highlights (.md)
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Switch id={modeId} checked={replace} onCheckedChange={setReplace} />
            <Label htmlFor={modeId} className="font-normal">
              Replace existing data on import
            </Label>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImport(f);
              e.target.value = "";
            }}
          />
          {usage && usage.count > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>
                {usage.count} image{usage.count === 1 ? "" : "s"} in notes and scratchpads, {formatStorageBytes(usage.bytes)}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => void onCleanUp()}>
                Remove unused images
              </Button>
            </div>
          )}
          <Button
            type="button"
            variant="link"
            className="self-start px-0"
            onClick={async () =>
              (await requestPersistentStorage())
                ? toast.success("This browser will keep your reader data.")
                : toast.info("The browser did not grant persistent storage.")
            }
          >
            Ask the browser to keep this data
          </Button>
        </section>
      </div>
    </ResponsivePanel>
  );
}
