# React + TypeScript + Vite

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

## リアルタイム共同編集のセットアップ（Firestore）

`src/firebase.ts` と `src/hooks/useFirestoreSync.ts` は、5〜7人程度での同時編集を想定した Firebase Firestore 連携の土台です。**何も設定しなくてもアプリは今まで通り完全にローカル/オフラインで動作します**（`firebase` パッケージは実際に import されるまでビルドに一切含まれません）。共同編集機能をオンにしたい場合のみ、以下の手順を行ってください。

### 1. Firebase プロジェクトを作る
1. [console.firebase.google.com](https://console.firebase.google.com) →「プロジェクトを追加」。Google Analytics は不要なのでオフでよい。
2. 左メニュー「構築」→「Firestore Database」→「データベースを作成」。
   - モード：「本番環境モードで開始」（セキュリティルールは後述の `firestore.rules` を使うため、テストモードにする必要はない）
   - ロケーション：`asia-northeast1`（東京）など近いリージョン

### 2. Web アプリを登録し、config を取得
プロジェクト概要の「`</>`」アイコン →ニックネームを入力（Firebase Hosting は使わないのでチェック不要）→表示される `firebaseConfig` の値（apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId）を控える。

### 3. ローカル環境に設定
```bash
cp .env.example .env.local
```
`.env.local` に控えた値を貼り付けて `npm run dev` を再起動。`.env.local` は `.gitignore` 済みなのでコミットされません。

### 4. セキュリティルールを反映
このリポジトリの `firestore.rules` を、Firebase コンソールの「Firestore Database」→「ルール」タブに貼り付けて公開する（または Firebase CLI の `firebase deploy --only firestore:rules` を使う）。ログイン機能は無いため「ルームIDを知っている人は誰でも読み書き可能」というモデルですが、各コレクションのドキュメント形式（必須フィールド・サイズ上限）をルール側で検証し、壊れた/巨大な書き込みだけは弾きます。

### 5. GitHub Pages 用にデプロイ環境へも設定
GitHub リポジトリの Settings → Secrets and variables → Actions →「New repository secret」で、`.env.example` と同じ6つのキー（`VITE_FIREBASE_API_KEY` など）をそれぞれ登録する。`.github/workflows/deploy.yml` はビルド時にこれらを読み込むよう既に設定済み。未設定のままでも、これまで通りビルド・デプロイは通ります（ローカル専用モードになるだけ）。

### 現状のスコープ
ここまでで用意したのは「土台」（Firebase 初期化・リアルタイム同期＋デバウンス書き込み＋楽観的UI更新を行う汎用フック `useFirestoreDocSync`・セキュリティルール）です。実際にタイムテーブル編集画面（`useAppStore` のバンド配置など）をこのフックにつなぎ込む作業はまだ行っていません（本物の Firebase プロジェクトが無い状態でテストできないため）。上記セットアップが完了したら、次のステップとして実際の同期処理を配線します。
