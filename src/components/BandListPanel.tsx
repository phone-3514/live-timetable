import { useDroppable } from "@dnd-kit/core";
import { useAppStore } from "../store/useAppStore";
import { BandCard } from "./BandCard";

export function BandListPanel() {
  const bands = useAppStore((s) => s.bands);
  const slots = useAppStore((s) => s.slots);
  const placedIds = new Set(slots.map((s) => s.bandId).filter(Boolean));
  const unplaced = bands.filter((b) => !placedIds.has(b.id));

  const { setNodeRef, isOver } = useDroppable({ id: "unplaced" });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[200px] flex-col gap-2 rounded-lg border-2 border-dashed p-3 ${
        isOver ? "border-indigo-400 bg-indigo-50" : "border-slate-200"
      }`}
    >
      <h2 className="mb-1 text-sm font-semibold text-slate-500">
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
      {unplaced.map((band) => (
        <BandCard key={band.id} band={band} />
      ))}
    </div>
  );
}
