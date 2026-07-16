import { useDroppable } from "@dnd-kit/core";
import { getPlacedBandIds, useAppStore } from "../store/useAppStore";
import { BandChip } from "./BandChip";

export function BandListPanel() {
  const bands = useAppStore((s) => s.bands);
  const days = useAppStore((s) => s.days);
  const placedIds = getPlacedBandIds(days);
  const unplaced = bands.filter((b) => !placedIds.has(b.id));

  const { setNodeRef, isOver } = useDroppable({ id: "unplaced" });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-0 flex-1 flex-col rounded-lg border-2 border-dashed p-2 ${
        isOver ? "border-indigo-400 bg-indigo-50" : "border-slate-200"
      }`}
    >
      <h2 className="mb-1 shrink-0 text-xs font-semibold text-slate-500">
        未配置のバンド（{unplaced.length}）
      </h2>
      {bands.length === 0 && (
        <p className="text-xs text-slate-400">
          左上のテキストエリアに貼り付けて「解析してリスト化」を押してください
        </p>
      )}
      {bands.length > 0 && unplaced.length === 0 && (
        <p className="text-xs text-slate-400">全てのバンドが配置済みです</p>
      )}
      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-1 overflow-y-auto pb-1">
        {unplaced.map((band) => (
          <BandChip key={band.id} band={band} />
        ))}
      </div>
    </div>
  );
}
