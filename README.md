# Steam Wishlist Manager

Steamのゲーム情報をDiscord経由でNotionデータベースに登録し、セール情報やリリース情報を自動で通知するアプリケーションです。

## 機能

### 1. Discord Bot機能 (`index.mjs`)
- SteamのURLをDiscordに送信すると、自動でNotionデータベースにゲーム情報を登録
- 複数のタグを設定可能
- ゲーム情報（タイトル、価格、セール情報、レビュー評価）を自動取得

### 2. 自動更新・通知機能 (`updateNotion.mjs`)
- 定期的にNotionデータベース内のゲーム情報を更新
- セール開始を検知してDiscordに通知
- ゲームリリースを検知してDiscordに通知
- 「非通知」タグが付いているゲームは通知をスキップ

## セットアップ

### 1. 必要な環境変数

`.env`ファイルを作成し、以下の環境変数を設定してください：

```env
# Discord設定
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CHANNEL_ID=your_channel_id

# Notion設定
NOTION_TOKEN=your_notion_integration_token
NOTION_DATABASE_ID=your_database_id
```

### 2. Notionデータベースの設定

以下のプロパティを持つデータベースを作成してください：

| プロパティ名 | タイプ | 説明 |
|-------------|--------|------|
| Name | Title | ゲームタイトル |
| AppID | Rich text | Steam App ID |
| URL | URL | SteamストアURL |
| Price | Number | 現在の価格（円） |
| OriginalPrice | Number | 元の価格（円） |
| SalePercent | Number | 割引率（0-1の小数） |
| OverallReview | Rich text | 全体レビュー評価 |
| Tags | Multi-select | タグ（複数設定可能） |

### 3. 依存関係のインストール

```bash
npm install
```

## 使用方法

### Discord Botの起動

```bash
node index.mjs
```

### ゲーム登録

Discordで以下の形式でメッセージを送信：

```
https://store.steampowered.com/app/123456 アクション RPG お気に入り
```

- URLの後にスペース区切りでタグを指定
- 複数のタグを設定可能
- タグは任意（省略可能）

### 自動更新・通知の実行

```bash
node updateNotion.mjs
```

## ファイル構成

```
steam-wishlist-manager/
├── index.mjs              # Discord Bot（ゲーム登録）
├── updateNotion.mjs       # 自動更新・通知
├── steamUtils.mjs         # Steam API関連の共通処理
├── package.json
├── ecosystem.config.js     # PM2設定
└── README.md
```

## 技術スタック

- **Node.js** - ランタイム環境
- **Discord.js** - Discord Bot API
- **@notionhq/client** - Notion API
- **axios** - HTTP通信
- **cheerio** - HTML解析
- **dotenv** - 環境変数管理

## 通知機能

### セール開始通知
- 割引率が0%から変更された場合に通知
- 通知内容：タイトル、URL、割引率、価格

### リリース通知
- 価格がnullから値ありに変更された場合に通知
- 通知内容：タイトル、URL、割引率、価格

### 通知スキップ
- 「非通知」タグが付いているゲームは通知をスキップ

## 開発・カスタマイズ

### 新しい機能の追加
- `steamUtils.mjs`にSteam API関連の共通処理を追加
- 各ファイルでインポートして利用

### 通知メッセージのカスタマイズ
- `updateNotion.mjs`の`saleMsg`、`releaseMsg`を編集

## トラブルシューティング

### よくある問題

1. **Discord Botが応答しない**
   - トークンが正しく設定されているか確認
   - Botに適切な権限が付与されているか確認

2. **Notionに登録されない**
   - データベースIDが正しいか確認
   - Notion統合トークンが有効か確認

3. **通知が来ない**
   - DiscordチャンネルIDが正しいか確認
   - 「非通知」タグが付いていないか確認

## ライセンス

このプロジェクトはMITライセンスの下で公開されています。