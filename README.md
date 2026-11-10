# site

このリポジトリの AI/ ディレクトリを Apache の /var/www/html/AI/ に同期します。

## Raspberry Pi でのセットアップ

リポジトリをクローンしたディレクトリで次を実行します。

    node server.js

Node.js の標準モジュールのみを使うため、追加パッケージは不要です。

server.js は起動時に GitHub の origin/main を pull して AI/ を /var/www/html/AI/ にコピーし、その後60秒ごとに更新を確認します。GitHub のファイルは残し、Web公開用ディレクトリに同期します。

Apache の DocumentRoot が /var/www/html であれば、次のURLでアクセスできます。

    https://ドメイン/AI/

実行ユーザーには、リポジトリの pull 権限と /var/www/html への書き込み権限が必要です。root で常時実行する方法は推奨しません。

Web公開用の /var/www/html/AI/ はこのスクリプトが管理します。ここに直接置いたファイルは、次回同期時に GitHub 側の内容で置き換わります。追加・変更するHTMLは必ずリポジトリの AI/ 内で編集してください。

同期先を変更する場合は WEB_ROOT、追跡ブランチを変更する場合は GIT_BRANCH 環境変数を指定できます。
