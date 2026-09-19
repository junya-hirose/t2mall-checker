# タカラトミーモール監視 GitHub Actions版

GASからの取得がタイムアウトするため、Node.jsの `fetch` で一覧HTMLを直接取得して解析します。

## 監視対象

- 再入荷・高額: `https://takaratomymall.jp/shop/e/eRestock/`
- 新着/予約開始・高額: `https://takaratomymall.jp/shop/newarrival/newarrival.aspx`
- デュエル・マスターズ: `https://takaratomymall.jp/shop/c/cDM/`

高額チェックは15,000円以上です。

## 内部API調査メモ

商品一覧そのものを返すJSON APIは見つかっていません。
新着・再入荷・カテゴリページは、商品一覧がHTMLに直接埋め込まれています。

見つかったAPI/非同期エンドポイントは、主にカート・お気に入り・カテゴリ件数用でした。

```text
/shop/goods/conditioncountapi.aspx
/shop/goods/treecountapi.aspx
/shop/Category/CategoryTags.aspx
/shop/js/addcart.aspx
/shop/js/cart_button.aspx
/shop/js/cart.aspx
/shop/js/delcart.aspx
/shop/customer/bookmarkajax.aspx
/shop/bookmark/bookmarkajax.aspx
/shop/common/ajaxbookmarkcount.aspx
/search/lookupzipjson.aspx
```

監視にはこれらではなく、一覧HTMLを直接取得して解析します。

## ローカル実行

```bash
npm install
npm run baseline
npm run check
```

初回は `npm run baseline` で現在の商品状態を保存します。

## GitHub Actions設定

`.github/workflows/takaratomymall-watcher.yml` が毎日 00:01 JST に動きます。

GitHubリポジトリの `Settings > Secrets and variables > Actions > New repository secret` で以下を設定してください。

```text
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
MAIL_TO
```

任意:

```text
SMTP_SECURE
MAIL_FROM
```

Gmailを使う場合は通常のパスワードではなく、Googleアカウントのアプリパスワードを `SMTP_PASS` に入れます。

## 初回ベースライン作成

初回だけ、GitHub Actionsの `Takara Tomy Mall Watcher` を手動実行します。

1. GitHubの `Actions` を開く
2. `Takara Tomy Mall Watcher` を選ぶ
3. `Run workflow` を押す
4. `baseline` を `true` にして実行する

これで現在の商品状態だけを保存し、メール通知は送りません。
次回以降の定期実行では差分だけ通知します。

## 状態保存

前回の商品状態は `data/takaratomymall-state.json` に保存され、GitHub Actionsが実行後に自動コミットします。

## 監視先を一時的に外す

GitHubリポジトリの `Settings > Secrets and variables > Actions > Variables` に `SKIP_SOURCE_IDS` を追加すると、指定した監視先をスキップできます。

例:

```text
high_new_arrivals,duel_masters
```

監視先ID:

```text
high_restock
high_new_arrivals
duel_masters
```

既定では1ページ20秒でタイムアウトします。調整したい場合は `PAGE_TIMEOUT_MS` を変更してください。
