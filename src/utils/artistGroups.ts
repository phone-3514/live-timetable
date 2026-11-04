import type { Application } from "../types";

// Bands that cover the same artist, grouped by the artist named in their
// setlists ("曲名 / アーティスト"). Artists are matched on a loose key —
// width-folded, case-folded, spaces and the usual separators dropped — so
// "Ｙｏｒｕｓｈｉｋａ" and "yorushika" meet, though "ヨルシカ" and "yorushika" do
// not (that would need a hand-made alias list).

export type ArtistGroupEntry = {
  app: Application;
  /** This band's songs by the artist, in setlist order. */
  titles: string[];
};

export type ArtistGroup = {
  key: string;
  /** How the artist is most often written. */
  name: string;
  entries: ArtistGroupEntry[];
};

export function artistKey(artist: string): string {
  return artist
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　・･.,，、._\-ー'’"“”()（）[\]【】/／&＆]+/g, "");
}

export function groupBandsByArtist(applications: Application[], minBands = 2): ArtistGroup[] {
  const groups = new Map<string, { names: Map<string, number>; entries: Map<string, ArtistGroupEntry> }>();
  for (const app of applications) {
    for (const item of app.setlist) {
      const artist = item.artist.trim();
      const key = artistKey(artist);
      if (!key) continue;
      const group = groups.get(key) ?? { names: new Map(), entries: new Map() };
      group.names.set(artist, (group.names.get(artist) ?? 0) + 1);
      const entry = group.entries.get(app.id) ?? { app, titles: [] };
      if (item.title && !entry.titles.includes(item.title)) entry.titles.push(item.title);
      group.entries.set(app.id, entry);
      groups.set(key, group);
    }
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      name: [...g.names.entries()].sort((a, b) => b[1] - a[1])[0][0],
      entries: [...g.entries.values()],
    }))
    .filter((g) => g.entries.length >= minBands)
    .sort((a, b) => b.entries.length - a.entries.length || a.name.localeCompare(b.name, "ja"));
}
