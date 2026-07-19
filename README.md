# Live Timetable

ライブイベントの進行表、出演情報、パンフレット表示、共同編集をまとめたPWAです。GitHub Pagesで公開したまま、スマートフォンやPCのホーム画面へアプリとして追加できます。

## ホーム画面に追加

- **iPhone / iPad:** Safariの共有ボタンから「ホーム画面に追加」→「Webアプリとして開く」
- **Android / PC:** 画面内の「アプリとして追加」、またはブラウザのインストールメニューを選択
- 一度読み込んだアプリ本体はオフラインでも起動できます。端末に保存済みのイベント編集も継続できます。共同編集の同期には通信が必要です。
- 新しいバージョンが利用可能になると画面下部に更新案内が表示され、利用者が「更新」を押した時点で切り替わります。

## 開発

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## リアルタイム共同編集のセットアップ（Firestore + Realtime Database）

5〜7人程度での同時編集を想定した、Firebase を使ったハイブリッド構成です。**何も設定しなくてもアプリは今まで通り完全にローカル/オフラインで動作します**（`firebase` パッケージは実際にこの機能を使うまでビルドに一切含まれません — `CollabRoot` として遅延読み込みされます）。

- **Firestore** — 永続データ（バンド・タイムテーブル・出演情報）。1ルーム1ドキュメント（`rooms/{roomId}`）。
- **Realtime Database (RTDB)** — 消えてよい一時データ（他の参加者のマウスカーソル位置・ドラッグ中のバンドID）。`presence/{roomId}/{clientId}` にタブを閉じると自動で消える形で書き込まれます（`onDisconnect`）。

### 1. Firebase プロジェクトを作る
1. [console.firebase.google.com](https://console.firebase.google.com) →「プロジェクトを追加」。Google Analytics は不要なのでオフでよい。
2. 左メニュー「構築」→「Firestore Database」→「データベースを作成」（本番環境モードでOK、ロケーションは`asia-northeast1`など近い場所）。
3. 同じく「構築」→「Realtime Database」→「データベースを作成」（ロケーションはFirestoreと合わせなくてOK）。

### 2. Web アプリを登録し、config を取得
プロジェクト概要の「`</>`」アイコン →ニックネームを入力（Firebase Hosting は使わないのでチェック不要）→表示される `firebaseConfig` の値（apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId, **databaseURL**）を控える。

### 3. ローカル環境に設定
```bash
cp .env.example .env.local
```
`.env.local` に控えた値を貼り付けて `npm run dev` を再起動。`.env.local` は `.gitignore` 済みなのでコミットされません。

### 4. セキュリティルールを反映（2箇所）
Firestore と RTDB はコンソールのルール設定が別々の場所にあるので、両方とも忘れずに：
- `firestore.rules` の中身 → 「Firestore Database」→「ルール」タブに貼り付けて公開
- `database.rules.json` の中身 → 「Realtime Database」→「ルール」タブに貼り付けて公開

どちらもログイン機能が無いため「ルームIDを知っている人は誰でも読み書き可能」というモデルですが、書き込み内容の形式（必須フィールド・サイズ上限）は検証し、壊れた/巨大な書き込みだけは弾きます。**このリポジトリのルールファイルを編集した場合は、その都度この手順でコンソール側に再度貼り付けが必要です**（自動デプロイの仕組みはありません）。

### 5. GitHub Pages 用にデプロイ環境へも設定
GitHub リポジトリの Settings → Secrets and variables → Actions →「New repository secret」で、`.env.example` と同じキー（`VITE_FIREBASE_API_KEY`、`VITE_FIREBASE_DATABASE_URL`、`VITE_ROOM_PASSWORD` など）をそれぞれ登録する。`.github/workflows/deploy.yml` はビルド時にこれらを読み込むよう既に設定済み。未設定のままでも、これまで通りビルド・デプロイは通ります（共同編集機能自体が非表示になるか、`VITE_ROOM_PASSWORD`だけ未設定ならパスワードなしで使えます）。

### 6. （任意）合言葉での入室制限
`VITE_ROOM_PASSWORD` を設定すると、ルームの開始・参加どちらの操作にも合言葉の入力が必要になります。**これは静的サイトの都合上、合言葉がビルド済みJSファイルにそのまま埋め込まれる簡易的な仕組みです**（devtoolsやソース表示で誰でも読めます）。技術的なアクセスに対する防御にはならず、あくまで「身内以外が偶然/誤操作でルームに触れるのを防ぐ」程度の目的で使ってください。空欄のままなら、この制限自体が無効になります（今まで通り誰でもURLを知っていれば参加可能）。

### 使い方
1. ヘッダーの「🔗 共同編集を開始」を押すと、今の画面の内容でルームが作られ、URLに `?room=xxxx` が付く（`VITE_ROOM_PASSWORD` 設定時はここで合言葉の入力を求められる）。
2. そのURLを他の人に共有すると、開いた瞬間にニックネーム入力（＋合言葉、設定時のみ）を求められ、参加するとルームの内容と同期される。
3. 参加中は、他の人のマウスカーソルとニックネームが画面上に表示され、誰かがバンドカードをドラッグ中はそのカードが他の人には「🔒 ○○が移動中」とロック表示され、自分ではドラッグできなくなる。
